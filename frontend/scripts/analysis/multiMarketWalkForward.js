#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { fetchCandles } from "../scheduler/candles.js";
import { runWalkForwardBacktest } from "../../src/js/analysis/backtestEngine.js";
import { STRATEGIES } from "../../src/js/signals/signalEngine.js";
import { config } from "../scheduler/config.js";

const MARKETS = [
    { symbol: "BTC/USDT", assetClass: "crypto" },
    { symbol: "ETH/USDT", assetClass: "crypto" },
    { symbol: "EUR/USD", assetClass: "forex" },
    { symbol: "GBP/USD", assetClass: "forex" }
];

const TIMEFRAMES = ["1m", "5m", "15m"];
const DAILY_CONTEXT_CANDLES = 300;

const DEFAULTS = {
    // --limit means SCORED candles; the runner fetches limit + warmup.
    limit: 1000,
    folds: 3,
    warmupCandles: 320,
    maxHoldCandles: config.maxHoldCandles,
    markets: MARKETS.map((market) => market.symbol),
    timeframes: TIMEFRAMES,
    output: "reports/analysis/multi-market-walk-forward.json"
};

function parseArgs(argv) {
    const args = { ...DEFAULTS };

    for (let i = 0; i < argv.length; i += 1) {
        switch (argv[i]) {
            case "--limit": args.limit = Number(argv[++i]); break;
            case "--folds": args.folds = Number(argv[++i]); break;
            case "--warmup":
            case "--warmupCandles": args.warmupCandles = Number(argv[++i]); break;
            case "--maxHoldCandles": args.maxHoldCandles = Number(argv[++i]); break;
            case "--markets": args.markets = argv[++i].split(",").map((symbol) => symbol.trim()).filter(Boolean); break;
            case "--timeframes": args.timeframes = argv[++i].split(",").map((timeframe) => timeframe.trim()).filter(Boolean); break;
            case "--output": args.output = argv[++i]; break;
            default: break;
        }
    }

    if (!Number.isInteger(args.limit) || args.limit < 100) {
        throw new Error("--limit must be an integer >= 100");
    }
    if (!Number.isInteger(args.folds) || args.folds < 2) {
        throw new Error("--folds must be an integer >= 2");
    }
    if (!Number.isInteger(args.warmupCandles) || args.warmupCandles < 0) {
        throw new Error("--warmupCandles must be >= 0");
    }
    if (!Number.isInteger(args.maxHoldCandles) || args.maxHoldCandles < 1) {
        throw new Error("--maxHoldCandles must be an integer >= 1");
    }
    if (!args.markets.length || !args.markets.every((symbol) => MARKETS.some((market) => market.symbol === symbol))) {
        throw new Error(`--markets must contain configured symbols: ${MARKETS.map((market) => market.symbol).join(", ")}`);
    }
    if (!args.timeframes.length || !args.timeframes.every((timeframe) => TIMEFRAMES.includes(timeframe))) {
        throw new Error(`--timeframes must contain configured timeframes: ${TIMEFRAMES.join(", ")}`);
    }

    return args;
}

function assertCandlesValid(candles, expectedMinimum, label) {
    if (!Array.isArray(candles)) {
        throw new Error(`${label}: candle response is not an array`);
    }
    if (candles.length < expectedMinimum) {
        throw new Error(
            `${label}: expected at least ${expectedMinimum} candles, received ${candles.length}`
        );
    }

    for (let i = 0; i < candles.length; i += 1) {
        const candle = candles[i];
        if (
            !Number.isFinite(candle.time) || !Number.isFinite(candle.open) ||
            !Number.isFinite(candle.high) || !Number.isFinite(candle.low) ||
            !Number.isFinite(candle.close)
        ) {
            throw new Error(`${label}: invalid candle at index ${i}`);
        }
        if (i > 0 && candle.time <= candles[i - 1].time) {
            throw new Error(`${label}: candles are not strictly chronological at index ${i}`);
        }
        if (
            candle.high < candle.low || candle.high < candle.open || candle.high < candle.close ||
            candle.low > candle.open || candle.low > candle.close
        ) {
            throw new Error(`${label}: invalid OHLC relationship at index ${i}`);
        }
    }
}

function isWeekendGap(previousTime, currentTime) {
    for (let time = previousTime + 86_400_000; time < currentTime; time += 86_400_000) {
        const day = new Date(time).getUTCDay();
        if (day !== 0 && day !== 6) return false;
    }
    return true;
}

