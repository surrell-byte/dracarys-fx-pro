export function calculateSMA(values, period) {
    if (values.length < period) return [];

    const result = [];
    let sum = values.slice(0, period).reduce((total, value) => total + value, 0);
    result.push(sum / period);

    for (let i = period; i < values.length; i += 1) {
        sum += values[i] - values[i - period];
        result.push(sum / period);
    }

    return result;
}

export function calculateEMA(values, period) {
    if (values.length < period) return [];

    const multiplier = 2 / (period + 1);
    const result = [];
    let previous = values.slice(0, period).reduce((total, value) => total + value, 0) / period;
    result.push(previous);

    for (let i = period; i < values.length; i += 1) {
        previous = (values[i] - previous) * multiplier + previous;
        result.push(previous);
    }

    return result;
}

export function calculateRSI(closes, period = 14) {
    if (closes.length < period + 1) return [];

    const result = [];
    let gain = 0;
    let loss = 0;

    for (let i = 1; i <= period; i += 1) {
        const change = closes[i] - closes[i - 1];
        if (change >= 0) gain += change;
        else loss += Math.abs(change);
    }

    let avgGain = gain / period;
    let avgLoss = loss / period;
    result.push(toRSI(avgGain, avgLoss));

    for (let i = period + 1; i < closes.length; i += 1) {
        const change = closes[i] - closes[i - 1];
        const currentGain = Math.max(change, 0);
        const currentLoss = Math.max(-change, 0);

        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
        result.push(toRSI(avgGain, avgLoss));
    }

    return result;
}

function toRSI(avgGain, avgLoss) {
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

export function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (closes.length < slowPeriod + signalPeriod) return [];

    const fast = calculateEMA(closes, fastPeriod);
    const slow = calculateEMA(closes, slowPeriod);
    const offset = slowPeriod - fastPeriod;
    const macdLine = slow.map((slowValue, index) => fast[index + offset] - slowValue);
    const signalLine = calculateEMA(macdLine, signalPeriod);
    const signalOffset = macdLine.length - signalLine.length;

    return signalLine.map((signal, index) => {
        const macd = macdLine[index + signalOffset];
        return {
            MACD: macd,
            signal,
            histogram: macd - signal
        };
    });
}

export function calculateBB(closes, period = 20, stdDev = 2) {
    if (closes.length < period) return [];

    const result = [];

    for (let i = period - 1; i < closes.length; i += 1) {
        const slice = closes.slice(i - period + 1, i + 1);
        const middle = slice.reduce((total, value) => total + value, 0) / period;
        const variance = slice.reduce((total, value) => total + ((value - middle) ** 2), 0) / period;
        const deviation = Math.sqrt(variance);

        result.push({
            lower: middle - (deviation * stdDev),
            middle,
            upper: middle + (deviation * stdDev)
        });
    }

    return result;
}

// Proper Wilder-style ADX. Earlier versions of this function computed DX
// (the raw directional-movement ratio for a single bar) and returned it
// as "adx" without ever smoothing it — that's a materially different,
// much noisier series than real ADX, which is itself a smoothed average
// of DX over `period` bars. Since ADX feeds trend-regime detection, AI
// weighting, and multiple strategies, getting this right matters more
// than most individual indicators.
export function calculateADX(highs, lows, closes, period = 14) {
    // Need enough bars for: 1 lost to diffing, `period` to seed the first
    // Wilder-smoothed TR/+DM/-DM, and another `period` to seed the first
    // smoothed DX (i.e. the first real ADX value).
    if (highs.length < period * 2 + 1 || lows.length < period * 2 + 1 || closes.length < period * 2 + 1) return [];

    const trueRanges = [];
    const plusDM = [];
    const minusDM = [];

    for (let i = 1; i < closes.length; i += 1) {
        const highDiff = highs[i] - highs[i - 1];
        const lowDiff = lows[i - 1] - lows[i];

        trueRanges.push(Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        ));

        plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
        minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
    }

    // Seed Wilder's smoothed sums with a plain sum over the first `period`
    // bars, then apply Wilder's recursive smoothing formula:
    //   smoothed[i] = smoothed[i-1] - (smoothed[i-1] / period) + raw[i]
    let smoothedTR = sumWindow(trueRanges, period - 1, period);
    let smoothedPlusDM = sumWindow(plusDM, period - 1, period);
    let smoothedMinusDM = sumWindow(minusDM, period - 1, period);

    const dxValues = [];
    const diSeries = [];

    const pushDX = (tr, plus, minus) => {
        if (tr === 0) {
            diSeries.push({ pdi: 0, mdi: 0 });
            dxValues.push(0);
            return;
        }
        const pdi = (plus / tr) * 100;
        const mdi = (minus / tr) * 100;
        const dx = (Math.abs(pdi - mdi) / Math.max(pdi + mdi, Number.EPSILON)) * 100;
        diSeries.push({ pdi, mdi });
        dxValues.push(dx);
    };

    pushDX(smoothedTR, smoothedPlusDM, smoothedMinusDM);

    for (let i = period; i < trueRanges.length; i += 1) {
        smoothedTR = smoothedTR - (smoothedTR / period) + trueRanges[i];
        smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
        smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];
        pushDX(smoothedTR, smoothedPlusDM, smoothedMinusDM);
    }

    if (dxValues.length < period) return [];

    const result = [];

    // First ADX value is a plain average of the first `period` DX values,
    // then Wilder-smooth it going forward — this mirrors how Wilder
    // originally defined ADX from DX.
    let adx = dxValues.slice(0, period).reduce((total, value) => total + value, 0) / period;
    result.push({ adx, pdi: diSeries[period - 1].pdi, mdi: diSeries[period - 1].mdi });

    for (let i = period; i < dxValues.length; i += 1) {
        adx = ((adx * (period - 1)) + dxValues[i]) / period;
        result.push({ adx, pdi: diSeries[i].pdi, mdi: diSeries[i].mdi });
    }

    return result;
}

