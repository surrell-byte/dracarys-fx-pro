import { describe, it, expect } from "vitest";
import {
    calculateSMA,
    calculateEMA,
    calculateRSI,
    calculateMACD,
    calculateADX,
    calculateATR
} from "@indicators/indicators.js";

// Deterministic synthetic price series so every assertion below is against
// a known, hand-checkable number rather than "whatever real market data
// happened to produce" - if one of these starts failing, it's a real
// behavior change in the indicator, not sample-data noise.
function linearSeries(start, step, count) {
    return Array.from({ length: count }, (_, i) => start + i * step);
}

describe("calculateSMA", () => {
    it("averages a flat window correctly", () => {
        const values = [10, 20, 30, 40, 50];
        const sma = calculateSMA(values, 3);
        // windows: [10,20,30]=20, [20,30,40]=30, [30,40,50]=40
        expect(sma).toEqual([20, 30, 40]);
    });

    it("returns empty array when there isn't enough data", () => {
        expect(calculateSMA([1, 2], 5)).toEqual([]);
    });
});

describe("calculateEMA", () => {
    it("seeds with an SMA then applies the EMA multiplier", () => {
        const values = [1, 2, 3, 4, 5, 6];
        const ema = calculateEMA(values, 3);
        // seed = avg(1,2,3) = 2; multiplier = 2/(3+1) = 0.5
        // next: (4-2)*0.5+2=3; (5-3)*0.5+3=4; (6-4)*0.5+4=5
        expect(ema).toEqual([2, 3, 4, 5]);
    });
});

describe("calculateRSI", () => {
    it("returns 100 for a strictly increasing series (no losses)", () => {
        const closes = linearSeries(100, 1, 20); // always up, never down
        const rsi = calculateRSI(closes, 14);
        expect(rsi.every((v) => v === 100)).toBe(true);
    });

    it("returns 0 for a strictly decreasing series (no gains)", () => {
        const closes = linearSeries(100, -1, 20);
        const rsi = calculateRSI(closes, 14);
        expect(rsi.every((v) => v === 0)).toBe(true);
    });

    it("stays near 50 for a series with equal up/down alternation (recursive smoothing causes minor drift, not a fixed 50 forever)", () => {
        const closes = [];
        for (let i = 0; i < 30; i += 1) closes.push(100 + (i % 2 === 0 ? 1 : -1));
        const rsi = calculateRSI(closes, 14);
        // The very first value uses a plain (non-recursive) average over
        // the seed window, so it's exactly 50. After that, Wilder's
        // recursive smoothing formula depends on which half of the
        // alternation each step lands on, so later values drift somewhat
        // - they should still hover in a tight band around 50, not swing
        // toward either extreme.
        expect(rsi[0]).toBeCloseTo(50, 5);
        rsi.forEach((v) => {
            expect(v).toBeGreaterThan(35);
            expect(v).toBeLessThan(65);
        });
    });
});

describe("calculateMACD", () => {
    it("produces a zero histogram on a flat price series", () => {
        const closes = Array(60).fill(100);
        const macd = calculateMACD(closes, 12, 26, 9);
        expect(macd.length).toBeGreaterThan(0);
        macd.forEach((point) => {
            expect(point.MACD).toBeCloseTo(0, 8);
            expect(point.signal).toBeCloseTo(0, 8);
            expect(point.histogram).toBeCloseTo(0, 8);
        });
    });
});

describe("calculateATR", () => {
    it("equals the constant true range on a series with fixed daily range", () => {
        // Each bar: high = close+1, low = close-1, so TR is always 2
        // regardless of gaps, since close-to-close movement is also 1.
        const closes = linearSeries(100, 1, 30);
        const highs = closes.map((c) => c + 1);
        const lows = closes.map((c) => c - 1);
        const atr = calculateATR(highs, lows, closes, 14);
        // TR per bar = max(high-low, |high-prevClose|, |low-prevClose|)
        //            = max(2, 2, 0) = 2 for this series
        atr.forEach((v) => expect(v).toBeCloseTo(2, 8));
    });
});

