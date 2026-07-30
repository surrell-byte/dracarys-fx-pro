// Combines N independent module votes (each { signal, confidence, reason })
// into a single weighted recommendation. This is the piece that replaces
// hand-tuned point-addition scoring: every module contributes proportional
// to its own confidence AND its assigned weight, so a module that isn't
// sure about anything (low confidence) can't swing the outcome as hard as
// one that's very sure.
//
// votes:   [{ name, signal, confidence, reason, weight? }]
// weights: optional { name: weight } map, defaults to 1 for any module not listed
export function combineConfidence(votes, weights = {}) {
    const active = votes.filter(vote => vote.signal !== "WAIT" && vote.confidence > 0);

    if (!active.length) {
        return {
            signal: "WAIT",
            confidence: 0,
            participation: 0,
            breakdown: votes.map(toBreakdownRow),
            reasons: votes.map(vote => vote.reason).filter(Boolean)
        };
    }

    let netSigned = 0;
    let maxPossible = 0;

    for (const vote of active) {
        const weight = weights[vote.name] ?? vote.weight ?? 1;
        const direction = vote.signal === "BUY" ? 1 : -1;
        netSigned += direction * vote.confidence * weight;
        maxPossible += 100 * weight; // 100 = max confidence a single module can cast
    }

    // -1..1: how one-sided the active votes are, independent of how many
    // modules actually had an opinion.
    const directionalStrength = maxPossible > 0 ? netSigned / maxPossible : 0;
    const signal = directionalStrength > 0 ? "BUY" : directionalStrength < 0 ? "SELL" : "WAIT";

    // A signal where only 1 of 6 modules voted shouldn't claim the same
    // confidence as one where 5 of 6 agree — participation scales it down
    // when most modules abstained (WAIT). Modules with no opinion aren't
    // penalized individually; the *system's* confidence is what gets discounted.
    const participation = votes.length > 0 ? active.length / votes.length : 0;
    const confidence = Math.round(Math.abs(directionalStrength) * 100 * participation);

    return {
        signal,
        confidence: Math.min(100, confidence),
        participation: Math.round(participation * 100),
        breakdown: votes.map(toBreakdownRow),
        reasons: active
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 3)
            .map(vote => vote.reason)
            .filter(Boolean)
    };
}

function toBreakdownRow(vote) {
    return {
        name: vote.name,
        signal: vote.signal,
        confidence: vote.confidence,
        reason: vote.reason
    };
}