export function calculateATR(highs, lows, closes, period = 14) {
    if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) return [];

    const trueRanges = [];

    for (let i = 1; i < closes.length; i += 1) {
        trueRanges.push(Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        ));
    }

    const result = [];
    let previous = trueRanges.slice(0, period).reduce((total, value) => total + value, 0) / period;
    result.push(previous);

    for (let i = period; i < trueRanges.length; i += 1) {
        previous = ((previous * (period - 1)) + trueRanges[i]) / period;
        result.push(previous);
    }

    return result;
}

export function calculateVolumeRatio(volumes, period = 20) {
    if (volumes.length < period + 1) return null;

    const latest = volumes.at(-1);
    const baseline = volumes
        .slice(-period - 1, -1)
        .reduce((total, value) => total + value, 0) / period;

    if (!baseline) return null;
    return latest / baseline;
}

export function calculateROC(closes, period = 21) {
    if (closes.length < period + 1) return [];

    const result = [];

    for (let i = period; i < closes.length; i += 1) {
        const previous = closes[i - period];
        const roc = previous === 0 ? 0 : ((closes[i] - previous) / previous) * 100;
        result.push(roc);
    }

    return result;
}

export function calculateParabolicSAR(highs, lows, step = 0.02, maxStep = 0.2) {
    if (highs.length < 2 || lows.length < 2) return [];

    const result = [null];
    let rising = highs[1] + lows[1] >= highs[0] + lows[0];
    let acceleration = step;
    let extremePoint = rising ? highs[0] : lows[0];
    let sar = rising ? lows[0] : highs[0];

    for (let i = 1; i < highs.length; i += 1) {
        sar += acceleration * (extremePoint - sar);

        if (rising) {
            sar = Math.min(sar, lows[i - 1], i > 1 ? lows[i - 2] : lows[i - 1]);

            if (lows[i] < sar) {
                rising = false;
                sar = extremePoint;
                extremePoint = lows[i];
                acceleration = step;
            } else if (highs[i] > extremePoint) {
                extremePoint = highs[i];
                acceleration = Math.min(acceleration + step, maxStep);
            }
        } else {
            sar = Math.max(sar, highs[i - 1], i > 1 ? highs[i - 2] : highs[i - 1]);

            if (highs[i] > sar) {
                rising = true;
                sar = extremePoint;
                extremePoint = highs[i];
                acceleration = step;
            } else if (lows[i] < extremePoint) {
                extremePoint = lows[i];
                acceleration = Math.min(acceleration + step, maxStep);
            }
        }

        result.push(sar);
    }

    return result;
}

function sumWindow(values, endIndex, period) {
    return values
        .slice(endIndex - period + 1, endIndex + 1)
        .reduce((total, value) => total + value, 0);
}

export function calculateFibLevels(candles, lookback = 50) {
    const recent = candles.slice(-lookback);
    if (!recent.length) return null;

    const high = Math.max(...recent.map(c => c.high));
    const low = Math.min(...recent.map(c => c.low));
    const range = high - low;

    return {
        high,
        low,
        r382: high - range * 0.382,
        r50: high - range * 0.5,
        r618: high - range * 0.618
    };
}

export function calculateStochastic(highs, lows, closes, kPeriod = 5, kSmooth = 3, dPeriod = 3) {
    if (closes.length < kPeriod + kSmooth + dPeriod) return [];

    const rawK = [];
    for (let i = kPeriod - 1; i < closes.length; i += 1) {
        const highWindow = highs.slice(i - kPeriod + 1, i + 1);
        const lowWindow = lows.slice(i - kPeriod + 1, i + 1);
        const highestHigh = Math.max(...highWindow);
        const lowestLow = Math.min(...lowWindow);
        const range = highestHigh - lowestLow;
        rawK.push(range === 0 ? 50 : ((closes[i] - lowestLow) / range) * 100);
    }

    const smoothedK = calculateSMA(rawK, kSmooth);
    const dLine = calculateSMA(smoothedK, dPeriod);
    const kOffset = smoothedK.length - dLine.length;

    return dLine.map((d, index) => ({
        k: smoothedK[index + kOffset],
        d
    }));
}

export function getSupportResistance(candles, lookback = 50) {
    const recent = candles.slice(-lookback);

    if (!recent.length) {
        return { resistance: 0, support: 0 };
    }

    return {
        resistance: Math.max(...recent.map(candle => candle.high)),
        support: Math.min(...recent.map(candle => candle.low))
    };
}