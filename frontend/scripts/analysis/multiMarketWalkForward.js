#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import "dotenv/config";

import { fetchCandlesWithMetadata } from "../scheduler/candles.js";
import { runWalkForwardBacktest } from "../../src/js/analysis/backtestEngine.js";
import { STRATEGIES } from "../../src/js/signals/signalEngine.js";
import { config } from "../scheduler/config.js";
import { computeRStats } from "../../src/js/analysis/rMetrics.js";
import { computeStrategyStats } from "../../src/js/analysis/performanceStats.js";

const MARKETS = [
    { symbol: "BTC/USDT", assetClass: "crypto" },
    { symbol: "ETH/USDT", assetClass: "crypto" },
    { symbol: "EUR/USD", assetClass: "forex" },
    { symbol: "GBP/USD", assetClass: "forex" }
];

const TIMEFRAMES = ["1m", "5m", "15m"];
const DAILY_CONTEXT_CANDLES = 600;

const DEFAULTS = {
    // --limit means SCORED candles; the runner fetches limit + warmup.
    limit: 10_000,
    folds: 3,
    warmupCandles: 320,
    maxHoldCandles: config.maxHoldCandles,
    markets: MARKETS.map((market) => market.symbol),
    timeframes: TIMEFRAMES,
    output: "reports/analysis/multi-market-walk-forward-expanded.json",
    dataset: "reports/analysis/multi-market-dataset-expanded.json",
    endTime: null
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
            case "--dataset": args.dataset = argv[++i]; break;
            case "--endTime": args.endTime = Number(argv[++i]); break;
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
    if (args.endTime !== null && !Number.isFinite(args.endTime)) {
        throw new Error("--endTime must be a finite Unix timestamp in milliseconds");
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
            !Number.isSafeInteger(candle.time) || !Number.isFinite(candle.open) ||
            !Number.isFinite(candle.high) || !Number.isFinite(candle.low) ||
            !Number.isFinite(candle.close) || candle.open <= 0 || candle.high <= 0 ||
            candle.low <= 0 || candle.close <= 0 ||
            !(candle.volume === null || (Number.isFinite(candle.volume) && candle.volume >= 0))
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

function summarizeDatasetQuality(snapshot) {
    const datasets = [...snapshot.dailyContext, ...snapshot.datasets];
    const gaps = datasets.flatMap((dataset) => (dataset.integrity.gaps ?? []).map((gap) => ({
        symbol: dataset.symbol,
        timeframe: dataset.timeframe,
        ...gap
    })));

    return {
        datasetCount: datasets.length,
        candleCount: datasets.reduce((sum, dataset) => sum + dataset.candles.length, 0),
        duplicateCandleCount: datasets.reduce((sum, dataset) => sum + dataset.duplicateCount, 0),
        invalidCandleCount: datasets.reduce((sum, dataset) => sum + dataset.integrity.invalidCount, 0),
        unorderedDatasetCount: datasets.filter((dataset) => !dataset.integrity.orderingValid).length,
        providerShortfallCount: datasets.filter((dataset) => dataset.providerShortfall).length,
        missingIntervalCount: gaps.reduce((sum, gap) => sum + gap.missingIntervals, 0),
        expectedMarketGapCount: gaps.filter((gap) => gap.classification === "expected_market_closure").length,
        unclassifiedGapCount: gaps.filter((gap) => gap.classification === "unclassified_data_gap").length,
        gaps
    };
}

async function runMarket({ symbol, assetClass, timeframe, limit, folds, warmupCandles, maxHoldCandles, candleData, dailyCandles }) {
    const fetchLimit = limit + warmupCandles;
    const candles = candleData.candles;
    assertCandlesValid(candles, fetchLimit, `${symbol} ${timeframe}`);

    console.log(`Running ${folds}-fold research backtest for ${symbol} ${timeframe}...`);

    const backtestOptions = {
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
    };
    const result = await runWalkForwardBacktest(candles, backtestOptions);

    let baselineComparison = null;
    if (symbol === "BTC/USDT" && timeframe === "5m") {
        const baselineCandles = candles.slice(-1320);
        const baseline = await runWalkForwardBacktest(baselineCandles, {
            ...backtestOptions,
            strategyIds: ["balanced"],
            initialContextCandles: Math.min(320, baselineCandles.length - (folds * 2))
        });
        const summarize = (backtest) => {
            const trades = (backtest.folds ?? []).flatMap((fold) => fold.spotTradesByStrategy?.balanced ?? []);
            const stats = computeStrategyStats(trades);
            const rStats = computeRStats(trades);
            return {
                trades: stats.trades,
                netReturnPct: stats.totalReturn,
                maxDrawdownPct: stats.maxDrawdown,
                totalR: rStats.totalR,
                expectancyR: rStats.expectancyR,
                profitFactorR: rStats.profitFactorR
            };
        };
        baselineComparison = {
            strategyId: "balanced",
            baselineWindow: {
                candles: baselineCandles.length,
                scoredCandles: baseline.summary.totalScoredCandles,
                firstTime: baselineCandles[0]?.time ?? null,
                lastTime: baselineCandles.at(-1)?.time ?? null,
                metrics: summarize(baseline)
            },
            expandedWindow: {
                candles: candles.length,
                scoredCandles: result.summary.totalScoredCandles,
                firstTime: candles[0]?.time ?? null,
                lastTime: candles.at(-1)?.time ?? null,
                metrics: summarize(result)
            }
        };
    }

    return {
        symbol, assetClass, timeframe,
        from: candles[0].time,
        to: candles.at(-1).time,
        inputCandleCount: candles.length,
        dataIntegrity: {
            pageCount: candleData.pageCount,
            rawCandleCount: candleData.rawCandleCount,
            duplicateCount: candleData.duplicateCount,
            requestedCandleCount: candleData.requestedCandleCount,
            providerShortfall: candleData.providerShortfall,
            ...candleData.integrity
        },
        scoredCandleCount: result.summary.totalScoredCandles,
        initialContextCandles: warmupCandles,
        foldCount: result.folds.length,
        folds: result.folds,
        baselineComparison,
        rows: summariseFoldResults(result, symbol, timeframe),
        trades: flattenTrades(result, symbol, assetClass, timeframe),
        researchSummary: result.summary
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const endTime = args.endTime ?? Date.now();
    const fetchLimit = args.limit + args.warmupCandles;
    const selectedMarkets = MARKETS.filter((market) => args.markets.includes(market.symbol));
    const selectedTimeframes = args.timeframes;
    const datasetPath = path.resolve(args.dataset);
    const dailyContext = [];
    const datasets = [];
    const fetchFailures = [];

    console.log(`Markets: ${selectedMarkets.length}`);
    console.log(`Timeframes: ${selectedTimeframes.join(", ")}`);
    console.log(`Strategies: ${Object.keys(STRATEGIES).length}`);
    console.log(`Scored candles/market: ${args.limit}`);
    console.log(`Initial context: ${args.warmupCandles}`);
    console.log(`Folds: ${args.folds}`);
    console.log(`Frozen end boundary: ${new Date(endTime).toISOString()}`);

    for (const market of selectedMarkets) {
        try {
            console.log(`Fetching ${DAILY_CONTEXT_CANDLES} daily candles for ${market.symbol}...`);
            const data = await fetchCandlesWithMetadata({
                symbol: market.symbol,
                assetClass: market.assetClass,
                timeframe: "1d",
                limit: DAILY_CONTEXT_CANDLES,
                endTime
            });
            assertCandlesValid(data.candles, DAILY_CONTEXT_CANDLES, `${market.symbol} 1d`);
            if (!data.integrity.orderingValid || data.integrity.invalidCount || data.duplicateCount) {
                throw new Error(`${market.symbol} 1d: integrity validation failed`);
            }
            dailyContext.push({ ...market, timeframe: "1d", ...data });
        } catch (error) {
            console.error(`❌ ${market.symbol} 1d: ${error.message}`);
            fetchFailures.push({ symbol: market.symbol, timeframe: "1d", error: error.message });
        }

        for (const timeframe of selectedTimeframes) {
            try {
                if (!dailyContext.some((entry) => entry.symbol === market.symbol)) {
                    throw new Error("daily context unavailable");
                }
                console.log(`Fetching ${fetchLimit} ${timeframe} candles for ${market.symbol}...`);
                const data = await fetchCandlesWithMetadata({
                    ...market,
                    timeframe,
                    limit: fetchLimit,
                    endTime
                });
                assertCandlesValid(data.candles, fetchLimit, `${market.symbol} ${timeframe}`);
                if (!data.integrity.orderingValid || data.integrity.invalidCount || data.duplicateCount) {
                    throw new Error(`${market.symbol} ${timeframe}: integrity validation failed`);
                }
                datasets.push({ ...market, timeframe, ...data });
            } catch (error) {
                console.error(`❌ ${market.symbol} ${timeframe}: ${error.message}`);
                fetchFailures.push({ symbol: market.symbol, assetClass: market.assetClass, timeframe, error: error.message });
            }
        }
    }

    const datasetSnapshot = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        endTime,
        configuration: {
            markets: selectedMarkets,
            timeframes: selectedTimeframes,
            scoredCandlesPerMarket: args.limit,
            initialContextCandles: args.warmupCandles,
            downloadedCandlesPerMarket: fetchLimit,
            dailyContextCandles: DAILY_CONTEXT_CANDLES
        },
        dailyContext,
        datasets
    };
    await fs.mkdir(path.dirname(datasetPath), { recursive: true });
    await fs.writeFile(datasetPath, JSON.stringify(datasetSnapshot));

    const persistedDatasetContents = await fs.readFile(datasetPath, "utf8");
    const persistedDataset = JSON.parse(persistedDatasetContents);
    const datasetHash = createHash("sha256").update(persistedDatasetContents).digest("hex");
    const dailyBySymbol = new Map(persistedDataset.dailyContext.map((entry) => [entry.symbol, entry]));
    const candlesByMarketTimeframe = new Map(
        persistedDataset.datasets.map((entry) => [`${entry.symbol}|${entry.timeframe}`, entry])
    );
    const results = [...fetchFailures];

    for (const market of selectedMarkets) {
        for (const timeframe of selectedTimeframes) {
            const candleData = candlesByMarketTimeframe.get(`${market.symbol}|${timeframe}`);
            const dailyData = dailyBySymbol.get(market.symbol);
            if (!candleData || !dailyData) continue;
            try {
                const result = await runMarket({
                    ...market,
                    timeframe,
                    limit: args.limit,
                    folds: args.folds,
                    warmupCandles: args.warmupCandles,
                    maxHoldCandles: args.maxHoldCandles,
                    candleData,
                    dailyCandles: dailyData.candles
                });
                results.push(result);
                console.log(`✓ ${market.symbol} ${timeframe}: ${result.trades.length} closed spot trades`);
            } catch (error) {
                console.error(`❌ ${market.symbol} ${timeframe}: ${error.message}`);
                results.push({ symbol: market.symbol, assetClass: market.assetClass, timeframe, error: error.message });
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
            downloadedCandlesPerMarket: fetchLimit,
            endTime,
            datasetPath,
            datasetSha256: datasetHash,
            datasetSchemaVersion: datasetSnapshot.schemaVersion,
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
        datasetQuality: summarizeDatasetQuality(persistedDataset),
        baselineComparison: successful.find((result) => result.baselineComparison)?.baselineComparison ?? null,
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
