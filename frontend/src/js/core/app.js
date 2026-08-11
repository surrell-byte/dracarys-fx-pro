import { UnifiedMarketDataService } from "@services/unifiedMarketDataService.js";
import { generateSignal, STRATEGIES } from "@signals/signalEngine.js";
import { StrategyTester } from "@analysis/strategyTester.js";
import { runBacktest, runWalkForwardBacktest } from "@analysis/backtestEngine.js";
import { computeRollingPerformance } from "@analysis/performanceStats.js";
import { BinaryOutcomeTracker } from "@analysis/binaryTracker.js";
import { getHigherTimeframeTrend } from "@analysis/multiTimeframe.js";
import demo from "@demo/demoAccount.js";
import { openPosition, closePosition } from "@demo/tradeEngine.js";
import { renderHistoryTable, clearHistory as clearDemoHistory } from "@demo/tradeHistory.js";
import { getStrategyLeaderboard } from "@demo/analytics.js";
import { renderJournal, clearJournal } from "@demo/journal.js";
import { formatPrice, formatNumber, formatCurrency, formatSigned } from "@core/format.js";
import { drawChart as drawChartOnCanvas } from "@core/chart.js";
import {
    resolveQuantity,
    isCoolingDown as isCoolingDownCore,
    getPaperPnl as getPaperPnlCore,
    calculatePositionPnl as calculatePositionPnlCore,
    executePaperTrade as executePaperTradeCore,
    checkPaperStops as checkPaperStopsCore,
    closePaperPositionManually,
    resetPaperAccount as resetPaperAccountCore
} from "@core/paperTrading.js";
import { intervalToMinutes, expiryLabel, clampPayoutRatio, edgeClass, verdictClass } from "@core/labels.js";
import {
    renderTester as renderTesterCore,
    renderBinaryStats as renderBinaryStatsCore,
    renderCalibrationCurve as renderCalibrationCurveCore
} from "@core/testerRender.js";
import {
    renderBacktestResults as renderBacktestResultsCore,
    renderWalkForwardResults as renderWalkForwardResultsCore
} from "@core/backtestRender.js";
import { upsertCandle as upsertCandleCore } from "@core/candleBuffer.js";
import { decideExecution } from "@core/executionDecision.js";
import { resolveMarketSelection } from "@core/marketSelection.js";

// In development, talk to the local backend directly. In production, go
// through the Vercel proxy at /api/trade so the backend's API key never
// ships in the browser bundle (see api/trade.js). Override with
// VITE_API_URL if you're pointing at a different backend/proxy.
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : "");
const HTF_REFRESH_MS = 15 * 60 * 1000; // daily candles barely move intraday

const state = {
    candles: [],
    history: [],
    symbol: "btcusdt",
    apiSymbol: "BTC/USDT",
    assetClass: "crypto",
    interval: "1m",
    strategy: "balanced",
    maxCandles: 320,
    lastTradeAt: 0,
    higherTrend: { trend: "NEUTRAL", ready: false },
    htfTimer: null,
    paper: {
        side: null,
        entry: null,
        quantity: 0,
        stopLoss: null,
        takeProfit: null,
        realizedPnl: 0,
        demoId: null // links the live paper position to its Demo Account trade record
    }
};

