// Pure "what should happen" decision logic for auto-execution, extracted
// from app.js's maybeExecute. Byte-identical branching order and
// conditions; the only structural change is that this returns a decision
// object describing what to do instead of performing side effects
// (setExecutionStatus, disabling the autoTrade checkbox, actually placing
// a trade) directly - app.js's maybeExecute stays responsible for running
// those side effects, this module is just responsible for deciding.
//
// That split is what makes the decision logic testable without a DOM: no
// element refs, no network calls, just signal + settings + a few pieces
// of context in, a decision out.
//
// Returned shape is one of:
//   { action: "skip", statusMessage, disableAutoTrade? }
//   { action: "paper" }
//   { action: "live" }
//
// `disableAutoTrade` is only present (and true) on the max-loss-reached
// skip case - every other skip leaves auto-trade armed.
export function decideExecution(signal, settings, { isCoolingDown, paperPnl }) {
    if (!settings.autoTrade) {
        return { action: "skip", statusMessage: "Manual mode" };
    }

    if (!signal.ready || signal.type === "HOLD") {
        return { action: "skip", statusMessage: "Waiting for actionable signal" };
    }

    if (signal.confidence < settings.minConfidence) {
        return { action: "skip", statusMessage: `Confidence below ${settings.minConfidence}%` };
    }

    if (isCoolingDown) {
        return { action: "skip", statusMessage: "Cooldown active" };
    }

    if (paperPnl <= -settings.maxLoss) {
        return { action: "skip", statusMessage: "Max loss reached, auto disabled", disableAutoTrade: true };
    }

    return { action: settings.mode === "paper" ? "paper" : "live" };
}
