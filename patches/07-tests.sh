#!/usr/bin/env bash
# 07-tests.sh
# Adds new tests: fold-1 warm-up, HTF-applied strictness, and the pooled-
# trade research-audit suite.
set -euo pipefail

TESTDIR="frontend/tests"
mkdir -p "$TESTDIR"

# --- 1. New file: researchAudit.test.js -------------------------------------
cat > "$TESTDIR/researchAudit.test.js" <<'EOF'
import { describe, expect, it } from "vitest";
import {
    buildStrategyScorecard, buildRegimeScorecard, buildAssetScorecard,
    buildTimeframeScorecard, buildStrategyMarketMatrix, buildStrategyTimeframeMatrix,
    bootstrapMeanCI
} from "@analysis/scorecard.js";

const TRADE = (strategy, pnlPercent, {
    symbol = "BTC/USDT", timeframe = "5m", regime = "TRENDING", closedAt = 1, fold = 1
} = {}) => ({ strategy, label: strategy, pnlPercent, symbol, timeframe, regime, closedAt, fold });

const REPORT = {
    results: [{
        symbol: "BTC/USDT", assetClass: "crypto", timeframe: "5m",
        rows: [
            { symbol: "BTC/USDT", timeframe: "5m", fold: 1, strategy: "trend", trades: 3, totalPnl: 1.5, expectancy: 0.5 },
            { symbol: "BTC/USDT", timeframe: "5m", fold: 2, strategy: "trend", trades: 3, totalPnl: -0.3, expectancy: -0.1 }
        ],
        trades: [
            TRADE("trend", 1, { fold: 1, closedAt: 1 }),
            TRADE("trend", 0.5, { fold: 1, closedAt: 2 }),
            TRADE("trend", 0, { fold: 1, closedAt: 3 }),
            TRADE("trend", -0.1, { fold: 2, closedAt: 4 }),
            TRADE("trend", -0.1, { fold: 2, closedAt: 5, regime: "RANGING" }),
            TRADE("trend", -0.1, { fold: 2, closedAt: 6 })
        ]
    }]
};

describe("bootstrapMeanCI", () => {
    it("is deterministic for a fixed seed", () => {
        const trades = [{ pnlPercent: 1 }, { pnlPercent: 2 }, { pnlPercent: -1 }, { pnlPercent: 3 }];
        const first = bootstrapMeanCI(trades, { iterations: 500, seed: "test" });
        const second = bootstrapMeanCI(trades, { iterations: 500, seed: "test" });
        expect(first).toEqual(second);
    });

    it("returns null for empty samples", () => {
        expect(bootstrapMeanCI([])).toBeNull();
    });
});

describe("buildStrategyScorecard", () => {
    it("uses pooled trades rather than averaging fold expectancies", () => {
        const scorecard = buildStrategyScorecard(REPORT);
        const trend = scorecard.find((row) => row.strategy === "trend");
        expect(trend.trades).toBe(6);
        expect(trend.totalPnl).toBeCloseTo(1.2, 6);
        expect(trend.expectancy).toBeCloseTo(1.2 / 6, 6);
    });

    it("counts no-trade/negative folds in consistency denominator", () => {
        const scorecard = buildStrategyScorecard(REPORT);
        const trend = scorecard.find((row) => row.strategy === "trend");
        expect(trend.totalFolds).toBe(2);
        expect(trend.profitableFolds).toBe(1);
        expect(trend.profitableFoldPct).toBe(50);
    });
});

describe("regime scorecard", () => {
    it("uses actual trade regimes", () => {
        const scorecard = buildRegimeScorecard(REPORT);
        expect(scorecard.find((row) => row.regime === "TRENDING").trades).toBe(5);
        expect(scorecard.find((row) => row.regime === "RANGING").trades).toBe(1);
    });
});

describe("asset scorecard", () => {
    it("groups pooled trades by market", () => {
        const scorecard = buildAssetScorecard(REPORT);
        expect(scorecard[0].symbol).toBe("BTC/USDT");
        expect(scorecard[0].trades).toBe(6);
    });
});

describe("timeframe scorecard", () => {
    it("groups pooled trades by timeframe", () => {
        const scorecard = buildTimeframeScorecard(REPORT);
        expect(scorecard[0].timeframe).toBe("5m");
        expect(scorecard[0].trades).toBe(6);
    });
});

describe("strategy matrices", () => {
    it("builds strategy × market rows", () => {
        const matrix = buildStrategyMarketMatrix(REPORT);
        expect(matrix).toHaveLength(1);
        expect(matrix[0]).toMatchObject({ strategy: "trend", symbol: "BTC/USDT", trades: 6 });
    });

    it("builds strategy × timeframe rows", () => {
        const matrix = buildStrategyTimeframeMatrix(REPORT);
        expect(matrix).toHaveLength(1);
        expect(matrix[0]).toMatchObject({ strategy: "trend", timeframe: "5m", trades: 6 });
    });
});
EOF
echo "✓ Wrote $TESTDIR/researchAudit.test.js"