const elements = {
    status: document.querySelector("#status"),
    marketLabel: document.querySelector("#marketLabel"),
    pairSelect: document.querySelector("#pairSelect"),
    strategySelect: document.querySelector("#strategySelect"),
    signal: document.querySelector("#signal"),
    confidence: document.querySelector("#confidence"),
    probBuy: document.querySelector("#probBuy"),
    probWait: document.querySelector("#probWait"),
    probSell: document.querySelector("#probSell"),
    probBuyFill: document.querySelector("#probBuyFill"),
    probWaitFill: document.querySelector("#probWaitFill"),
    probSellFill: document.querySelector("#probSellFill"),
    price: document.querySelector("#price"),
    reason: document.querySelector("#reason"),
    candleCount: document.querySelector("#candleCount"),
    support: document.querySelector("#support"),
    resistance: document.querySelector("#resistance"),
    rsi: document.querySelector("#rsi"),
    adx: document.querySelector("#adx"),
    macd: document.querySelector("#macd"),
    pattern: document.querySelector("#pattern"),
    strategyName: document.querySelector("#strategyName"),
    quality: document.querySelector("#quality"),
    volatility: document.querySelector("#volatility"),
    volumeRatio: document.querySelector("#volumeRatio"),
    chart: document.querySelector("#chart"),
    chartFullscreenBtn: document.querySelector("#chartFullscreenBtn"),
    autoTrade: document.querySelector("#autoTrade"),
    tradeSize: document.querySelector("#tradeSize"),
    maxLoss: document.querySelector("#maxLoss"),
    cooldown: document.querySelector("#cooldown"),
    minConfidence: document.querySelector("#minConfidence"),
    useRiskSizing: document.querySelector("#useRiskSizing"),
    accountSize: document.querySelector("#accountSize"),
    riskPercent: document.querySelector("#riskPercent"),
    htfTrend: document.querySelector("#htfTrend"),
    stopLoss: document.querySelector("#stopLoss"),
    takeProfit: document.querySelector("#takeProfit"),
    entryPrice: document.querySelector("#entryPrice"),
    takeProfit1: document.querySelector("#takeProfit1"),
    riskReward: document.querySelector("#riskReward"),
    executionStatus: document.querySelector("#executionStatus"),
    paperPosition: document.querySelector("#paperPosition"),
    paperEntry: document.querySelector("#paperEntry"),
    paperPnl: document.querySelector("#paperPnl"),
    paperStop: document.querySelector("#paperStop"),
    paperTarget: document.querySelector("#paperTarget"),
    historyList: document.querySelector("#historyList"),
    statSignalsCount: document.querySelector("#statSignalsCount"),
    statOpenTrades: document.querySelector("#statOpenTrades"),
    statAccountBalance: document.querySelector("#statAccountBalance"),
    statAccountBalanceSub: document.querySelector("#statAccountBalanceSub"),
    clearHistory: document.querySelector("#clearHistory"),
    testerBody: document.querySelector("#testerBody"),
    regimeBody: document.querySelector("#regimeBody"),
    sessionBody: document.querySelector("#sessionBody"),
    assetBody: document.querySelector("#assetBody"),
    binaryStatsBody: document.querySelector("#binaryStatsBody"),
    calibrationBody: document.querySelector("#calibrationBody"),
    payoutRatioInput: document.querySelector("#payoutRatioInput"),
    testerReset: document.querySelector("#testerReset"),
    tradeNowBtn: document.querySelector("#tradeNowBtn"),
    closePaperBtn: document.querySelector("#closePaperBtn"),
    tradeResult: document.querySelector("#tradeResult"),
    tradeResultBody: document.querySelector("#tradeResultBody"),
    demoBalance: document.querySelector("#demoBalance"),
    demoEquity: document.querySelector("#demoEquity"),
    demoMarginUsed: document.querySelector("#demoMarginUsed"),
    demoFreeMargin: document.querySelector("#demoFreeMargin"),
    demoWinRate: document.querySelector("#demoWinRate"),
    demoTrades: document.querySelector("#demoTrades"),
    demoNetProfit: document.querySelector("#demoNetProfit"),
    demoResetBtn: document.querySelector("#demoResetBtn"),
    demoLeaderboardBody: document.querySelector("#demoLeaderboardBody"),
    demoHistoryList: document.querySelector("#demoHistoryList"),
    journalList: document.querySelector("#journalList"),
    clearJournalBtn: document.querySelector("#clearJournalBtn"),
    backtestSymbol: document.querySelector("#backtestSymbol"),
    backtestInterval: document.querySelector("#backtestInterval"),
    backtestStrategy: document.querySelector("#backtestStrategy"),
    backtestLookback: document.querySelector("#backtestLookback"),
    backtestPayout: document.querySelector("#backtestPayout"),
    backtestMode: document.querySelector("#backtestMode"),
    backtestFoldsWrap: document.querySelector("#backtestFoldsWrap"),
    backtestFolds: document.querySelector("#backtestFolds"),
    backtestRunBtn: document.querySelector("#backtestRunBtn"),
    backtestStatus: document.querySelector("#backtestStatus"),
    backtestSingleResults: document.querySelector("#backtestSingleResults"),
    backtestLeaderboardBody: document.querySelector("#backtestLeaderboardBody"),
    backtestBinaryBody: document.querySelector("#backtestBinaryBody"),
    backtestWalkForwardResults: document.querySelector("#backtestWalkForwardResults"),
    backtestWalkForwardRanges: document.querySelector("#backtestWalkForwardRanges"),
    backtestWalkForwardHead: document.querySelector("#backtestWalkForwardHead"),
    backtestWalkForwardBody: document.querySelector("#backtestWalkForwardBody"),
    rollingStrategySelect: document.querySelector("#rollingStrategySelect"),
    rollingPerformanceBody: document.querySelector("#rollingPerformanceBody")
};

const market = new UnifiedMarketDataService(state.symbol, state.interval, state.maxCandles, state.assetClass);
const ctx = elements.chart.getContext("2d");
const tester = new StrategyTester(Object.keys(STRATEGIES));
const binaryTracker = new BinaryOutcomeTracker(Object.keys(STRATEGIES));

market.onStatus((status) => {
    elements.status.textContent = status;
    elements.status.dataset.status = status.toLowerCase().replace(/\s+/g, "-");
});

market.onTick((candle) => {
    updatePrice(candle.close);
    checkPaperStops(candle.close);
    renderPaperAccount(candle.close);
    demo.markToMarket({ [state.symbol]: candle.close });
    renderDemoAccount();
});

market.onCandle((candle) => {
    upsertCandle(candle);
    const signal = generateSignal(state.candles, state.strategy, signalContext());
    renderSignal(signal);
    drawChart();
    recordSignal(signal);
    maybeExecute(signal);
    tester.onCandle(state.candles);
    renderTester();
    binaryTracker.onCandle(state.candles);
    renderBinaryStats();
});

function signalContext() {
    return { higherTrend: state.higherTrend.trend };
}

elements.autoTrade.addEventListener("change", () => {
    setExecutionStatus(elements.autoTrade.checked ? "Auto mode armed" : "Manual mode");
});

elements.pairSelect.addEventListener("change", () => {
    loadSelectedMarket();
});

elements.strategySelect.addEventListener("change", () => {
    state.strategy = elements.strategySelect.value;
    const signal = generateSignal(state.candles, state.strategy, signalContext());
    renderSignal(signal);
    recordSignal(signal);
    setExecutionStatus(`${STRATEGIES[state.strategy]?.label ?? "Strategy"} active`);
});

elements.clearHistory.addEventListener("click", () => {
    state.history = [];
    renderHistory();
    clearDemoHistory();
    renderDemoAccount();
});

elements.testerReset?.addEventListener("click", () => {
    tester.reset();
    renderTester();
    binaryTracker.reset();
    renderBinaryStats();
});

elements.payoutRatioInput?.addEventListener("change", () => {
    renderBinaryStats();
});

