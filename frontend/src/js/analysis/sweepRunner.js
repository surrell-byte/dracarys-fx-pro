import { STRATEGIES } from "@signals/strategyRegistry.js";
import { computeStrategyStats } from "@analysis/performanceStats.js";
import { computeRStats } from "@analysis/rMetrics.js";
import { runBacktest } from "@analysis/backtestEngine.js";

const SWEEP_RUNNER_VERSION = "phase1a-sweep-runner-v1";

function sortObject(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => sortObject(entry));
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, sortObject(nested)])
        );
    }

    return value;
}

export function stableStringify(value) {
    return JSON.stringify(sortObject(value));
}

export function resolveSweepStrategy(strategyId) {
    const resolvedStrategy = STRATEGIES[strategyId];
    if (!resolvedStrategy) {
        throw new Error(`Unknown strategy id "${strategyId}" in canonical strategy registry.`);
    }
    return resolvedStrategy;
}

export function normalizeSweepParameter(value) {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

export function generateSweepCombinations(spec = {}) {
    const { strategyId, strategyIds, ...rest } = spec;
    const baseStrategyIds = strategyIds ?? (strategyId == null ? [] : [strategyId]);
    if (!baseStrategyIds.length) {
        return [];
    }

    const parameterSets = Object.entries(rest)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, normalizeSweepParameter(value)]);

    let combinations = [{}];
    for (const [key, values] of parameterSets) {
        combinations = combinations.flatMap((combination) =>
            values.map((value) => ({ ...combination, [key]: value }))
        );
    }

    return baseStrategyIds.flatMap((id) =>
        combinations.map((combination) => ({
            ...combination,
            strategyId: id,
            strategy: id
        }))
    );
}

export function buildSweepCacheKey(configuration = {}) {
    const safeConfig = {};
    for (const [key, value] of Object.entries(configuration).sort(([left], [right]) => left.localeCompare(right))) {
        if (value === undefined) continue;
        safeConfig[key] = value;
    }

    const strategyId = safeConfig.strategyId ?? safeConfig.strategy;
    if (strategyId) {
        try {
            const strategy = resolveSweepStrategy(strategyId);
            safeConfig.strategyRegistryFingerprint = {
                id: strategyId,
                label: strategy.label,
                threshold: strategy.threshold,
                custom: strategy.custom ?? null,
                atrStopMultiplier: strategy.atrStopMultiplier ?? null,
                rewardMultiple: strategy.rewardMultiple ?? null,
                useHigherTimeframe: Boolean(strategy.useHigherTimeframe)
            };
        } catch {
            // Intentionally ignore unknown strategy ids here so invalid configs still
            // produce a stable key rather than throwing during cache generation.
        }
    }

    safeConfig.runnerVersion = SWEEP_RUNNER_VERSION;
    return stableStringify(safeConfig);
}

export function dedupeSweepConfigurations(configurations = []) {
    const seen = new Map();
    for (const configuration of configurations) {
        const key = buildSweepCacheKey(configuration);
        if (!seen.has(key)) {
            seen.set(key, { ...configuration });
        }
    }
    return [...seen.values()];
}

