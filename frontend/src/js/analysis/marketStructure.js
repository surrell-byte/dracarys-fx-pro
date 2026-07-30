// Shared market-structure helpers: finds swing (fractal) highs/lows, then
// derives support/resistance proximity, break-of-structure continuation,
// and change-of-character reversal warnings from them. All three return the
// same { signal, confidence, reason, value } contract as the indicator
// modules, so they drop straight into the same vote pipeline from
// Milestone 1.
//
// Deliberately NOT building here (Milestone 2 scoping note): trendline
// fitting (trendlines.js) and liquidity-zone detection (liquidity.js) —
// both need either real statistical rigor across pivot points or
// order-book/open-interest data we don't have a legitimate source for from
// spot candles alone. Flagging rather than shipping a plausible-looking
// guess of either.

const SWING_STRENGTH = 2; // candles required on each side to confirm a swing point

export function findSwingPoints(candles, strength = SWING_STRENGTH) {
    const highs = [];
    const lows = [];

    for (let i = strength; i < candles.length - strength; i += 1) {
        const windowHighs = candles.slice(i - strength, i + strength + 1).map(c => c.high);
        const windowLows = candles.slice(i - strength, i + strength + 1).map(c => c.low);

        if (candles[i].high === Math.max(...windowHighs)) {
            highs.push({ index: i, price: candles[i].high });
        }
        if (candles[i].low === Math.min(...windowLows)) {
            lows.push({ index: i, price: candles[i].low });
        }
    }

    return { highs, lows };
}

// Vote 1: how close price sits to the strongest recent swing high/low —
// a simple, well-established support/resistance proximity read.
export function analyzeSupportResistance(candles, lookback = 60) {
    const recent = candles.slice(-lookback);
    const price = candles.at(-1).close;
    const { highs, lows } = findSwingPoints(recent);

    if (!highs.length || !lows.length) {
        return { signal: "WAIT", confidence: 0, reason: "Not enough swing points yet", value: { support: null, resistance: null } };
    }

    const resistance = Math.max(...highs.map(h => h.price));
    const support = Math.min(...lows.map(l => l.price));
    const range = resistance - support;

    if (range <= 0) {
        return { signal: "WAIT", confidence: 0, reason: "No usable range", value: { support, resistance } };
    }

    const distToSupport = (price - support) / range;
    const distToResistance = (resistance - price) / range;

    if (distToSupport <= 0.08) {
        const confidence = Math.round(Math.min(80, 50 + (0.08 - distToSupport) * 500));
        return { signal: "BUY", confidence, reason: "Price near swing-low support", value: { support, resistance } };
    }
    if (distToResistance <= 0.08) {
        const confidence = Math.round(Math.min(80, 50 + (0.08 - distToResistance) * 500));
        return { signal: "SELL", confidence, reason: "Price near swing-high resistance", value: { support, resistance } };
    }

    return { signal: "WAIT", confidence: 15, reason: "Price mid-range between support/resistance", value: { support, resistance } };
}

// Vote 2: Break of Structure — price closing beyond the most recent swing
// point in the direction the swing sequence was already moving. This is a
// continuation signal (the trend already in place gets confirmed further),
// not a reversal one — that's change-of-character below.
export function analyzeBreakOfStructure(candles, lookback = 60) {
    const recent = candles.slice(-lookback);
    const { highs, lows } = findSwingPoints(recent);
    const price = candles.at(-1).close;

    if (highs.length < 2 || lows.length < 2) {
        return { signal: "WAIT", confidence: 0, reason: "Not enough structure yet", value: {} };
    }

    const lastHigh = highs.at(-1);
    const lastLow = lows.at(-1);
    const priorHigh = highs.at(-2);
    const priorLow = lows.at(-2);

    const upswing = lastLow.price > priorLow.price && lastHigh.price > priorHigh.price;
    const downswing = lastLow.price < priorLow.price && lastHigh.price < priorHigh.price;

    if (upswing && price > lastHigh.price) {
        return { signal: "BUY", confidence: 70, reason: "Break of structure: new higher high confirmed", value: { lastHigh: lastHigh.price } };
    }
    if (downswing && price < lastLow.price) {
        return { signal: "SELL", confidence: 70, reason: "Break of structure: new lower low confirmed", value: { lastLow: lastLow.price } };
    }

    return { signal: "WAIT", confidence: 15, reason: "No structure break yet", value: { lastHigh: lastHigh.price, lastLow: lastLow.price } };
}

// Vote 3: Change of Character — price breaks the structure AGAINST the
// prevailing trend. This is the first warning sign of a possible reversal,
// distinct from BOS (which confirms a trend already in place).
export function analyzeChangeOfCharacter(candles, lookback = 60) {
    const recent = candles.slice(-lookback);
    const { highs, lows } = findSwingPoints(recent);
    const price = candles.at(-1).close;

    if (highs.length < 2 || lows.length < 2) {
        return { signal: "WAIT", confidence: 0, reason: "Not enough structure yet", value: {} };
    }

    const lastHigh = highs.at(-1);
    const lastLow = lows.at(-1);
    const priorHigh = highs.at(-2);
    const priorLow = lows.at(-2);

    const wasUptrend = lastLow.price > priorLow.price && lastHigh.price > priorHigh.price;
    const wasDowntrend = lastLow.price < priorLow.price && lastHigh.price < priorHigh.price;

    if (wasUptrend && price < lastLow.price) {
        return { signal: "SELL", confidence: 65, reason: "Change of character: uptrend structure broken to downside", value: { lastLow: lastLow.price } };
    }
    if (wasDowntrend && price > lastHigh.price) {
        return { signal: "BUY", confidence: 65, reason: "Change of character: downtrend structure broken to upside", value: { lastHigh: lastHigh.price } };
    }

    return { signal: "WAIT", confidence: 10, reason: "Trend structure intact", value: {} };
}