elements.backtestRunBtn?.addEventListener("click", () => {
    runBacktestFromUi();
});

elements.backtestMode?.addEventListener("change", () => {
    const isWalkForward = elements.backtestMode.value === "walkforward";
    if (elements.backtestFoldsWrap) elements.backtestFoldsWrap.hidden = !isWalkForward;
});

elements.rollingStrategySelect?.addEventListener("change", () => {
    renderRollingPerformance();
});

elements.demoResetBtn?.addEventListener("click", () => {
    const confirmed = window.confirm("Reset the Demo Account back to $10,000? This clears balance, trade history, and the journal.");
    if (!confirmed) return;
    demo.reset();
    state.paper.demoId = null;
    renderDemoAccount();
});

elements.clearJournalBtn?.addEventListener("click", () => {
    clearJournal();
    renderJournal(elements.journalList);
});

elements.tradeNowBtn?.addEventListener("click", async () => {
    const signal = generateSignal(state.candles, state.strategy, signalContext());
    if (!signal.ready) {
        setExecutionStatus("Not enough candles yet");
        return;
    }
    if (signal.type === "HOLD") {
        setExecutionStatus("Signal is HOLD — no trade placed");
        showTradeResult({ status: "skipped", reason: "Signal is HOLD" });
        return;
    }
    await executeManualTrade(signal);
});

elements.closePaperBtn?.addEventListener("click", () => {
    const price = state.candles.at(-1)?.close;
    const outcome = closePaperPositionManually(state.paper, price, { closePosition });
    if (!outcome) {
        setExecutionStatus("No open position to close");
        return;
    }
    renderPaperAccount(price);
    renderDemoAccount();
    const { pnl, closedSide } = outcome;
    const msg = `Closed ${closedSide} — P/L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`;
    setExecutionStatus(msg);
    showTradeResult({ status: "closed", reason: msg });
    appendAction({ type: "CLOSE", confidence: 0, price, action: msg });
});

async function init() {
    updateMarketFromSelection();
    await loadMarket();
    await refreshHigherTimeframeTrend();
    startHtfRefreshTimer();
}

async function loadSelectedMarket() {
    elements.autoTrade.checked = false;
    updateMarketFromSelection();
    resetPaperAccount();
    await loadMarket();
    await refreshHigherTimeframeTrend();
    setExecutionStatus("Market switched, auto disabled");
}

function startHtfRefreshTimer() {
    window.clearInterval(state.htfTimer);
    state.htfTimer = window.setInterval(refreshHigherTimeframeTrend, HTF_REFRESH_MS);
}

async function refreshHigherTimeframeTrend() {
    state.higherTrend = await getHigherTimeframeTrend(state.apiSymbol, state.assetClass);
    renderHtfTrend();

    // Re-render the current signal so HTF-gated strategies pick up the fresh
    // bias immediately instead of waiting for the next closed candle.
    if (state.candles.length) {
        renderSignal(generateSignal(state.candles, state.strategy, signalContext()));
    }
}

function renderHtfTrend() {
    if (!elements.htfTrend) return;
    const { trend, ready } = state.higherTrend;
    elements.htfTrend.textContent = ready ? trend : "Loading";
    elements.htfTrend.dataset.trend = trend.toLowerCase();
}

async function loadMarket() {
    try {
        market.disconnect();
        elements.status.textContent = "Loading candles";
        state.candles = [];
        drawChart();
        market.setMarket(state.symbol, state.interval, state.assetClass);
        tester.setSymbol(state.apiSymbol);
        renderTester();
        binaryTracker.setSymbol(state.apiSymbol, state.assetClass);
        renderBinaryStats();
        state.candles = await market.getCandles(state.symbol, state.interval, state.maxCandles, state.assetClass);
        renderSignal(generateSignal(state.candles, state.strategy, signalContext()));
        drawChart();
        renderPaperAccount(state.candles.at(-1)?.close);
        market.connect();
    } catch (error) {
        elements.status.textContent = "Data error";
        elements.reason.textContent = error.message;
    }
}

function updateMarketFromSelection() {
    const selectedPair = elements.pairSelect.selectedOptions[0];
    const resolved = resolveMarketSelection({
        symbolValue: elements.pairSelect.value,
        apiSymbolAttr: selectedPair?.dataset.apiSymbol,
        assetClassAttr: selectedPair?.dataset.assetClass,
        interval: state.interval
    });
    state.symbol = resolved.symbol;
    state.apiSymbol = resolved.apiSymbol;
    state.assetClass = resolved.assetClass;
    state.strategy = elements.strategySelect.value;
    elements.marketLabel.textContent = resolved.marketLabel;
}

// Module-8-era candle buffer logic now lives in core/candleBuffer.js; this
// is a thin wrapper supplying app.js's `state` around the pure version.
function upsertCandle(candle) {
    state.candles = upsertCandleCore(state.candles, candle, state.maxCandles);
}

// Probability Engine display: buy/wait/sell always sum to 100% by
// construction (see ai/probabilityEngine.js), so this just renders
// whatever three numbers came back - no additional math here.
function renderProbabilityBreakdown(probabilities) {
    const { buyProbability = 0, waitProbability = 1, sellProbability = 0 } = probabilities ?? {};
    const buyPct = Math.round(buyProbability * 100);
    const waitPct = Math.round(waitProbability * 100);
    const sellPct = Math.round(sellProbability * 100);

    if (elements.probBuy) elements.probBuy.textContent = `${buyPct}%`;
    if (elements.probWait) elements.probWait.textContent = `${waitPct}%`;
    if (elements.probSell) elements.probSell.textContent = `${sellPct}%`;

    if (elements.probBuyFill) elements.probBuyFill.style.width = `${buyPct}%`;
    if (elements.probWaitFill) elements.probWaitFill.style.width = `${waitPct}%`;
    if (elements.probSellFill) elements.probSellFill.style.width = `${sellPct}%`;
}