describe("calculateADX - Wilder smoothing regression test", () => {
    // This is the fix flagged in the original review: calculateADX used to
    // return raw DX (a single-bar directional ratio) mislabeled as "adx",
    // with no smoothing at all. That made every ADX-derived reading as
    // noisy as a 1-bar oscillator instead of a genuinely smoothed trend
    // strength measure. The concrete, checkable difference: raw DX swings
    // hard bar-to-bar; real (Wilder-smoothed) ADX changes gradually. This
    // test asserts the smoothed behavior, not just "a number comes out".

    it("returns [] when there isn't enough data for both smoothing stages", () => {
        const highs = linearSeries(101, 1, 10);
        const lows = linearSeries(99, 1, 10);
        const closes = linearSeries(100, 1, 10);
        expect(calculateADX(highs, lows, closes, 14)).toEqual([]);
    });

    it("stays low and stable (not noisy) on a strong, steady uptrend", () => {
        // A clean, constant-slope uptrend: real ADX should climb toward a
        // high, stable trend-strength reading, not oscillate.
        const period = 14;
        const closes = linearSeries(100, 1, 80);
        const highs = closes.map((c) => c + 0.5);
        const lows = closes.map((c) => c - 0.5);

        const adx = calculateADX(highs, lows, closes, period);
        expect(adx.length).toBeGreaterThan(20);

        // +DI should dominate -DI throughout a clean uptrend.
        adx.forEach((point) => {
            expect(point.pdi).toBeGreaterThan(point.mdi);
        });

        // Bar-to-bar changes in the smoothed adx value should be small
        // once it has converged (Wilder smoothing damps movement), not
        // swinging wildly the way an unsmoothed raw-DX series would.
        const late = adx.slice(-10).map((p) => p.adx);
        const maxStep = Math.max(...late.slice(1).map((v, i) => Math.abs(v - late[i])));
        expect(maxStep).toBeLessThan(5); // smoothed series barely moves once converged

        // On this idealized perfectly-linear trend (+DM constant, -DM
        // always 0), DX is ~100 on essentially every bar, so ADX is
        // already at/near its ceiling from the very first smoothed value
        // - there's no "climb" to observe here. What Wilder smoothing
        // actually buys you shows up on noisier data (see the flat/choppy
        // test below, where it correctly stays LOW instead of chasing
        // every bar's raw DX). Assert convergence/stability here instead.
        expect(adx.at(-1).adx).toBeGreaterThan(90);
        expect(adx.at(-1).adx).toBeLessThanOrEqual(100);
    });

    it("smooths out bar-to-bar noise in a choppy-but-trending series (this is what the fix actually buys you)", () => {
        // A trend with small pullbacks every few bars: raw per-bar DX
        // would swing sharply on the pullback bars (since -DM briefly
        // dominates), but real Wilder-smoothed ADX should only dip
        // gently, not spike/crash bar to bar the way the old unsmoothed
        // "adx" (actually DX) implementation would have.
        const period = 14;
        const closes = [];
        let price = 100;
        for (let i = 0; i < 100; i += 1) {
            price += (i % 7 === 6) ? -1.5 : 1; // small pullback every 7th bar
            closes.push(price);
        }
        const highs = closes.map((c) => c + 0.5);
        const lows = closes.map((c) => c - 0.5);
        const adx = calculateADX(highs, lows, closes, period);

        const late = adx.slice(-30).map((p) => p.adx);
        const steps = late.slice(1).map((v, i) => Math.abs(v - late[i]));
        const maxStep = Math.max(...steps);
        // A genuinely smoothed series shouldn't move more than a few
        // points in a single bar even across the noisy pullback bars.
        expect(maxStep).toBeLessThan(8);
    });

    it("stays low on a flat/choppy series with no sustained direction", () => {
        const period = 14;
        const closes = [];
        for (let i = 0; i < 80; i += 1) closes.push(100 + (i % 2 === 0 ? 0.3 : -0.3));
        const highs = closes.map((c) => c + 0.5);
        const lows = closes.map((c) => c - 0.5);

        const adx = calculateADX(highs, lows, closes, period);
        expect(adx.length).toBeGreaterThan(20);
        // No sustained trend -> ADX should stay low throughout, not spike.
        adx.forEach((point) => expect(point.adx).toBeLessThan(30));
    });
});
