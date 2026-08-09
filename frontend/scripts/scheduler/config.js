// Central config for the background scheduler. Edit this file to change
// which markets get scanned, how often, and when the daily report fires.
// Nothing else in scripts/scheduler/ should need touching for day-to-day
// tuning.

export const config = {
    // Symbols to scan every cycle. `assetClass: "crypto"` uses Binance via
    // ccxt (no API key needed for public candle data). `assetClass: "forex"`
    // uses Twelve Data (needs TWELVEDATA_API_KEY in frontend/.env - same key
    // your browser app already uses for forexDataService.js) and is subject
    // to the free tier's 800 calls/day, 8/min budget - see that file's notes
    // before adding many forex symbols on a short poll interval.
    symbols: [
        // Crypto: Binance/ccxt, no key, no meaningful rate limit at this
        // volume - keep polling every pollIntervalMs (60s) below.
        { symbol: "BTC/USDT", assetClass: "crypto" },
        { symbol: "ETH/USDT", assetClass: "crypto" },

        // Forex: Twelve Data, free tier = 800 calls/day, 8/min.
        // pollIntervalMs overrides the global default per-symbol so we
        // don't blow the daily budget. At 5 min (300_000ms) each pair
        // costs 288 calls/day: 2 pairs = 576/day, leaving headroom.
        // Raising the pair count or lowering the interval? Re-check the
        // math: (86400 / (pollIntervalMs/1000)) * numPairs must stay
        // under ~750/day to leave slack for retries/manual `npm run report`.
        { symbol: "EUR/USD", assetClass: "forex", pollIntervalMs: 300_000 },
        { symbol: "GBP/USD", assetClass: "forex", pollIntervalMs: 300_000 }
    ],

    timeframe: "1m",

    // Needs to cover the longest strategy lookback in signalEngine.js
    // (trendFollowing2 wants 220 candles). 250 leaves headroom.
    candleLimit: 250,

    // Which STRATEGIES keys (from signalEngine.js) to run each cycle.
    // Empty array = run all of them.
    strategies: [],

    // How often to re-scan for new signals and check open ones, in ms.
    // 60_000 = once a minute. Binance's public REST endpoint doesn't
    // require a key, but don't go far below this without checking their
    // rate limits for however many symbols you're scanning.
    pollIntervalMs: 60_000,

    // A virtual trade that hits neither its stop nor its target within this
    // many poll cycles gets closed as a "timeout" (win or loss decided by
    // whichever side of entry price it's sitting on when time runs out).
    maxHoldCandles: 60,

    // When a single candle's high/low range touches both the stop-loss and
    // take-profit levels, we can't tell from OHLC data alone which was hit
    // first. "conservative" assumes the stop lost; "optimistic" assumes the
    // target won. Conservative is the safer default for trusting the stats.
    ambiguousFillRule: "conservative",

    // Portfolio-level exposure limits, enforced in addition to the
    // per-symbol/per-strategy stacking check above. See portfolioRisk.js.
    portfolioRiskLimits: {
        maxConcurrentPositions: 20,
        maxPositionsPerSymbol: 4,
        maxPositionsPerDirection: 12,
        maxDailyLossPct: null
    },

    // 24h local time the daily HTML report auto-generates.
    dailyReportHour: 18,
    dailyReportMinute: 0,
    // Weekly report runs at the same time. 0 = Sunday, matching node-cron.
    weeklyReportDay: 0,

    // Telegram push notifications - see notify.js header for one-time bot
    // setup steps. Needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in
    // frontend/.env; scheduler runs fine without them, it just skips
    // sending and logs a warning once.
    notifications: {
    enabled: true,
    minConfidence: 75,
    minQuality: "Medium", // "Low" | "Medium" | "High"
    dailySummary: true
},

    // Overridable via env vars so a cloud deploy can point these at a
    // persistent volume (e.g. Railway) instead of the repo-relative
    // default used for local dev. Falls back to the original paths when
    // the env vars aren't set, so nothing changes for local `npm run scheduler`.
    dbPath: process.env.SCHEDULER_DB_PATH || new URL("../../data/signals.db", import.meta.url).pathname,
    reportsDir: process.env.SCHEDULER_REPORTS_DIR || new URL("../../reports", import.meta.url).pathname
};