function renderSignal(signal) {
    elements.signal.textContent = signal.type;
    elements.signal.dataset.signal = signal.type.toLowerCase();
    elements.confidence.textContent = `${signal.confidence ?? 0}%`;
    document.documentElement.style.setProperty("--confidence-fill", `${signal.confidence ?? 0}%`);
    elements.reason.textContent = signal.reason;
    elements.candleCount.textContent = String(state.candles.length);
    updatePrice(signal.price);

    renderProbabilityBreakdown(signal.probabilities);

    elements.support.textContent = formatPrice(signal.support);
    elements.resistance.textContent = formatPrice(signal.resistance);
    elements.rsi.textContent = formatNumber(signal.indicators?.rsi);
    elements.adx.textContent = formatNumber(signal.indicators?.adx);
    elements.macd.textContent = formatNumber(signal.indicators?.macd, 4);
    elements.pattern.textContent = signal.indicators?.pattern ?? "none";
    elements.strategyName.textContent = signal.strategy ?? STRATEGIES[state.strategy]?.label ?? "Balanced";
    elements.quality.textContent = signal.quality ?? "--";
    elements.quality.dataset.quality = (signal.quality ?? "low").toLowerCase();
    elements.volatility.textContent = Number.isFinite(signal.indicators?.atrPercent)
        ? `${formatNumber(signal.indicators.atrPercent, 2)}%`
        : "--";
    elements.volumeRatio.textContent = Number.isFinite(signal.indicators?.volumeRatio)
        ? `${formatNumber(signal.indicators.volumeRatio, 2)}x`
        : "--";

    if (elements.entryPrice) {
        elements.entryPrice.textContent = signal.risk ? formatPrice(signal.risk.entry) : "--";
    }
    if (elements.stopLoss) {
        elements.stopLoss.textContent = signal.risk ? formatPrice(signal.risk.stopLoss) : "--";
    }
    if (elements.takeProfit1) {
        elements.takeProfit1.textContent = signal.risk ? formatPrice(signal.risk.takeProfit1) : "--";
    }
    if (elements.takeProfit) {
        elements.takeProfit.textContent = signal.risk ? formatPrice(signal.risk.takeProfit2) : "--";
    }
    if (elements.riskReward) {
        elements.riskReward.textContent = signal.risk ? signal.risk.rrLabel : "--";
    }

    renderDecisionChecklist(signal);
}

// Item 15 (Decision Checklist): a plain-language readout of what the signal
// engine is actually seeing, driven by the same indicators it scores on —
// not a separate calculation, so it can't drift out of sync with the signal.
function renderDecisionChecklist(signal) {
    const container = document.querySelector("#decisionChecklist");
    if (!container) return;

    const indicators = signal.indicators ?? {};
    const items = [];

    if (indicators.higherTrend) {
        const trend = indicators.higherTrend;
        items.push({
            status: trend === "UP" ? "ok" : trend === "DOWN" ? "bad" : "warn",
            icon: trend === "UP" ? "✓" : trend === "DOWN" ? "✕" : "⚠",
            text: `Daily Trend: ${trend}`
        });
    } else {
        items.push({ status: "neutral", icon: "•", text: "Daily Trend — not used by this strategy" });
    }

    if (Number.isFinite(indicators.ema20) && Number.isFinite(indicators.ema50)) {
        const bullish = indicators.ema20 > indicators.ema50;
        items.push({
            status: bullish ? "ok" : "bad",
            icon: bullish ? "✓" : "✕",
            text: `EMA20 ${bullish ? ">" : "<"} EMA50`
        });
    } else {
        items.push({ status: "neutral", icon: "•", text: "EMA20 / EMA50 — collecting candles" });
    }

    if (Number.isFinite(indicators.volumeRatio)) {
        const ratio = indicators.volumeRatio;
        const status = ratio >= 1.15 ? "ok" : ratio < 0.75 ? "bad" : "warn";
        items.push({
            status,
            icon: status === "ok" ? "✓" : status === "bad" ? "✕" : "⚠",
            text: `Volume ${formatNumber(ratio, 2)}x average`
        });
    } else {
        items.push({ status: "neutral", icon: "•", text: "Volume — collecting candles" });
    }

    if (Number.isFinite(indicators.adx)) {
        const adx = indicators.adx;
        const status = adx >= 25 ? "ok" : adx < 18 ? "bad" : "warn";
        items.push({
            status,
            icon: status === "ok" ? "✓" : status === "bad" ? "✕" : "⚠",
            text: `ADX ${formatNumber(adx, 1)} ${adx >= 25 ? "above" : "below"} 25`
        });
    } else {
        items.push({ status: "neutral", icon: "•", text: "ADX — collecting candles" });
    }

    if (Number.isFinite(indicators.rsi)) {
        const rsi = indicators.rsi;
        let status = "ok";
        let label = `RSI neutral (${formatNumber(rsi, 1)})`;
        if (rsi >= 65) {
            status = "warn";
            label = `RSI near overbought (${formatNumber(rsi, 1)})`;
        } else if (rsi <= 35) {
            status = "warn";
            label = `RSI near oversold (${formatNumber(rsi, 1)})`;
        }
        items.push({ status, icon: status === "ok" ? "✓" : "⚠", text: label });
    } else {
        items.push({ status: "neutral", icon: "•", text: "RSI — collecting candles" });
    }

    container.innerHTML = items.map(item => `
        <div class="check ${item.status}">
            <span class="check-icon">${item.icon}</span>
            <span>${item.text}</span>
        </div>
    `).join("");
}

