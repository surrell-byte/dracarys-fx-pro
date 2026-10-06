// Candle fetching, kept separate from runScheduler.js so the data source
// can be swapped or mocked without touching scheduling/trade logic.
// Crypto goes through ccxt/Binance (public REST, no key). Forex goes
// through Twelve Data's REST time_series endpoint directly - not through
// frontend/src/js/services/forexDataService.js, because that class is
// built around a live poll-and-callback loop for the browser UI
// (import.meta.env, WebSocket-style subscriptions); this just needs a
// single one-shot fetch per cycle, so a plain REST call is simpler and has
// no browser-only assumptions baked in.

import ccxt from "ccxt";

const TWELVEDATA_INTERVAL = {
    "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h", "1d": "1day"
};
const BINANCE_MAX_CANDLES_PER_CALL = 1000;
const TWELVEDATA_MAX_CANDLES_PER_CALL = 5000;
const TWELVEDATA_MIN_REQUEST_GAP_MS = 8000;

const binance = new ccxt.binance();

function timeframeToMs(timeframe) {
    const unit = timeframe.slice(-1);
    const n = Number(timeframe.slice(0, -1));
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
    if (!unitMs || !Number.isFinite(n)) {
        throw new Error(`Cannot compute duration for timeframe "${timeframe}"`);
    }
    return n * unitMs;
}

export async function fetchCandles({ symbol, assetClass, timeframe, limit }) {
    return (await fetchCandlesWithMetadata({ symbol, assetClass, timeframe, limit })).candles;
}

export async function fetchCandlesWithMetadata({ symbol, assetClass, timeframe, limit, endTime = Date.now() }) {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("Candle limit must be a positive integer.");
    }
    if (!Number.isFinite(endTime)) throw new Error("Candle endTime must be a finite timestamp.");
    const intervalMs = timeframeToMs(timeframe);
    const closedEndTime = Math.floor(endTime / intervalMs) * intervalMs - intervalMs;

    const { pages, pageCount } = assetClass === "forex"
        ? await fetchForexPages({ symbol, timeframe, limit, endTime: closedEndTime })
        : await fetchCryptoPages({ symbol, timeframe, limit, endTime: closedEndTime });
    const assembled = stitchCandlePages(pages, { limit, endTime: closedEndTime });

    return {
        ...assembled,
        pageCount,
        requestedCandleCount: limit,
        providerShortfall: assembled.candles.length < limit,
        requestedEndTime: endTime,
        endTime: closedEndTime,
        integrity: inspectCandleSeries(assembled.candles, timeframe, assetClass)
    };
}

export function stitchCandlePages(pages, { limit = Infinity, endTime = Infinity } = {}) {
    const byTimestamp = new Map();
    let rawCandleCount = 0;

    for (const page of pages) {
        for (const candle of page) {
            rawCandleCount += 1;
            if (!Number.isFinite(candle.time)) continue;
            if (!byTimestamp.has(candle.time)) byTimestamp.set(candle.time, candle);
        }
    }

    const sorted = [...byTimestamp.values()]
        .filter((candle) => candle.time <= endTime)
        .sort((left, right) => left.time - right.time);
    const candles = sorted.slice(-limit);
    return {
        candles,
        rawCandleCount,
        duplicateCount: rawCandleCount - byTimestamp.size
    };
}

