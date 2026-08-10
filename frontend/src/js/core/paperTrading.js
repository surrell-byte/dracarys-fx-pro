// Paper-trading position sizing, execution, and stop/target management.
// Extracted from app.js byte-identical in logic; the only structural
// change is that render/status side effects (renderPaperAccount,
// setExecutionStatus, showTradeResult, appendAction) are left to the
// caller - this module returns what happened and mutates `paper` in
// place, the caller decides how to display it. That's what keeps this
// testable without a DOM.

// Module 8 (Position Sizing): risk% of account / ATR stop distance. Falls
// back to the fixed trade-size field whenever risk sizing is off or the
// signal has no ATR-based stop distance to size against yet.
export function resolveQuantity(signal, settings) {
    if (!settings.useRiskSizing) return settings.quantity;

    const stopDistance = signal.risk?.stopDistance;
    if (!Number.isFinite(stopDistance) || stopDistance <= 0) return settings.quantity;

    const riskAmount = settings.accountSize * (settings.riskPercent / 100);
    if (!Number.isFinite(riskAmount) || riskAmount <= 0) return settings.quantity;

    const sized = riskAmount / stopDistance;
    return Number.isFinite(sized) && sized > 0 ? Number(sized.toFixed(6)) : settings.quantity;
}

export function isCoolingDown(lastTradeAt, cooldownSeconds) {
    return Date.now() - lastTradeAt < cooldownSeconds * 1000;
}

export function calculatePositionPnl(paper, markPrice) {
    if (!paper.side || !paper.entry) return 0;

    const difference = paper.side === "long"
        ? markPrice - paper.entry
        : paper.entry - markPrice;

    return difference * paper.quantity;
}

export function getPaperPnl(paper, markPrice) {
    if (!paper.side || !Number.isFinite(markPrice)) {
        return paper.realizedPnl;
    }

    return paper.realizedPnl + calculatePositionPnl(paper, markPrice);
}

function clearPosition(paper) {
    paper.side = null;
    paper.entry = null;
    paper.quantity = 0;
    paper.stopLoss = null;
    paper.takeProfit = null;
    paper.demoId = null;
}

// Opens a new paper position for `signal`, flipping (closing then
// reopening) if the previous side was the opposite direction. Mutates
// `paper` in place and returns a result descriptor for the caller to log.
export function executePaperTrade(paper, signal, quantity, { symbol, strategyLabel, openPosition, closePosition }) {
    const price = signal.price;
    const nextSide = signal.type === "BUY" ? "long" : "short";
    const previousSide = paper.side;
    let action = "Paper hold";

    if (previousSide && previousSide !== nextSide) {
        paper.realizedPnl += calculatePositionPnl(paper, price);
        if (paper.demoId) {
            closePosition(paper.demoId, price, `Flipped ${previousSide} \u2192 ${nextSide}`);
        }
        clearPosition(paper);
        action = `Paper closed ${previousSide}`;
    }

    if (paper.side !== nextSide) {
        paper.side = nextSide;
        paper.entry = price;
        paper.quantity = quantity;
        paper.stopLoss = signal.risk?.stopLoss ?? null;
        paper.takeProfit = signal.risk?.takeProfit ?? null;
        const opened = openPosition({
            symbol,
            strategy: strategyLabel,
            side: nextSide,
            entryPrice: price,
            quantity,
            stopLoss: paper.stopLoss,
            takeProfit: paper.takeProfit,
            confidence: signal.confidence,
            reason: signal.reason
        });
        paper.demoId = opened?.id ?? null;
        action = `${action}; opened ${nextSide}`;
    }

    return {
        type: signal.type,
        confidence: signal.confidence,
        price,
        quantity,
        stopLoss: paper.stopLoss,
        takeProfit: paper.takeProfit,
        action
    };
}

// Shared close-and-clear used by both the automatic stop/target check and
// the manual "Close Position" button, so the two can't drift out of sync
// with each other (they used to be two separately hand-written copies of
// the same five field resets).
function closeAndClear(paper, price, label, { closePosition }) {
    const pnl = calculatePositionPnl(paper, price);
    paper.realizedPnl += pnl;
    const closedSide = paper.side;
    if (paper.demoId) {
        closePosition(paper.demoId, price, label);
    }
    clearPosition(paper);
    return { pnl, closedSide };
}

// Module 7 in action: the paper account enforces the ATR stop-loss and
// R-multiple take-profit automatically on every tick, so the risk levels
// shown in the signal panel aren't just informational for paper mode.
// Returns null if nothing was hit, otherwise { label, pnl, closedSide }.
export function checkPaperStops(paper, markPrice, { closePosition }) {
    const { side, stopLoss, takeProfit } = paper;
    if (!side || !Number.isFinite(markPrice)) return null;
    if (!Number.isFinite(stopLoss) && !Number.isFinite(takeProfit)) return null;

    const hitStop = Number.isFinite(stopLoss) && (
        side === "long" ? markPrice <= stopLoss : markPrice >= stopLoss
    );
    const hitTarget = Number.isFinite(takeProfit) && (
        side === "long" ? markPrice >= takeProfit : markPrice <= takeProfit
    );

    if (!hitStop && !hitTarget) return null;

    const label = hitStop ? "Stop-loss hit" : "Take-profit hit";
    const { pnl, closedSide } = closeAndClear(paper, markPrice, label, { closePosition });
    return { label, pnl, closedSide };
}

// Manual "Close Position" button. Same field-reset/PnL logic as
// checkPaperStops, just with a different close reason and no hit-test.
// Returns null if there was nothing open.
export function closePaperPositionManually(paper, price, { closePosition }) {
    if (!paper.side) return null;
    const { pnl, closedSide } = closeAndClear(paper, price, "Manually closed", { closePosition });
    return { pnl, closedSide };
}

export function resetPaperAccount(paper, lastPrice, { closePosition }) {
    if (paper.demoId && Number.isFinite(lastPrice)) {
        closePosition(paper.demoId, lastPrice, "Market switched");
    }
    paper.side = null;
    paper.entry = null;
    paper.quantity = 0;
    paper.stopLoss = null;
    paper.takeProfit = null;
    paper.realizedPnl = 0;
    paper.demoId = null;
}