function updatePrice(price) {
    elements.price.textContent = formatPrice(price);
}

function recordSignal(signal) {
    state.history.unshift({
        time: new Date(),
        type: signal.type,
        confidence: signal.confidence,
        price: signal.price,
        reason: signal.reason,
        action: signal.strategy
    });

    state.history = state.history.slice(0, 30);
    renderHistory();
}

async function maybeExecute(signal) {
    const settings = getTradeSettings();
    const decision = decideExecution(signal, settings, {
        isCoolingDown: isCoolingDown(settings.cooldownSeconds),
        paperPnl: getPaperPnl(signal.price)
    });

    if (decision.action === "skip") {
        if (decision.disableAutoTrade) elements.autoTrade.checked = false;
        setExecutionStatus(decision.statusMessage);
        return;
    }

    state.lastTradeAt = Date.now();

    if (decision.action === "paper") {
        const result = executePaperTrade(signal, resolveQuantity(signal, settings));
        appendAction(result);
        setExecutionStatus(result.action);
        return;
    }

    try {
        setExecutionStatus("Sending order request");
        const result = await sendTrade(signal, settings, resolveQuantity(signal, settings));
        appendAction({
            type: signal.type,
            price: signal.price,
            confidence: signal.confidence,
            action: `${result.status}: ${result.reason ?? result.side ?? "order response"}`
        });
        setExecutionStatus(result.status);
    } catch (error) {
        appendAction({
            type: signal.type,
            price: signal.price,
            confidence: signal.confidence,
            action: `Error: ${error.message}`
        });
        setExecutionStatus("Trade request failed");
    }
}

async function executeManualTrade(signal) {
    const settings = getTradeSettings();

    elements.tradeNowBtn.disabled = true;
    elements.tradeNowBtn.textContent = "Placing...";

    try {
        const quantity = resolveQuantity(signal, settings);

        if (settings.mode === "paper") {
            const result = executePaperTrade(signal, quantity);
            state.lastTradeAt = Date.now();
            appendAction(result);
            setExecutionStatus(`Manual: ${result.action}`);
            showTradeResult({
                status: "paper",
                side: signal.type.toLowerCase(),
                price: signal.price,
                reason: result.action,
                quantity,
                stopLoss: signal.risk?.stopLoss,
                takeProfit: signal.risk?.takeProfit
            });
        } else {
            setExecutionStatus("Sending manual order");
            const result = await sendTrade(signal, settings, quantity);
            state.lastTradeAt = Date.now();
            appendAction({
                type: signal.type,
                price: signal.price,
                confidence: signal.confidence,
                action: `Manual ${result.status}: ${result.reason ?? result.side ?? "ok"}`
            });
            setExecutionStatus(`Manual: ${result.status}`);
            showTradeResult(result);
        }
    } catch (error) {
        setExecutionStatus(`Manual trade error: ${error.message}`);
        showTradeResult({ status: "error", reason: error.message });
    } finally {
        elements.tradeNowBtn.disabled = false;
        elements.tradeNowBtn.textContent = "Trade Now";
    }
}

function showTradeResult(result) {
    if (!elements.tradeResult || !elements.tradeResultBody) return;
    const statusClass = result.status === "error" ? "tr-error"
        : result.status === "skipped" ? "tr-skip"
        : result.status === "blocked" ? "tr-skip"
        : result.status === "closed" ? "tr-close"
        : result.side === "buy" || result.status === "paper" ? "tr-buy"
        : "tr-sell";
    elements.tradeResultBody.innerHTML = `
        <span class="tr-badge ${statusClass}">${(result.status ?? "—").toUpperCase()}</span>
        ${result.side ? `<span class="tr-side">${result.side.toUpperCase()}</span>` : ""}
        ${result.price ? `<span class="tr-price">${formatPrice(result.price)}</span>` : ""}
        ${result.quantity ? `<span class="tr-qty">Qty ${result.quantity}</span>` : ""}
        ${Number.isFinite(result.stopLoss) ? `<span class="tr-stop">SL ${formatPrice(result.stopLoss)}</span>` : ""}
        ${Number.isFinite(result.takeProfit) ? `<span class="tr-target">TP ${formatPrice(result.takeProfit)}</span>` : ""}
        <span class="tr-reason">${result.reason ?? ""}</span>
    `;
    elements.tradeResult.hidden = false;
}

function getTradeSettings() {
    const checkedMode = document.querySelector("input[name='tradeMode']:checked");

    return {
        autoTrade: elements.autoTrade.checked,
        mode: checkedMode?.value ?? "dry-run",
        quantity: Math.max(Number(elements.tradeSize.value) || 0, 0),
        maxLoss: Math.max(Number(elements.maxLoss.value) || 0, 0),
        cooldownSeconds: Math.max(Number(elements.cooldown.value) || 0, 0),
        minConfidence: Math.min(Math.max(Number(elements.minConfidence.value) || 1, 1), 100),
        useRiskSizing: Boolean(elements.useRiskSizing?.checked),
        accountSize: Math.max(Number(elements.accountSize?.value) || 0, 0),
        riskPercent: Math.min(Math.max(Number(elements.riskPercent?.value) || 0, 0), 100)
    };
}

// Module 8 (Position Sizing), stop/target enforcement, and position
// mutation itself now live in core/paperTrading.js; these are thin
// wrappers that supply app.js's state/DOM side effects (rendering,
// status text, toasts, action log) around the pure logic there.
function isCoolingDown(cooldownSeconds) {
    return isCoolingDownCore(state.lastTradeAt, cooldownSeconds);
}

