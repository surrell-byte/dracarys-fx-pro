// Shared execution-cost model for paper trading and backtests. Both
// virtualTrades.js/runScheduler.js (live scheduler) and backtestEngine.js
// import this so entry/exit costs are computed identically everywhere —
// the same principle as sharing generateSignal(): one cost model, not two
// slightly-different reimplementations that quietly drift apart.
//
// Real fills are never as clean as a candle's close price. This models
// three separate costs:
//   - spread:   half paid on entry, half paid on exit (bid/ask)
//   - slippage: a small adverse fixed % on both entry and exit
//   - fee:      a round-trip % taken off final PnL (maker/taker style)
// All values are expressed as a fraction of price (0.001 = 0.1%), not
// percentage points, to avoid the classic *100/÷100 mismatch bugs.

export const DEFAULT_EXECUTION_COSTS = {
    crypto: { spreadPct: 0.0005, slippagePct: 0.0003, feePct: 0.002 },
    forex: { spreadPct: 0.0002, slippagePct: 0.0001, feePct: 0.0000 }
};

function costsFor(assetClass, costs) {
    if (costs && typeof costs === "object" && Object.prototype.hasOwnProperty.call(costs, "spreadPct")) {
        return costs;
    }

    if (assetClass == null) {
        return { spreadPct: 0, slippagePct: 0, feePct: 0 };
    }

    const table = costs || DEFAULT_EXECUTION_COSTS;
    return table[assetClass] || table.crypto;
}

export function applyEntryCost(rawPrice, type, assetClass, costs) {
    const { spreadPct, slippagePct } = costsFor(assetClass, costs);
    const adverse = spreadPct / 2 + slippagePct;
    return type === "BUY" ? rawPrice * (1 + adverse) : rawPrice * (1 - adverse);
}

export function applyExitCost(rawPrice, type, assetClass, costs) {
    const { spreadPct, slippagePct } = costsFor(assetClass, costs);
    const adverse = spreadPct / 2 + slippagePct;
    return type === "BUY" ? rawPrice * (1 - adverse) : rawPrice * (1 + adverse);
}

export function applyFeeToPnl(pnlPct, assetClass, costs) {
    const { feePct } = costsFor(assetClass, costs);
    return pnlPct - feePct * 100;
}
