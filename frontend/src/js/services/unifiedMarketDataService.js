// Wraps MarketDataService (crypto, Binance) and ForexDataService (forex,
// Twelve Data) behind the exact interface app.js already uses, so adding a
// second asset class didn't require touching every onCandle/onTick/onStatus
// call site. Only one provider is ever "active" at a time; the other stays
// disconnected. Callbacks are registered once, here, and re-emitted from
// whichever provider is currently active - callers never re-subscribe when
// the asset class changes.
import { MarketDataService } from "@services/marketDataService.js";
import { ForexDataService } from "@services/forexDataService.js";

export class UnifiedMarketDataService {
    constructor(symbol = "btcusdt", interval = "1m", limit = 200, assetClass = "crypto") {
        this.assetClass = assetClass;
        this.crypto = new MarketDataService(symbol, interval, limit);
        this.forex = new ForexDataService(symbol, interval, limit);

        this.candleCallbacks = [];
        this.tickCallbacks = [];
        this.statusCallbacks = [];

        this.wire(this.crypto, "crypto");
        this.wire(this.forex, "forex");
    }

    wire(provider, assetClass) {
        provider.onCandle(candle => {
            if (this.assetClass === assetClass) this.candleCallbacks.forEach(cb => cb(candle));
        });
        provider.onTick(candle => {
            if (this.assetClass === assetClass) this.tickCallbacks.forEach(cb => cb(candle));
        });
        provider.onStatus(status => {
            if (this.assetClass === assetClass) this.statusCallbacks.forEach(cb => cb(status));
        });
    }

    active() {
        return this.assetClass === "forex" ? this.forex : this.crypto;
    }

    // assetClass is optional on every method below so existing crypto-only
    // call sites keep working unchanged; pass it explicitly wherever a UI
    // element (like the pair dropdown) can pick either asset class.
    setMarket(symbol, interval, assetClass = this.assetClass) {
        this.assetClass = assetClass;
        this.active().setMarket(symbol, interval);
    }

    getCandles(symbol, interval, limit, assetClass = this.assetClass) {
        return (assetClass === "forex" ? this.forex : this.crypto).getCandles(symbol, interval, limit);
    }

    getHistoricalCandles(symbol, interval, options, assetClass = this.assetClass) {
        return (assetClass === "forex" ? this.forex : this.crypto).getHistoricalCandles(symbol, interval, options);
    }

    connect() {
        this.active().connect();
    }

    // Disconnects BOTH providers, not just the active one - guards against
    // a stray reconnect timer on the inactive provider firing after a pair
    // switch (e.g. Binance's reconnect backoff still pending from before
    // the user switched to a forex pair).
    disconnect() {
        this.crypto.disconnect();
        this.forex.disconnect();
    }

    onCandle(callback) {
        this.candleCallbacks.push(callback);
    }

    onTick(callback) {
        this.tickCallbacks.push(callback);
    }

    onStatus(callback) {
        this.statusCallbacks.push(callback);
    }
}
