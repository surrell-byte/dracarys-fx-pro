import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// db.js opens its SQLite file as a module-level side effect on import
// (see that file's header), reading config.dbPath at that moment. To
// exercise it against a throwaway file instead of the real
// frontend/data/signals.db, point SCHEDULER_DB_PATH at a fresh temp file
// *before* importing config.js or db.js anywhere in this process. Since
// ES modules are cached per resolved path, this only works because no
// other test file in this run imports scheduler config/db first.
const tmpDbPath = path.join(os.tmpdir(), `dracarys-scheduler-test-${process.pid}-${Date.now()}.db`);
process.env.SCHEDULER_DB_PATH = tmpDbPath;

const db = await import("../scripts/scheduler/db.js");

function baseSignalRow(overrides = {}) {
    return {
        createdAt: new Date("2026-08-01T12:00:00.000Z").toISOString(),
        symbol: "BTC/USDT",
        assetClass: "crypto",
        timeframe: "1m",
        strategyId: "trend",
        strategyLabel: "Trend Follow",
        type: "BUY",
        confidence: 80,
        quality: "High",
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 52000,
        rewardMultiple: 2,
        regime: "trending",
        reason: "EMA trend up",
        expiryLabel: "15m",
        expiryMinutes: 15,
        ...overrides
    };
}

// Each test starts from a clean `signals` table so assertions don't
// depend on execution order or leak state between tests.
beforeEach(() => {
    db.default.exec("DELETE FROM signals");
    db.default.exec("DELETE FROM report_snapshots");
});

afterAll(() => {
    // better-sqlite3 keeps the file handle open for the process lifetime;
    // just remove the WAL-mode files best-effort, ignoring any that are
    // still locked when the test process itself is about to exit.
    for (const suffix of ["", "-wal", "-shm"]) {
        try {
            fs.unlinkSync(tmpDbPath + suffix);
        } catch {
            // best-effort cleanup only
        }
    }
});