# --- 2. Append fold-1 warm-up + HTF-strictness tests to backtestEngine.test.js
BTEST="$TESTDIR/backtestEngine.test.js"
if [ ! -f "$BTEST" ]; then
  echo "⚠️  $BTEST not found — skipping append. Add the tests from the chat instructions by hand."
else
  cp "$BTEST" "$BTEST.bak"
  cat >> "$BTEST" <<'EOF'

it("gives fold 1 a full external warm-up context when provided", async () => {
    const candles = Array.from({ length: 35 }, (_, i) => ({
        time: i + 1, open: 100, high: 101, low: 99, close: 100, volume: 1
    }));

    const result = await runWalkForwardBacktest(candles, {
        folds: 3, warmupCandles: 5, initialContextCandles: 5,
        strategyIds: ["fakeStrategy"], assetClass: "crypto", costs: zeroCosts
    });

    expect(result.summary.initialContextCandles).toBe(5);
    expect(result.summary.totalScoredCandles).toBe(30);
    expect(result.folds).toHaveLength(3);

    // Fold 1 must NOT cold-start.
    expect(result.folds[0].contextCandles).toBe(5);
    expect(result.folds[0].scoreStartIndex).toBe(5);
    expect(result.folds[0].fullWarmupAvailable).toBe(true);

    expect(result.folds[1].contextCandles).toBe(5);
    expect(result.folds[2].contextCandles).toBe(5);
    expect(result.summary.allFoldsHaveFullWarmup).toBe(true);
});

it("does not mark HTF as applied with insufficient daily history", async () => {
    const candles = Array.from({ length: 20 }, (_, i) => ({
        time: i + 1, open: 100, high: 101, low: 99, close: 100, volume: 1
    }));
    const dailyCandles = Array.from({ length: 100 }, (_, i) => ({
        time: i + 1, open: 100, high: 101, low: 99, close: 100, volume: 1
    }));

    const result = await runWalkForwardBacktest(candles, {
        folds: 2, warmupCandles: 5, initialContextCandles: 5,
        strategyIds: ["fakeStrategy"], assetClass: "crypto", costs: zeroCosts, dailyCandles
    });

    expect(result.folds[0].higherTimeframeApplied).toBe(false);
});
EOF
  echo "✓ Appended fold-1/HTF tests to $BTEST (backup: $BTEST.bak)"
  echo "  MANUAL: find the existing 'higherTimeframeCandles).toBe(expectedHtf);' assertion"
  echo "  and add directly beneath it:"
  echo '    expect(result.folds[1].higherTimeframeApplied).toBe(expectedHtf >= 200);'
fi

# --- 3. Append pooled-trade test to scorecard.test.js -----------------------
STEST="$TESTDIR/scorecard.test.js"
if [ ! -f "$STEST" ]; then
  echo "⚠️  $STEST not found — skipping append. Add the test from the chat instructions by hand."
else
  cp "$STEST" "$STEST.bak"
  cat >> "$STEST" <<'EOF'

describe("buildStrategyScorecard (pooled)", () => {
    it("pools trades across folds", () => {
        const report = {
            results: [{
                symbol: "BTC/USDT", timeframe: "5m",
                rows: [
                    { strategy: "trend", fold: 1, trades: 2, totalPnl: 2 },
                    { strategy: "trend", fold: 2, trades: 10, totalPnl: -1 }
                ],
                trades: [
                    { strategy: "trend", label: "Trend", pnlPercent: 1, closedAt: 1, regime: "TRENDING" },
                    { strategy: "trend", label: "Trend", pnlPercent: 1, closedAt: 2, regime: "TRENDING" },
                    ...Array.from({ length: 10 }, (_, index) => ({
                        strategy: "trend", label: "Trend", pnlPercent: -0.1, closedAt: index + 3, regime: "RANGING"
                    }))
                ]
            }]
        };

        const scorecard = buildStrategyScorecard(report);
        const trend = scorecard.find((row) => row.strategy === "trend");

        expect(trend.trades).toBe(12);
        expect(trend.totalPnl).toBeCloseTo(1, 6);
    });
});
EOF
  echo "✓ Appended pooled-trade test to $STEST (backup: $STEST.bak)"
  echo "  NOTE: this file's OLD tests (avgExpectancy/avgProfitFactor/avgWinRate-based)"
  echo "  will now fail since scorecard.js no longer returns those fields — delete or"
  echo "  update them by hand once you review the diff."
fi
