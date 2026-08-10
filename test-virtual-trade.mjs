import { checkExit } from "./frontend/scripts/scheduler/virtualTrades.js";

const executionCosts = {
  crypto: {
    spreadPct: 0.0005,
    slippagePct: 0.0003,
    feePct: 0.002
  },
  forex: {
    spreadPct: 0.0002,
    slippagePct: 0.0001,
    feePct: 0
  }
};

const trade = {
  type: "BUY",
  entryPrice: 100,
  stopLoss: 95,
  takeProfit: 110
};

const candle = {
  high: 111,
  low: 108,
  close: 110
};

const result = checkExit(
  trade,
  candle,
  1,
  60,
  "conservative",
  "crypto",
  executionCosts
);

console.log(result);
