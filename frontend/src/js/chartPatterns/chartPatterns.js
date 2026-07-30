import { detectDoubleTop } from "./doubleTop.js";
import { detectDoubleBottom } from "./doubleBottom.js";
import { detectHeadAndShoulders, detectInverseHeadAndShoulders } from "./headShoulders.js";
import { detectTriangle } from "./triangle.js";
import { detectWedge } from "./wedge.js";
import { detectChannel } from "./channel.js";
import { detectFlag } from "./flag.js";

// Geometric chart-pattern recognition (double top/bottom, head & shoulders,
// triangles, wedges, channels, flags) is inherently a heuristic read on
// candle-derived swing points, not a rigorous statistical fit the way
// trendlines.js's R²-gated regression is — two "roughly equal" peaks and a
// broken neckline is suggestive, not proof. Every vote out of this module
// carries the same structural weight discount liquidity.js's zone heuristic
// does, for the same reason: it should never be able to outvote the modules
// checking more rigorous, falsifiable shapes.
const WEIGHT = 0.6;

// Runs every detector against the same candles. Useful on its own for a UI
// that wants to show everything the engine currently sees, or a backtest
// that wants to score patterns individually rather than only the winner.
export function detectAllPatterns(candles) {
    return [
        detectDoubleTop(candles),
        detectDoubleBottom(candles),
        detectHeadAndShoulders(candles),
        detectInverseHeadAndShoulders(candles),
        detectTriangle(candles),
        detectWedge(candles),
        detectChannel(candles),
        detectFlag(candles)
    ];
}

// Returns the { signal, confidence, reason, value, weight } contract every
// other module in the pipeline uses (see doji.js, marketStructure.js,
// liquidity.js) — the single best-confidence ACTIONABLE pattern (direction
// not null) among everything detected, or WAIT if nothing actionable is
// present. Two patterns rarely fire as actionable on the same candles at
// once since most share the same swing points, but if they do, the higher-
// confidence one wins rather than arbitrarily picking by detector order.
export function analyzeChartPatterns(candles) {
    const all = detectAllPatterns(candles);
    const actionable = all.filter(p => p.detected && p.direction);

    if (!actionable.length) {
        const forming = all.find(p => p.detected);
        return {
            signal: "WAIT",
            confidence: 0,
            reason: forming ? `${forming.pattern} forming, not actionable yet` : "No chart pattern detected",
            value: { patterns: all },
            weight: WEIGHT
        };
    }

    actionable.sort((a, b) => b.confidence - a.confidence);
    const best = actionable[0];

    return {
        signal: best.direction,
        confidence: best.confidence,
        reason: `${best.pattern}: ${best.reason}`,
        value: { patterns: all, winner: best },
        weight: WEIGHT
    };
}

