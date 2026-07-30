import { calculateMACD } from "@indicators/indicators.js";

function getTrend(closes) {
    const macd = calculateMACD(closes);
    const last = macd.at(-1);

    if (!last) return "NEUTRAL";

    if (last.MACD > last.signal) return "UP";
    if (last.MACD < last.signal) return "DOWN";

    return "NEUTRAL";
}

export function multiTimeframeSignal(data) {
    const m1 = getTrend(data.m1.map(c => c.close));
    const m5 = getTrend(data.m5.map(c => c.close));
    const m15 = getTrend(data.m15.map(c => c.close));

    let score = 0;

    // Strong alignment (all same direction)
    if (m1 === "UP" && m5 === "UP" && m15 === "UP") score = 100;
    if (m1 === "DOWN" && m5 === "DOWN" && m15 === "DOWN") score = 100;

    // Partial alignment
    if (m5 === m15 && m1 !== m5) score = 60;
    if (m15 === "UP" && m5 === "UP") score = 70;
    if (m15 === "DOWN" && m5 === "DOWN") score = 70;

    // Mixed/no trend
    if (m15 === "NEUTRAL") score = 30;

    let direction = "HOLD";

    if (score >= 80 && m15 === "UP") direction = "BUY";
    if (score >= 80 && m15 === "DOWN") direction = "SELL";

    if (score < 60) direction = "HOLD";

    return {
        direction,
        score,
        m1,
        m5,
        m15
    };
}
