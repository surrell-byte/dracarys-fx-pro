// Candle buffer management for the live market feed. Extracted from
// app.js's upsertCandle byte-identical in logic; the only structural
// change is that this takes the current candle list and maxCandles as
// parameters and returns the updated array, instead of closing over
// app.js's `state` object directly - that's what makes it testable
// without a DOM.
//
// Named candleBuffer.js (not candles.js) to avoid colliding with
// scripts/scheduler/candles.js, which is a different module (fetches
// historical OHLCV from an exchange) that already owns that name.

// Applies one incoming candle (from either a "tick" - the currently
// forming candle - or a newly closed candle) to the rolling window kept
// for charting/signal generation. If the incoming candle has the same
// timestamp as the last one in the buffer, it replaces it in place
// (this is the tick-update case: the same in-progress candle keeps
// arriving with updated high/low/close until it closes). Otherwise it's
// a genuinely new candle and gets appended. The buffer is then trimmed
// to the last `maxCandles` entries so it doesn't grow unbounded over a
// long-running session.
export function upsertCandle(candles, candle, maxCandles) {
    const next = candles.slice();
    const last = next.at(-1);

    if (last?.time === candle.time) {
        next[next.length - 1] = candle;
    } else {
        next.push(candle);
    }

    return next.slice(-maxCandles);
}
