#!/usr/bin/env bash
# 03-runner.sh
# Replaces frontend/scripts/analysis/multiMarketWalkForward.js wholesale
# so the runner fetches warmup + scored candles and passes
# initialContextCandles through.
set -euo pipefail

FILE="frontend/scripts/analysis/multiMarketWalkForward.js"
DIR="$(dirname "$FILE")"
mkdir -p "$DIR"

if [ -f "$FILE" ]; then
  cp "$FILE" "$FILE.bak"
  echo "Backed up existing file to $FILE.bak"
fi

cat > "$FILE" <<'EOF'
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

async function runMarket({ symbol, assetClass, timeframe, limit, folds, warmupCandles }) {
    const fetchLimit = limit + warmupCandles;

    console.log(
        `\nFetching ${fetchLimit} ${timeframe} candles for ${symbol} ` +
        `(${warmupCandles} context + ${limit} scored)...`
    );

    const candles = await fetchCandles({ symbol, assetClass, timeframe, limit: fetchLimit });
    assertCandlesValid(candles, Math.min(fetchLimit, 100), `${symbol} ${timeframe}`);

    if (candles.length < fetchLimit) {
        throw new Error(
            `${symbol} ${timeframe}: requested ${fetchLimit} candles but received ${candles.length}`
        );
    }

    console.log(`Fetching ${DAILY_CONTEXT_CANDLES} daily candles for ${symbol}...`);
    const dailyCandles = await fetchCandles({
        symbol, assetClass, timeframe: "1d", limit: DAILY_CONTEXT_CANDLES
    });
    assertCandlesValid(dailyCandles, 200, `${symbol} 1d`);

    console.log(`Running ${folds}-fold research backtest for ${symbol} ${timeframe}...`);

    const result = await runWalkForwardBacktest(candles, {
        folds,
        initialContextCandles: warmupCandles,
        warmupCandles,
        strategyIds: Object.keys(STRATEGIES),
        assetClass,
        costs: config.executionCosts?.[assetClass] ?? null,
        dailyCandles
    });

    return {
        symbol, assetClass, timeframe,
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

    console.log(`Markets: ${MARKETS.length}`);
    console.log(`Timeframes: ${TIMEFRAMES.join(", ")}`);
    console.log(`Strategies: ${Object.keys(STRATEGIES).length}`);
    console.log(`Scored candles/market: ${args.limit}`);
    console.log(`Initial context: ${args.warmupCandles}`);
    console.log(`Folds: ${args.folds}`);

    for (const market of MARKETS) {
        for (const timeframe of TIMEFRAMES) {
            try {
                const result = await runMarket({
                    ...market, timeframe,
                    limit: args.limit, folds: args.folds, warmupCandles: args.warmupCandles
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
            markets: MARKETS,
            timeframes: TIMEFRAMES,
            scoredCandlesPerMarket: args.limit,
            initialContextCandles: args.warmupCandles,
            downloadedCandlesPerMarket: args.limit + args.warmupCandles,
            folds: args.folds,
            strategies: Object.keys(STRATEGIES)
        },
        coverage: {
            requestedCombinations: MARKETS.length * TIMEFRAMES.length,
            successfulCombinations: successful.length,
            failedCombinations: failed.length,
            failures: failed.map((r) => ({ symbol: r.symbol, timeframe: r.timeframe, error: r.error }))
        },
        results
    };

    await fs.writeFile(outputPath, JSON.stringify(report, null, 2));

    console.log(`\n✅ Saved research report:\n${outputPath}`);
    console.log(`Successful: ${successful.length}/${MARKETS.length * TIMEFRAMES.length}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
EOF

chmod +x "$FILE"
echo "✓ Wrote $FILE"