export function inspectCandleSeries(candles, timeframe, assetClass = "crypto") {
    const intervalMs = timeframeToMs(timeframe);
    const invalidIndexes = [];
    const gaps = [];
    let duplicateCount = 0;
    let orderingValid = true;

    for (let index = 0; index < candles.length; index += 1) {
        const candle = candles[index];
        if (
            !Number.isSafeInteger(candle.time) || candle.time < 0 ||
            ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) ||
            candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 ||
            candle.high < Math.max(candle.open, candle.close, candle.low) ||
            candle.low > Math.min(candle.open, candle.close) ||
            !(candle.volume === null || (Number.isFinite(candle.volume) && candle.volume >= 0))
        ) {
            invalidIndexes.push(index);
        }

        if (index === 0) continue;
        const delta = candle.time - candles[index - 1].time;
        if (delta <= 0) {
            orderingValid = false;
            if (delta === 0) duplicateCount += 1;
            continue;
        }
        if (delta > intervalMs) {
            const missingCount = Math.max(0, Math.round(delta / intervalMs) - 1);
            const missingTimes = Array.from(
                { length: Math.min(missingCount, 20_000) },
                (_, offset) => candles[index - 1].time + ((offset + 1) * intervalMs)
            );
            const expectedMarketClosure = assetClass === "forex" &&
                missingTimes.length === missingCount &&
                missingTimes.every(isForexMarketClosed);
            gaps.push({
                from: candles[index - 1].time,
                to: candle.time,
                missingIntervals: missingCount,
                classification: expectedMarketClosure ? "expected_market_closure" : "unclassified_data_gap"
            });
        }
    }

    return {
        candleCount: candles.length,
        firstTime: candles[0]?.time ?? null,
        lastTime: candles.at(-1)?.time ?? null,
        orderingValid,
        duplicateCount,
        invalidCount: invalidIndexes.length,
        invalidIndexes,
        gaps,
        missingIntervalCount: gaps.reduce((sum, gap) => sum + gap.missingIntervals, 0)
    };
}

const newYorkTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
});

function isForexMarketClosed(timestamp) {
    const parts = Object.fromEntries(newYorkTime.formatToParts(timestamp).map(({ type, value }) => [type, value]));
    const weekday = parts.weekday;
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    const year = Number(parts.year);
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    const nextDate = new Date(Date.UTC(year, Number(parts.month) - 1, Number(parts.day) + 1))
        .toISOString()
        .slice(0, 10);
    const currentYearHolidays = getForexHolidayDates(year);
    const nextYearHolidays = getForexHolidayDates(year + 1);

    if (currentYearHolidays.has(localDate)) return true;
    if (hour >= 17 && (currentYearHolidays.has(nextDate) || nextYearHolidays.has(nextDate))) return true;
    if (weekday === "Sat") return true;
    if (weekday === "Sun") return hour < 17;
    if (weekday === "Fri" && hour >= 17) return true;
    return hour === 17 && minute < 5;
}

function getEasterClosureDates(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + (2 * e) + (2 * i) - h - k) % 7;
    const m = Math.floor((a + (11 * h) + (22 * l)) / 451);
    const month = Math.floor((h + l - (7 * m) + 114) / 31);
    const day = ((h + l - (7 * m) + 114) % 31) + 1;
    const easterSunday = new Date(Date.UTC(year, month - 1, day));
    const goodFriday = new Date(easterSunday.getTime() - (2 * 86_400_000));
    const easterMonday = new Date(easterSunday.getTime() + 86_400_000);

    return {
        goodFriday: goodFriday.toISOString().slice(0, 10),
        easterMonday: easterMonday.toISOString().slice(0, 10)
    };
}

function getForexHolidayDates(year) {
    const { goodFriday, easterMonday } = getEasterClosureDates(year);
    return new Set([`${year}-01-01`, goodFriday, easterMonday]);
}

async function fetchCryptoPages({ symbol, timeframe, limit, endTime }) {
    const intervalMs = timeframeToMs(timeframe);
    const lastOpenTime = Math.floor(endTime / intervalMs) * intervalMs;
    let cursor = lastOpenTime - ((limit - 1) * intervalMs);
    const maxRequests = Math.ceil(limit / BINANCE_MAX_CANDLES_PER_CALL) + 2;
    const pages = [];
    let uniqueCount = 0;
    let requests = 0;
    const seen = new Set();

    while (uniqueCount < limit && requests < maxRequests && cursor <= lastOpenTime) {
        const rows = await binance.fetchOHLCV(
            symbol,
            timeframe,
            cursor,
            Math.min(BINANCE_MAX_CANDLES_PER_CALL, limit - uniqueCount)
        );
        requests += 1;
        if (!rows.length) break;

        const page = rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
            .sort((left, right) => left.time - right.time)
            .filter((candle) => candle.time <= lastOpenTime);
        if (!page.length) break;
        pages.push(page);
        for (const candle of page) {
            if (!seen.has(candle.time)) {
                seen.add(candle.time);
                uniqueCount += 1;
            }
        }

        const nextCursor = page.at(-1).time + intervalMs;
        if (nextCursor <= cursor || nextCursor > lastOpenTime) break;
        cursor = nextCursor;
    }

    return { pages, pageCount: requests };
}