function summarizeSweepResult(strategyId, result) {
    const fullResult = result ?? {};
    const leaderboard = Array.isArray(fullResult.spotLeaderboard) ? fullResult.spotLeaderboard : [];
    const leader = leaderboard.find((entry) => entry.strategy === strategyId) ?? null;
    const tradesByStrategy = fullResult.spotTradesByStrategy?.[strategyId] ?? [];

    const tradeStats = tradesByStrategy.length ? computeStrategyStats(tradesByStrategy) : {
        trades: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        avgDrawdown: 0,
        recoveryFactor: null,
        expectancy: null,
        profitFactor: null,
        winRate: null,
        sharpe: null,
        sortino: null,
        calmar: null,
        longestWinStreak: 0,
        longestLossStreak: 0,
        sampleConfidence: { reliable: false, confidenceInterval: null }
    };

    const rStats = tradesByStrategy.length ? computeRStats(tradesByStrategy) : {
        tradesWithR: 0,
        expectancyR: null,
        profitFactorR: null,
        totalR: 0,
        avgWinR: null,
        avgLossR: null,
        maxDrawdownR: 0,
        totalGrossR: 0,
        grossExpectancyR: null,
        grossProfitFactorR: null
    };

    const score = Number.isFinite(leader?.totalPnl)
        ? leader.totalPnl
        : Number.isFinite(tradeStats.totalReturn)
            ? tradeStats.totalReturn
            : 0;

    return {
        strategyId,
        label: STRATEGIES[strategyId]?.label ?? strategyId,
        trades: tradeStats.trades ?? (leader?.trades ?? 0),
        totalPnl: tradeStats.totalReturn ?? (leader?.totalPnl ?? 0),
        maxDrawdown: tradeStats.maxDrawdown ?? (leader?.maxDrawdown ?? 0),
        avgDrawdown: tradeStats.avgDrawdown ?? (leader?.avgDrawdown ?? 0),
        recoveryFactor: tradeStats.recoveryFactor ?? leader?.recoveryFactor ?? null,
        expectancy: tradeStats.expectancy ?? leader?.expectancy ?? null,
        profitFactor: tradeStats.profitFactor ?? leader?.profitFactor ?? null,
        sharpe: tradeStats.sharpe ?? leader?.sharpe ?? null,
        sortino: tradeStats.sortino ?? leader?.sortino ?? null,
        calmar: tradeStats.calmar ?? leader?.calmar ?? null,
        winRate: tradeStats.winRate ?? leader?.winRate ?? null,
        expectancyR: rStats.expectancyR ?? leader?.expectancyR ?? null,
        profitFactorR: rStats.profitFactorR ?? leader?.profitFactorR ?? null,
        totalR: rStats.totalR ?? leader?.totalR ?? 0,
        grossExpectancyR: rStats.grossExpectancyR ?? null,
        grossProfitFactorR: rStats.grossProfitFactorR ?? null,
        totalGrossR: rStats.totalGrossR ?? 0,
        score,
        sampleReliable: tradeStats.sampleConfidence?.reliable ?? leader?.sampleReliable ?? false,
        result: fullResult
    };
}

function compareSweepResults(left, right) {
    const leftScore = Number.isFinite(left.metrics?.score) ? left.metrics.score : Number.NEGATIVE_INFINITY;
    const rightScore = Number.isFinite(right.metrics?.score) ? right.metrics.score : Number.NEGATIVE_INFINITY;
    if (leftScore !== rightScore) {
        return rightScore - leftScore;
    }
    return left.cacheKey.localeCompare(right.cacheKey);
}