function assertCandlesContinuous(candles, timeframe, label, assetClass) {
    const timeframeMs = {
        "1m": 60_000,
        "5m": 300_000,
        "15m": 900_000,
        "1h": 3_600_000,
        "1d": 86_400_000
    }[timeframe];
    if (!timeframeMs) throw new Error(`${label}: unsupported timeframe ${timeframe}`);

    for (let i = 1; i < candles.length; i += 1) {
        const gap = candles[i].time - candles[i - 1].time;
        if (gap !== timeframeMs && !(assetClass === "forex" && isWeekendGap(candles[i - 1].time, candles[i].time))) {
            throw new Error(
                `${label}: non-continuous timestamps between ${new Date(candles[i - 1].time).toISOString()} and ${new Date(candles[i].time).toISOString()} (gap ${gap}ms, expected ${timeframeMs}ms)`
            );
        }
    }
}

function summariseFoldResults(results, symbol, timeframe) {
    const rows = [];
    for (const fold of results.folds ?? []) {
        for (const row of fold.spotLeaderboard ?? []) {
            rows.push({
                symbol, timeframe, fold: fold.fold,
                strategy: row.strategy,
                label: row.label,
                // Not a genuine regime score — see buildRegimeScorecard for that.
                foldRepresentativeRegime: row.regime ?? "UNKNOWN",
                trades: row.trades ?? 0,
                winRate: row.winRate ?? null,
                totalPnl: row.totalPnl ?? null,
                expectancy: row.expectancy ?? null,
                profitFactor: row.profitFactor ?? null,
                sharpe: row.sharpe ?? null,
                sortino: row.sortino ?? null,
                maxDrawdown: row.maxDrawdown ?? null,
                profitable: Number.isFinite(row.totalPnl) && row.totalPnl > 0
            });
        }
    }
    return rows;
}

function flattenTrades(result, symbol, assetClass, timeframe) {
    const trades = [];
    for (const fold of result.folds ?? []) {
        const byStrategy = fold.spotTradesByStrategy ?? {};
        for (const [strategy, strategyTrades] of Object.entries(byStrategy)) {
            for (const trade of strategyTrades) {
                trades.push({
                    ...trade,
                    symbol, assetClass, timeframe, fold: fold.fold,
                    foldFrom: fold.from, foldTo: fold.to
                });
            }
        }
    }
    return trades;
}

