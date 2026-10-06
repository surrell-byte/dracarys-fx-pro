const QUALITY_RANK = { Low: 1, Medium: 2, High: 3 };

export function evaluateEntryFilters(signal, options = {}) {
    const {
        minConfidence = 0,
        minQuality = "Low",
        allowedRegimes = null,
        minTargetToCostRatio = 0,
        estimatedCostPct = 0
    } = options;
    const reasons = [];

    if (!signal || !["BUY", "SELL"].includes(signal.type) || signal.ready === false) {
        reasons.push("signal is not actionable");
        return { allowed: false, reasons };
    }
    if (Number(signal.confidence) < minConfidence) reasons.push(`confidence below ${minConfidence}`);
    if ((QUALITY_RANK[signal.quality] ?? 0) < (QUALITY_RANK[minQuality] ?? 1)) reasons.push(`quality below ${minQuality}`);

    const regime = signal.regime?.primary;
    if (Array.isArray(allowedRegimes) && allowedRegimes.length > 0 && !allowedRegimes.includes(regime)) {
        reasons.push(`regime ${regime ?? "UNKNOWN"} not allowed`);
    }

    const entry = Number(signal.price);
    const target = Number(signal.risk?.takeProfit);
    if (minTargetToCostRatio > 0 && Number.isFinite(entry) && entry > 0 && Number.isFinite(target) && estimatedCostPct > 0) {
        const targetPct = Math.abs((target - entry) / entry) * 100;
        if (targetPct / estimatedCostPct < minTargetToCostRatio) {
            reasons.push(`target/cost ratio below ${minTargetToCostRatio}`);
        }
    }

    return { allowed: reasons.length === 0, reasons };
}

export function passesEntryFilters(signal, options) {
    return evaluateEntryFilters(signal, options).allowed;
}

export { QUALITY_RANK };