async function fetchForexPages({ symbol, timeframe, limit, endTime }) {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) {
        throw new Error(`TWELVEDATA_API_KEY not set - required to scan forex symbol ${symbol}`);
    }

    const pages = [];
    let cursor = new Date(endTime).toISOString();
    let uniqueCount = 0;
    let requests = 0;
    const seen = new Set();

    while (uniqueCount < limit && requests < Math.ceil(limit / TWELVEDATA_MAX_CANDLES_PER_CALL) + 2) {
        const outputsize = Math.min(TWELVEDATA_MAX_CANDLES_PER_CALL, limit - uniqueCount);
        const page = await fetchForexPage({ symbol, timeframe, outputsize, endDate: cursor });
        requests += 1;
        if (!page.length) break;
        pages.unshift(page);
        for (const candle of page) {
            if (!seen.has(candle.time)) {
                seen.add(candle.time);
                uniqueCount += 1;
            }
        }

        const nextCursor = new Date(page[0].time - 1).toISOString();
        if (new Date(nextCursor).getTime() >= new Date(cursor).getTime()) break;
        cursor = nextCursor;
        if (page.length < outputsize) break;
    }

    return { pages, pageCount: requests };
}

async function fetchForexPage({ symbol, timeframe, outputsize, endDate }) {
    const interval = TWELVEDATA_INTERVAL[timeframe] ?? "1min";
    const params = new URLSearchParams({
        symbol,
        interval,
        outputsize: String(outputsize),
        order: "asc",
        timezone: "UTC",
        end_date: endDate,
        apikey: process.env.TWELVEDATA_API_KEY
    });
    await throttleTwelveDataRequest();
    const res = await fetch(`https://api.twelvedata.com/time_series?${params.toString()}`);
    const data = await res.json();
    if (data.status === "error" || data.code >= 400) {
        throw new Error(data.message || `Twelve Data error for ${symbol}`);
    }
    if (!Array.isArray(data.values)) throw new Error(`Unexpected Twelve Data response for ${symbol}`);

    return data.values.map((value) => ({
        time: parseUtcTimestamp(value.datetime),
        open: Number(value.open),
        high: Number(value.high),
        low: Number(value.low),
        close: Number(value.close),
        volume: value.volume != null ? Number(value.volume) : null
    })).sort((left, right) => left.time - right.time);
}

function parseUtcTimestamp(value) {
    const text = String(value);
    const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
        ? text
        : `${text.replace(" ", "T")}Z`;
    return new Date(withZone).getTime();
}

// Twelve Data's free tier allows 8 API credits/minute. This enforces a
// minimum spacing between historical page requests as well as live fetches.
let lastTwelveDataRequestAt = 0;

async function throttleTwelveDataRequest() {
    // During tests we don't want to incur the real-world 8s throttle delay,
    // which would make unit tests timeout. Short-circuit when running under
    // the test runner to keep tests fast and deterministic.
    if (process.env.NODE_ENV === "test") {
        lastTwelveDataRequestAt = Date.now();
        return;
    }

    const elapsed = Date.now() - lastTwelveDataRequestAt;
    const waitMs = TWELVEDATA_MIN_REQUEST_GAP_MS - elapsed;
    if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastTwelveDataRequestAt = Date.now();
}