function calculatePositionPnl(markPrice) {
    return calculatePositionPnlCore(state.paper, markPrice);
}

function executePaperTrade(signal, quantity) {
    const result = executePaperTradeCore(state.paper, signal, quantity, {
        symbol: state.symbol,
        strategyLabel: STRATEGIES[state.strategy]?.label ?? state.strategy,
        openPosition,
        closePosition
    });
    renderPaperAccount(signal.price);
    renderDemoAccount();
    return result;
}

// Module 7 in action: the paper account enforces the ATR stop-loss and
// R-multiple take-profit automatically on every tick, so the risk levels
// shown in the signal panel aren't just informational for paper mode.
function checkPaperStops(markPrice) {
    const outcome = checkPaperStopsCore(state.paper, markPrice, { closePosition });
    if (!outcome) return;

    renderPaperAccount(markPrice);
    renderDemoAccount();

    const { label, pnl, closedSide } = outcome;
    const msg = `${label} on ${closedSide} — P/L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`;
    setExecutionStatus(msg);
    showTradeResult({ status: "closed", reason: msg, price: markPrice });
    appendAction({ type: "CLOSE", confidence: 0, price: markPrice, action: msg });
}

function resetPaperAccount() {
    resetPaperAccountCore(state.paper, state.candles.at(-1)?.close ?? state.paper.entry, { closePosition });
    state.lastTradeAt = 0;
    renderPaperAccount();
    renderDemoAccount();
}

async function sendTrade(signal, settings, quantity = settings.quantity) {
    // Dev talks straight to the backend's /trade route; production goes
    // through the /api/trade Vercel proxy (no /trade suffix there).
    const tradeUrl = import.meta.env.DEV ? `${API_URL}/trade` : `${API_URL}/api/trade`;
    const response = await fetch(tradeUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            signal,
            symbol: state.apiSymbol,
            quantity,
            mode: settings.mode,
            stopLoss: signal.risk?.stopLoss ?? null,
            takeProfit: signal.risk?.takeProfit ?? null
        })
    });

    if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
    }

    return response.json();
}

function appendAction(item) {
    state.history.unshift({
        time: new Date(),
        type: item.type,
        confidence: item.confidence,
        price: item.price,
        reason: item.action,
        action: "Trade"
    });

    state.history = state.history.slice(0, 30);
    renderHistory();
}

function renderTester() {
    renderTesterCore(elements, tester);
}

// Milestone: binary-mode outcome tracking. Every number here comes from a
// real resolved bet (a real entry price compared against a real exit price
// N candles later) - buckets under the tracker's minimum sample size show
// "not enough data" instead of a percentage, rather than displaying a
// number that looks calibrated when it isn't.
function renderBinaryStats() {
    renderBinaryStatsCore(elements, binaryTracker, state.interval);
}

function renderCalibrationCurve() {
    renderCalibrationCurveCore(elements, binaryTracker);
}

// Historical backtest: fetches paginated real history, then replays it
// walk-forward through generateSignal() with no lookahead. Fully separate
// from `market`/`tester`/`binaryTracker` above - it never touches live
// streaming state or the live Strategy Lab's persisted trades.
let backtestRunning = false;
let lastBacktestResult = null; // holds the most recent single-run result so the rolling-performance selector can re-render without re-running the backtest

async function runBacktestFromUi() {
    if (backtestRunning || !elements.backtestRunBtn) return;

    const symbol = elements.backtestSymbol?.value ?? "btcusdt";
    const backtestAssetClass = elements.backtestSymbol?.selectedOptions[0]?.dataset.assetClass ?? "crypto";
    const interval = elements.backtestInterval?.value ?? "1m";
    const strategyChoice = elements.backtestStrategy?.value ?? "all";
    const strategyIds = strategyChoice === "all" ? Object.keys(STRATEGIES) : [strategyChoice];
    const total = Number(elements.backtestLookback?.value ?? 1000);
    const payoutRatio = clampPayoutRatio(elements.backtestPayout?.value);
    const isWalkForward = elements.backtestMode?.value === "walkforward";
    const folds = Number(elements.backtestFolds?.value ?? 4);

    backtestRunning = true;
    elements.backtestRunBtn.disabled = true;
    elements.backtestRunBtn.textContent = "Fetching...";
    setBacktestStatus(`Fetching ${total.toLocaleString()} historical ${interval} candles for ${symbol.toUpperCase()}...`);

    try {
        const candles = await market.getHistoricalCandles(symbol, interval, { total }, backtestAssetClass);

        if (!candles.length) {
            setBacktestStatus("No historical candles came back for that pair/interval — try a different one.");
            return;
        }

        elements.backtestRunBtn.textContent = "Running...";

        // Fetch daily candles too, but only if a selected strategy actually
        // uses the higher-timeframe filter - no point paying for an extra
        // fetch otherwise. Without this, useHigherTimeframe strategies were
        // silently backtested with that filter disabled (see backtestEngine.js).
        const needsHtf = strategyIds.some((id) => STRATEGIES[id]?.useHigherTimeframe);
        let dailyCandles = null;
        if (needsHtf) {
            try {
                dailyCandles = await market.getHistoricalCandles(symbol, "1d", { total: 260 }, backtestAssetClass);
            } catch (error) {
                console.warn("Could not fetch daily candles for HTF filter, continuing without it:", error.message);
            }
        }

        const sharedOptions = {
            strategyIds,
            payoutRatio,
            dailyCandles,
            // Without this, the backtest scored trades off raw candle
            // prices - no spread, slippage, or fees - while the paper
            // engine's numbers for the same strategy always included
            // them. Passing the asset class here makes the two directly
            // comparable again (see executionCosts.js).
            assetClass: backtestAssetClass
        };

        if (isWalkForward) {
            if (candles.length < folds * 2) {
                setBacktestStatus(`Need at least ${folds * 2} candles for ${folds} folds — pick a larger lookback or fewer folds.`);
                return;
            }
            const result = await runWalkForwardBacktest(candles, { ...sharedOptions, folds });
            renderWalkForwardResults(result, interval);

            setBacktestStatus(
                `Done — ${folds} folds across ${candles.length.toLocaleString()} candles. `
                + `Check the "Folds +" column below for consistency, not just the aggregate total.`
            );
        } else {
            const result = await runBacktest(candles, {
                ...sharedOptions,
                onProgress: (done, runTotal) => {
                    setBacktestStatus(`Replaying candle ${done.toLocaleString()} / ${runTotal.toLocaleString()}...`);
                }
            });

            renderBacktestResults(result, interval);

            const from = new Date(result.meta.from).toLocaleString();
            const to = new Date(result.meta.to).toLocaleString();
            setBacktestStatus(
                `Done — ${result.meta.candleCount.toLocaleString()} candles (${from} → ${to}), `
                + `${result.meta.spotTrades} spot trades, ${result.meta.binaryTradesResolved} binary bets resolved`
                + (result.meta.binaryTradesDropped ? `, ${result.meta.binaryTradesDropped} still pending past the last candle` : "")
                + "."
            );
        }
    } catch (error) {
        setBacktestStatus(`Backtest failed: ${error.message}`);
    } finally {
        backtestRunning = false;
        elements.backtestRunBtn.disabled = false;
        elements.backtestRunBtn.textContent = "Run Backtest";
    }
}

