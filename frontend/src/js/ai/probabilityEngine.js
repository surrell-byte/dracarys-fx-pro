// Probability Engine: takes the same buyScore/sellScore/confidence every
// one of the 14 strategies in signalEngine.js already produces, and
// re-expresses it as a { buyProbability, sellProbability, waitProbability }
// distribution that always sums to exactly 1.
//
// Deliberately NOT a from-scratch statistical model, and deliberately NOT
// wired only into the AI Confidence Pipeline strategy - this sits at the
// one point in generateSignal() where every strategy's output already
// converges (buyScore, sellScore, and the confidence derived from them),
// so all 14 strategies get real probabilities, not just the one that
// happens to use ai/confidence.js internally.
//
// The three numbers are built to be provably consistent with the
// confidence score already shown everywhere else in the UI:
//   buyProbability + sellProbability === confidence / 100  (exactly, by
//   construction - see below), so this can never show, say, "62% BUY"
//   next to "confidence: 40%" - the two numbers can't disagree.
//
// Also worth being honest about what this ISN'T: it's not a calibrated
// probability in the statistical sense (that would mean checking against
// binaryTracker's resolved outcome history - e.g. "of all signals that
// scored ~80% confidence, how many actually won?" - a natural follow-up,
// not this). This is a consistent re-expression of the same evidence
// already scored, not a forecast that's been checked against reality.
export function toProbabilities({ confidence, buyScore, sellScore }) {
    const decisive = clamp01((confidence ?? 0) / 100);
    const buy = Math.max(0, buyScore ?? 0);
    const sell = Math.max(0, sellScore ?? 0);
    const total = buy + sell;

    if (total <= 0 || decisive <= 0) {
        return { buyProbability: 0, sellProbability: 0, waitProbability: 1 };
    }

    const buyShare = buy / total;
    const sellShare = sell / total;

    const buyProbability = round4(decisive * buyShare);
    const sellProbability = round4(decisive * sellShare);
    // Derived as the remainder, not as `1 - decisive` directly, so the
    // three numbers always sum to exactly 1 even after rounding above.
    const waitProbability = round4(Math.max(0, 1 - buyProbability - sellProbability));

    return { buyProbability, sellProbability, waitProbability };
}

function clamp01(n) {
    return Math.max(0, Math.min(1, n));
}

function round4(n) {
    return Math.round(n * 10000) / 10000;
}

