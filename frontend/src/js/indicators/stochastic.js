import { calculateStochastic } from "./indicators.js";

export function analyzeStochastic(highs, lows, closes, kPeriod = 5, kSmooth = 3, dPeriod = 3) {
    const series = calculateStochastic(highs, lows, closes, kPeriod, kSmooth, dPeriod);
    const latest = series.at(-1);
    const previous = series.at(-2);

    if (!latest || !previous) {
        return { signal: "WAIT", confidence: 0, reason: "Stochastic not ready", value: { k: null, d: null } };
    }

    const bullishCross = previous.k <= previous.d && latest.k > latest.d;
    const bearishCross = previous.k >= previous.d && latest.k < latest.d;

    if (bullishCross && latest.k < 35) {
        return { signal: "BUY", confidence: 75, reason: "%K crossed above %D near oversold", value: latest };
    }
    if (bearishCross && latest.k > 65) {
        return { signal: "SELL", confidence: 75, reason: "%K crossed below %D near overbought", value: latest };
    }

    if (latest.k < 20) {
        return { signal: "BUY", confidence: 45, reason: "Stochastic oversold, no cross yet", value: latest };
    }
    if (latest.k > 80) {
        return { signal: "SELL", confidence: 45, reason: "Stochastic overbought, no cross yet", value: latest };
    }

    return { signal: "WAIT", confidence: 20, reason: "Stochastic mid-range", value: latest };
}