function setBacktestStatus(message) {
    if (elements.backtestStatus) elements.backtestStatus.textContent = message;
}

function renderBacktestResults(result, interval) {
    if (elements.backtestSingleResults) elements.backtestSingleResults.hidden = false;
    if (elements.backtestWalkForwardResults) elements.backtestWalkForwardResults.hidden = true;

    lastBacktestResult = result;
    populateRollingStrategySelect(result);
    renderRollingPerformance();

    renderBacktestResultsCore(elements, result, interval);
}

// Renders the walk-forward result set: one column per fold plus a
// "Folds +" consistency count, so a strategy whose aggregate PnL is
// really just one outlier fold is visible at a glance rather than
// buried inside a single summed number.
function renderWalkForwardResults(result, interval) {
    if (elements.backtestSingleResults) elements.backtestSingleResults.hidden = true;
    if (elements.backtestWalkForwardResults) elements.backtestWalkForwardResults.hidden = false;

    lastBacktestResult = null; // rolling-performance table only applies to single runs

    renderWalkForwardResultsCore(elements, result);
}

function populateRollingStrategySelect(result) {
    if (!elements.rollingStrategySelect) return;
    const previous = elements.rollingStrategySelect.value;
    const strategyIds = Object.keys(result.spotTradesByStrategy ?? {});

    elements.rollingStrategySelect.innerHTML = strategyIds
        .map((id) => {
            const label = result.spotLeaderboard.find((row) => row.strategy === id)?.label ?? id;
            const tradeCount = result.spotTradesByStrategy[id]?.length ?? 0;
            return `<option value="${id}">${label} (${tradeCount} trades)</option>`;
        })
        .join("");

    // Keep the previously selected strategy if it's still in the new list.
    if (strategyIds.includes(previous)) elements.rollingStrategySelect.value = previous;
}

// Rolling performance is trade-count-windowed, not calendar-time-windowed
// - a strategy that only fires occasionally would have near-empty
// calendar windows. windowSize/step are picked relative to how many
// trades this run actually produced, so short backtests still show
// *something* useful instead of an empty "not enough data" table.
function renderRollingPerformance() {
    if (!elements.rollingPerformanceBody) return;

    if (!lastBacktestResult || !elements.rollingStrategySelect?.value) {
        elements.rollingPerformanceBody.innerHTML = `<tr><td class="empty-history" colspan="3">Run a single backtest first (rolling performance isn't shown for walk-forward runs — each fold is already its own window).</td></tr>`;
        return;
    }

    const strategyId = elements.rollingStrategySelect.value;
    const trades = lastBacktestResult.spotTradesByStrategy[strategyId] ?? [];

    // Pick a window size that's roughly 1/5th of the sample (min 10, max
    // 50) so short runs still produce a handful of windows instead of
    // none, while long runs don't get one enormous window.
    const windowSize = Math.max(10, Math.min(50, Math.floor(trades.length / 5)));
    const step = Math.max(1, Math.floor(windowSize / 2));

    const windows = computeRollingPerformance(trades, windowSize, step);

    if (!windows.length) {
        elements.rollingPerformanceBody.innerHTML = `<tr><td class="empty-history" colspan="3">Not enough trades for this strategy yet (need at least ${windowSize} — try a longer lookback)</td></tr>`;
        return;
    }

    elements.rollingPerformanceBody.innerHTML = windows.map((w) => `
        <tr>
            <td>${w.startIndex + 1}–${w.endIndex + 1}</td>
            <td data-pnl="${w.totalPnl < 0 ? "loss" : w.totalPnl > 0 ? "gain" : "flat"}">${formatSigned(w.totalPnl)}%</td>
            <td>${formatNumber(w.winRate, 1)}%</td>
        </tr>
    `).join("");
}