describe("scheduler db.js", () => {
    it("inserts a signal and reads it back as an open signal", () => {
        const id = db.insertSignal(baseSignalRow());
        expect(typeof id).toBe("number");

        const open = db.getOpenSignals("BTC/USDT", "trend");
        expect(open).toHaveLength(1);
        expect(open[0]).toMatchObject({
            id,
            symbol: "BTC/USDT",
            strategy_id: "trend",
            status: "open",
            candles_since_open: 0
        });
    });

    it("scopes getOpenSignals to the given symbol and strategy", () => {
        db.insertSignal(baseSignalRow());
        db.insertSignal(baseSignalRow({ symbol: "ETH/USDT" }));
        db.insertSignal(baseSignalRow({ strategyId: "breakout", strategyLabel: "Breakout" }));

        expect(db.getOpenSignals("BTC/USDT", "trend")).toHaveLength(1);
        expect(db.getOpenSignals("ETH/USDT", "trend")).toHaveLength(1);
        expect(db.getOpenSignals("BTC/USDT", "breakout")).toHaveLength(1);
        expect(db.getAllOpenSignals()).toHaveLength(3);
    });

    it("increments candles_since_open and tracks last_candle_time", () => {
        const id = db.insertSignal(baseSignalRow());
        db.incrementCandlesSinceOpen(id, 1_700_000_000_000);
        db.incrementCandlesSinceOpen(id, 1_700_000_060_000);

        const [row] = db.getOpenSignals("BTC/USDT", "trend");
        expect(row.candles_since_open).toBe(2);
        expect(row.last_candle_time).toBe(1_700_000_060_000);
    });

    it("closes a signal and moves it out of the open set", () => {
        const id = db.insertSignal(baseSignalRow());
        db.closeSignal(id, {
            closedAt: new Date("2026-08-01T13:00:00.000Z").toISOString(),
            exitPrice: 51000,
            outcome: "win",
            closeReason: "take_profit",
            pnlPct: 2.0
        });

        expect(db.getOpenSignals("BTC/USDT", "trend")).toHaveLength(0);

        const closed = db.getAllClosedSignals();
        expect(closed).toHaveLength(1);
        expect(closed[0]).toMatchObject({
            id,
            status: "closed",
            outcome: "win",
            close_reason: "take_profit",
            exit_price: 51000
        });
    });

    it("filters closed signals by date for getTodaysClosedSignals and getClosedSignalsSince", () => {
        const oldId = db.insertSignal(baseSignalRow());
        db.closeSignal(oldId, {
            closedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            exitPrice: 49500,
            outcome: "loss",
            closeReason: "stop_loss",
            pnlPct: -1.0
        });

        const todayId = db.insertSignal(baseSignalRow());
        const closedAtNow = new Date().toISOString();
        db.closeSignal(todayId, {
            closedAt: closedAtNow,
            exitPrice: 51000,
            outcome: "win",
            closeReason: "take_profit",
            pnlPct: 2.0
        });

        const today = db.getTodaysClosedSignals();
        expect(today.map(r => r.id)).toEqual([todayId]);

        const sinceEpoch = db.getClosedSignalsSince(new Date(0).toISOString());
        expect(sinceEpoch).toHaveLength(2);

        const sinceNow = db.getClosedSignalsSince(closedAtNow);
        expect(sinceNow.map(r => r.id)).toEqual([todayId]);
    });

    it("caps getRecentClosedSignals to the requested (bounded) limit", () => {
        for (let i = 0; i < 5; i += 1) {
            const id = db.insertSignal(baseSignalRow());
            db.closeSignal(id, {
                closedAt: new Date(Date.now() + i).toISOString(),
                exitPrice: 51000,
                outcome: "win",
                closeReason: "take_profit",
                pnlPct: 1.0
            });
        }

        expect(db.getRecentClosedSignals(2)).toHaveLength(2);
        // Non-numeric / absurd limits fall back to the documented bounds
        // (default 100, hard cap 500) rather than throwing or returning
        // everything unbounded.
        expect(db.getRecentClosedSignals("not-a-number")).toHaveLength(5);
        expect(db.getRecentClosedSignals(10_000)).toHaveLength(5);
    });

    it("upserts report snapshots on the same (report_type, period_start) key", () => {
        db.saveReportSnapshot({
            reportType: "daily",
            periodStart: "2026-08-01",
            periodEnd: "2026-08-01",
            generatedAt: new Date("2026-08-01T18:00:00.000Z").toISOString(),
            payload: { totalTrades: 3, winRate: 66.6 }
        });

        // Re-running the same day's report should update in place, not
        // create a second row - this is what lets `npm run report` be
        // re-run safely after the scheduled cron job already fired.
        db.saveReportSnapshot({
            reportType: "daily",
            periodStart: "2026-08-01",
            periodEnd: "2026-08-01",
            generatedAt: new Date("2026-08-01T19:00:00.000Z").toISOString(),
            payload: { totalTrades: 4, winRate: 75 }
        });

        const snapshots = db.getReportSnapshots("daily");
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].data).toEqual({ totalTrades: 4, winRate: 75 });
    });

    it("keeps daily and weekly snapshots on the same period_start separate", () => {
        db.saveReportSnapshot({
            reportType: "daily",
            periodStart: "2026-08-01",
            periodEnd: "2026-08-01",
            generatedAt: new Date().toISOString(),
            payload: { kind: "daily" }
        });
        db.saveReportSnapshot({
            reportType: "weekly",
            periodStart: "2026-08-01",
            periodEnd: "2026-08-07",
            generatedAt: new Date().toISOString(),
            payload: { kind: "weekly" }
        });

        expect(db.getReportSnapshots("daily")).toHaveLength(1);
        expect(db.getReportSnapshots("weekly")).toHaveLength(1);
    });
});