async function runMarket({ symbol, assetClass, timeframe, limit, folds, warmupCandles, maxHoldCandles, dailyCandles }) {
    const fetchLimit = limit + warmupCandles;

    console.log(
        `\nFetching ${fetchLimit} ${timeframe} candles for ${symbol} ` +
        `(${warmupCandles} context + ${limit} scored)...`
    );

    const candles = await fetchCandles({ symbol, assetClass, timeframe, limit: fetchLimit });
    assertCandlesValid(candles, Math.min(fetchLimit, 100), `${symbol} ${timeframe}`);
    assertCandlesContinuous(candles, timeframe, `${symbol} ${timeframe}`, assetClass);

    if (candles.length < fetchLimit) {
        throw new Error(
            `${symbol} ${timeframe}: requested ${fetchLimit} candles but received ${candles.length}`
        );
    }

    console.log(`Running ${folds}-fold research backtest for ${symbol} ${timeframe}...`);

    const result = await runWalkForwardBacktest(candles, {
        folds,
        initialContextCandles: warmupCandles,
        warmupCandles,
        strategyIds: Object.keys(STRATEGIES),
        assetClass,
        costs: config.executionCosts?.[assetClass] ?? null,
        maxHoldCandles,
        ambiguousFillRule: config.ambiguousFillRule,
        entryFilters: {
            ...config.entryFilters,
            estimatedCostPct: config.executionCosts?.[assetClass]
                ? (config.executionCosts[assetClass].spreadPct + (2 * config.executionCosts[assetClass].slippagePct) + config.executionCosts[assetClass].feePct) * 100
                : 0
        },
        dailyCandles
    });

    return {
        symbol, assetClass, timeframe,
        from: candles[0].time,
        to: candles.at(-1).time,
        inputCandleCount: candles.length,
        scoredCandleCount: result.summary.totalScoredCandles,
        initialContextCandles: warmupCandles,
        foldCount: result.folds.length,
        folds: result.folds,
        rows: summariseFoldResults(result, symbol, timeframe),
        trades: flattenTrades(result, symbol, assetClass, timeframe),
        researchSummary: result.summary
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const results = [];

    const selectedMarkets = MARKETS.filter((market) => args.markets.includes(market.symbol));
    const selectedTimeframes = args.timeframes;
    const dailyCandlesBySymbol = new Map();

    console.log(`Markets: ${selectedMarkets.length}`);
    console.log(`Timeframes: ${selectedTimeframes.join(", ")}`);
    console.log(`Strategies: ${Object.keys(STRATEGIES).length}`);
    console.log(`Scored candles/market: ${args.limit}`);
    console.log(`Initial context: ${args.warmupCandles}`);
    console.log(`Folds: ${args.folds}`);

    for (const market of selectedMarkets) {
        try {
            console.log(`Fetching ${DAILY_CONTEXT_CANDLES} daily candles for ${market.symbol}...`);
            const dailyCandles = await fetchCandles({
                symbol: market.symbol,
                assetClass: market.assetClass,
                timeframe: "1d",
                limit: DAILY_CONTEXT_CANDLES
            });
            assertCandlesValid(dailyCandles, 200, `${market.symbol} 1d`);
            assertCandlesContinuous(dailyCandles, "1d", `${market.symbol} 1d`, market.assetClass);
            dailyCandlesBySymbol.set(market.symbol, dailyCandles);
        } catch (error) {
            console.error(`❌ ${market.symbol} 1d: ${error.message}`);
        }

        for (const timeframe of selectedTimeframes) {
            try {
                const dailyCandles = dailyCandlesBySymbol.get(market.symbol);
                if (!dailyCandles) throw new Error("daily context unavailable");
                const result = await runMarket({
                    ...market, timeframe,
                    limit: args.limit,
                    folds: args.folds,
                    warmupCandles: args.warmupCandles,
                    maxHoldCandles: args.maxHoldCandles,
                    dailyCandles
                });
                results.push(result);
                console.log(`✓ ${market.symbol} ${timeframe}: ${result.trades.length} closed spot trades`);
            } catch (error) {
                console.error(`❌ ${market.symbol} ${timeframe}: ${error.message}`);
                results.push({
                    symbol: market.symbol, assetClass: market.assetClass, timeframe,
                    error: error.message
                });
            }
        }
    }

    const outputPath = path.resolve(args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const successful = results.filter((result) => !result.error);
    const failed = results.filter((result) => result.error);

    const report = {
        generatedAt: new Date().toISOString(),
        researchMethod: "rolling-origin-out-of-sample-evaluation",
        optimizationPerformed: false,
        configuration: {
            markets: selectedMarkets,
            timeframes: selectedTimeframes,
            scoredCandlesPerMarket: args.limit,
            initialContextCandles: args.warmupCandles,
            downloadedCandlesPerMarket: args.limit + args.warmupCandles,
            folds: args.folds,
            maxHoldCandles: args.maxHoldCandles,
            ambiguousFillRule: config.ambiguousFillRule,
            entryFilters: config.entryFilters,
            strategies: Object.keys(STRATEGIES)
        },
        coverage: {
            requestedCombinations:
                selectedMarkets.length *
                selectedTimeframes.length,

            successfulCombinations:
                successful.length,

            failedCombinations:
                failed.length,

            completionPct:
                selectedMarkets.length *
                selectedTimeframes.length
                    ? (
                        successful.length /
                        (
                            selectedMarkets.length *
                            selectedTimeframes.length
                        )
                    ) * 100
                    : 0,

            failures:
                failed.map(
                    (result) => ({
                        symbol:
                            result.symbol,

                        timeframe:
                            result.timeframe,

                        error:
                            result.error
                    })
                )
        },
        dataQuality: {
            successfulCombinations:
                successful.length,

            failedCombinations:
                failed.length,

            allCombinationsComplete:
                failed.length === 0,

            allFoldsHaveFullWarmup:
                successful.every(
                    (result) =>
                        result.researchSummary
                            ?.allFoldsHaveFullWarmup ===
                        true
                ),

            allFoldsHaveHTFContext:
                successful.every(
                    (result) =>
                        result.researchSummary
                            ?.allFoldsHaveHTFContext ===
                        true
                )
            ,allFoldsHaveClosedHTFContext:
                successful.every(
                    (result) =>
                        result.researchSummary
                            ?.allFoldsHaveClosedHTFContext ===
                        true
                ),
            htfAuditPassed:
                successful.every(
                    (result) =>
                        result.researchSummary
                            ?.htfAudit
                            ?.allFoldsHaveClosedContext ===
                        true
                ),
        },
        results
    };

    await fs.writeFile(outputPath, JSON.stringify(report, null, 2));

    console.log(`\n✅ Saved research report:\n${outputPath}`);
    console.log(`Successful: ${successful.length}/${selectedMarkets.length * selectedTimeframes.length}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