function renderStatStrip() {
    if (elements.statSignalsCount) {
        elements.statSignalsCount.textContent = String(state.history.length);
    }

    const acc = demo.get();

    if (elements.statOpenTrades) {
        elements.statOpenTrades.textContent = String(acc.trades.length);
    }

    if (elements.statAccountBalance) {
        elements.statAccountBalance.textContent = `$${formatCurrency(acc.balance)}`;
    }

    if (elements.statAccountBalanceSub) {
        const startingBalance = 10000;
        const pctChange = startingBalance > 0
            ? ((acc.balance - startingBalance) / startingBalance) * 100
            : 0;
        elements.statAccountBalanceSub.textContent =
            `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}% since reset`;
    }
}

function renderHistory() {
    if (!state.history.length) {
        elements.historyList.innerHTML = `<div class="empty-history">No signals yet</div>`;
        return;
    }

    elements.historyList.innerHTML = state.history.map(item => `
        <div class="history-row">
            <time>${item.time.toLocaleTimeString()}</time>
            <strong data-signal="${item.type.toLowerCase()}">${item.type}</strong>
            <span>${item.confidence}%</span>
            <span>${formatPrice(item.price)}</span>
            <small>${item.action}: ${item.reason}</small>
        </div>
    `).join("");


    renderStatStrip();
}

function renderPaperAccount(markPrice) {
    const pnl = getPaperPnl(markPrice);

    elements.paperPosition.textContent = state.paper.side
        ? `${state.paper.side.toUpperCase()} ${state.paper.quantity}`
        : "Flat";
    elements.paperEntry.textContent = formatPrice(state.paper.entry);
    elements.paperPnl.textContent = formatCurrency(pnl);
    elements.paperPnl.dataset.pnl = pnl < 0 ? "loss" : pnl > 0 ? "gain" : "flat";

    if (elements.paperStop) elements.paperStop.textContent = formatPrice(state.paper.stopLoss);
    if (elements.paperTarget) elements.paperTarget.textContent = formatPrice(state.paper.takeProfit);
}

// The persisted "real" account: balance/equity/margin/win-rate driven by
// every demo trade you actually take, independent of whatever the paper
// simulator above is doing tick to tick.
function renderDemoAccount() {
    const acc = demo.get();

    renderStatStrip();

    if (elements.demoBalance) elements.demoBalance.textContent = `$${formatCurrency(acc.balance)}`;
    if (elements.demoEquity) elements.demoEquity.textContent = `$${formatCurrency(acc.equity)}`;
    if (elements.demoMarginUsed) elements.demoMarginUsed.textContent = `$${formatCurrency(acc.marginUsed)}`;
    if (elements.demoFreeMargin) elements.demoFreeMargin.textContent = `$${formatCurrency(demo.getFreeMargin())}`;
    if (elements.demoWinRate) elements.demoWinRate.textContent = `${demo.getWinRate()}%`;
    if (elements.demoTrades) elements.demoTrades.textContent = String(demo.getTotalTrades());

    if (elements.demoNetProfit) {
        const net = demo.getNetProfit();
        elements.demoNetProfit.textContent = `${net >= 0 ? "+" : ""}$${formatCurrency(net)}`;
        elements.demoNetProfit.dataset.pnl = net < 0 ? "loss" : net > 0 ? "gain" : "flat";
    }

    renderDemoLeaderboard();
    renderHistoryTable(elements.demoHistoryList);
    renderJournal(elements.journalList);
}

function renderDemoLeaderboard() {
    if (!elements.demoLeaderboardBody) return;
    const rows = getStrategyLeaderboard();
    elements.demoLeaderboardBody.innerHTML = rows.length
        ? rows.map(row => `
            <tr>
                <td>${row.strategy}</td>
                <td>${row.trades}</td>
                <td>${formatNumber(row.winRate, 1)}%</td>
                <td data-pnl="${row.totalPnl < 0 ? "loss" : row.totalPnl > 0 ? "gain" : "flat"}">${formatSigned(row.totalPnl)}</td>
                <td>${formatSigned(row.avgPnl)}</td>
            </tr>
        `).join("")
        : `<tr><td colspan="5" class="empty-history">No closed demo trades yet</td></tr>`;
}

function getPaperPnl(markPrice) {
    return getPaperPnlCore(state.paper, markPrice);
}

function setExecutionStatus(message) {
    elements.executionStatus.textContent = message;
}

function drawChart() {
    drawChartOnCanvas(elements.chart, ctx, state.candles);
}

window.addEventListener("resize", drawChart);

elements.chartFullscreenBtn?.addEventListener("click", () => {
    const container = elements.chartFullscreenBtn.closest(".chart-container");
    if (!container) return;

    if (document.fullscreenElement) {
        document.exitFullscreen?.();
        return;
    }
    if (container.classList.contains("is-fullscreen-fallback")) {
        container.classList.remove("is-fullscreen-fallback");
        drawChart();
        return;
    }

    if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {
            container.classList.add("is-fullscreen-fallback");
            drawChart();
        });
    } else {
        container.classList.add("is-fullscreen-fallback");
        drawChart();
    }
});

document.addEventListener("fullscreenchange", () => {
    const container = document.querySelector(".chart-container");
    if (!container) return;
    if (document.fullscreenElement === container) {
        elements.chartFullscreenBtn?.setAttribute("title", "Exit fullscreen");
    } else {
        elements.chartFullscreenBtn?.setAttribute("title", "Fullscreen");
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const fallback = document.querySelector(".chart-container.is-fullscreen-fallback");
        if (fallback) {
            fallback.classList.remove("is-fullscreen-fallback");
            drawChart();
        }
    }
});

renderHistory();
renderTester();
renderBinaryStats();
renderDemoAccount();
init();