export async function runSweep({
    candles,
    strategyIds = [],
    combinations = [],
    executor = runBacktest,
    baseOptions = {},
    cache = new Map()
} = {}) {
    if (!Array.isArray(candles) || candles.length === 0) {
        throw new Error("Sweep requires candles with at least one bar.");
    }

    const configs = dedupeSweepConfigurations(
        combinations.length
            ? combinations
            : strategyIds.flatMap((strategyId) => [{ strategyId }])
    );

    const results = [];

    for (const configuration of configs) {
        const normalizedConfig = { ...baseOptions, ...configuration };
        const strategyId = normalizedConfig.strategyId ?? normalizedConfig.strategy;

        if (!strategyId) {
            results.push({
                status: "invalid",
                config: normalizedConfig,
                cacheKey: buildSweepCacheKey(normalizedConfig),
                error: "Sweep config is missing a strategy id.",
                metrics: null,
                rank: null
            });
            continue;
        }

        const cacheKey = buildSweepCacheKey(normalizedConfig);
        if (cache.has(cacheKey)) {
            const cached = cache.get(cacheKey);
            results.push(cached);
            continue;
        }

        try {
            const strategy = resolveSweepStrategy(strategyId);
            const effectiveOptions = {
                ...baseOptions,
                ...configuration,
                strategyIds: [strategyId],
                assetClass: normalizedConfig.assetClass ?? baseOptions.assetClass ?? "crypto",
                extraSignalContext: {
                    ...(baseOptions.extraSignalContext ?? {}),
                    ...(configuration.extraSignalContext ?? {}),
                    strategyRiskOverridesByStrategy: {
                        ...(baseOptions.extraSignalContext?.strategyRiskOverridesByStrategy ?? {}),
                        ...(configuration.extraSignalContext?.strategyRiskOverridesByStrategy ?? {}),
                        [strategyId]: {
                            ...(baseOptions.extraSignalContext?.strategyRiskOverridesByStrategy?.[strategyId] ?? {}),
                            ...(configuration.extraSignalContext?.strategyRiskOverridesByStrategy?.[strategyId] ?? {}),
                            ...(Object.fromEntries(
                                Object.entries(configuration).filter(([key]) =>
                                    ["atr", "atrs", "reward", "rewards", "adx", "volumeRatio", "lookback", "vol", "lk"].includes(key)
                                )
                            ))
                        }
                    }
                }
            };

            const strategyRiskOverrides = {
                atrStopMultiplier: configuration.atr ?? configuration.atrStopMultiplier ?? strategy.atrStopMultiplier ?? undefined,
                rewardMultiple: configuration.reward ?? configuration.rewardMultiple ?? strategy.rewardMultiple ?? undefined,
                ...Object.fromEntries(
                    Object.entries(configuration).filter(([key]) =>
                        ["adx", "volumeRatio", "lookback", "vol", "lk"].includes(key)
                    )
                )
            };

            effectiveOptions.extraSignalContext.strategyRiskOverridesByStrategy[strategyId] = {
                ...(effectiveOptions.extraSignalContext.strategyRiskOverridesByStrategy[strategyId] ?? {}),
                ...strategyRiskOverrides
            };

            const out = await executor(candles, effectiveOptions);
            const metrics = summarizeSweepResult(strategyId, out);

            const status = (() => {
                if (!out || typeof out !== "object") return "failed";
                const validTrades = out.spotTradesByStrategy?.[strategyId] ?? [];
                if (validTrades.length === 0) return "empty";
                return "ok";
            })();

            const entry = {
                strategyId,
                status,
                config: normalizedConfig,
                cacheKey,
                metrics,
                rank: null,
                error: null,
                result: out
            };

            cache.set(cacheKey, entry);
            results.push(entry);
        } catch (error) {
            const entry = {
                strategyId,
                status: "failed",
                config: normalizedConfig,
                cacheKey,
                metrics: null,
                rank: null,
                error: error instanceof Error ? error.message : String(error),
                result: null
            };
            cache.set(cacheKey, entry);
            results.push(entry);
        }
    }

    const ranked = results
        .map((entry, index) => ({ ...entry, rank: index + 1 }))
        .sort(compareSweepResults);

    const finalResults = ranked.map((entry, index) => ({
        ...entry,
        rank: index + 1,
        metrics: entry.metrics ? {
            ...entry.metrics,
            score: entry.metrics.score,
            trades: entry.metrics.trades,
            totalPnl: entry.metrics.totalPnl,
            expectancy: entry.metrics.expectancy,
            profitFactor: entry.metrics.profitFactor,
            totalR: entry.metrics.totalR,
            expectancyR: entry.metrics.expectancyR,
            profitFactorR: entry.metrics.profitFactorR,
            maxDrawdown: entry.metrics.maxDrawdown,
            avgDrawdown: entry.metrics.avgDrawdown,
            recoveryFactor: entry.metrics.recoveryFactor
        } : null
    }));

    return finalResults;
}

export function parseSweepParametersFromOptions(options = {}) {
    return {
        strategyId: options.strategyId ?? options.strategy ?? null,
        symbol: options.symbol ?? "BTC/USDT",
        timeframe: options.timeframe ?? "5m",
        assetClass: options.assetClass ?? "crypto",
        atr: options.atr ?? options.atrStopMultiplier ?? null,
        reward: options.reward ?? options.rewardMultiple ?? null,
        adx: options.adx ?? null,
        volumeRatio: options.volumeRatio ?? null,
        lookback: options.lookback ?? null,
        limit: options.limit ?? null,
        dateRange: options.dateRange ?? null,
        fees: options.fees ?? null,
        slippage: options.slippage ?? null
    };
}

export default {
    buildSweepCacheKey,
    dedupeSweepConfigurations,
    generateSweepCombinations,
    parseSweepParametersFromOptions,
    resolveSweepStrategy,
    runSweep
};
