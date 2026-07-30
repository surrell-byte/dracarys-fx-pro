// payoutMetrics.js: turns a raw win/loss count into an honest answer to
// "do I actually have an edge, or is this just variance?"
//
// Two numbers matter for binary options that plain win-rate hides:
//   1. Breakeven rate - the win rate you need just to not lose money,
//      given your broker's payout. At an 85% payout you need to win
//      ~54.05% of the time, not 50%, because losses cost 100% of stake
//      but wins only pay back 85%.
//   2. Confidence interval - with a small sample, a 60% win rate and a
//      50% win rate can be statistically indistinguishable. This uses a
//      Wilson score interval (more reliable than a naive +/- on small n)
//      to report a range for the TRUE win rate, not just the observed one.

const DEFAULT_Z = 1.96; // ~95% confidence

/** Win rate required to break even at a given payout ratio (e.g. 0.85 = 85%). */
export function breakevenWinRate(payoutRatio) {
    if (!Number.isFinite(payoutRatio) || payoutRatio <= 0) return null;
    return 1 / (1 + payoutRatio);
}

/** Wilson score interval for a binomial proportion. Returns null if trades is 0. */
export function wilsonInterval(wins, trades, z = DEFAULT_Z) {
    if (!Number.isFinite(trades) || trades <= 0) return null;
    const phat = wins / trades;
    const z2 = z * z;
    const denominator = 1 + z2 / trades;
    const center = phat + z2 / (2 * trades);
    const margin = z * Math.sqrt((phat * (1 - phat)) / trades + z2 / (4 * trades * trades));
    return {
        lower: Math.max(0, (center - margin) / denominator),
        upper: Math.min(1, (center + margin) / denominator)
    };
}

/**
 * The main entry point: given a resolved win/trade count and a payout
 * ratio, says whether there's a statistically real edge, no edge, or not
 * enough data to tell yet. Never returns a confident verdict on a small
 * sample - "inconclusive" is the honest answer far more often than people
 * expect, and that's the point of this function existing.
 */
export function evaluateEdge({ wins, trades, payoutRatio = 0.85, minSampleSize = 20 }) {
    const breakeven = breakevenWinRate(payoutRatio);
    const winRate = trades > 0 ? wins / trades : null;

    if (!trades || trades < minSampleSize) {
        return {
            trades,
            winRate,
            breakeven,
            edge: null,
            ci: null,
            reliable: false,
            verdict: `Not enough data (${trades ?? 0}/${minSampleSize} trades)`
        };
    }

    const ci = wilsonInterval(wins, trades);
    const edge = winRate - breakeven;

    let verdict;
    if (ci.lower > breakeven) {
        verdict = "Edge detected — win rate statistically above breakeven";
    } else if (ci.upper < breakeven) {
        verdict = "No edge — likely losing money after payout, statistically";
    } else {
        verdict = "Inconclusive — confidence interval straddles breakeven, need more trades";
    }

    return { trades, winRate, breakeven, edge, ci, reliable: true, verdict };
}
