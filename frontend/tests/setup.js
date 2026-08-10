// binaryTracker.js (and anything else that persists to the browser) reads
// window.localStorage directly. The test environment is plain Node, not
// jsdom, so window is undefined - existing try/catch guards in that code
// already handle this safely (no crash), but they log a warning every
// time, which drowns out real test output. This stub keeps that code path
// exercised without the noise, without pulling in a full jsdom dependency
// just for two methods.
if (typeof globalThis.window === "undefined") {
    const store = new Map();
    globalThis.window = {
        localStorage: {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => { store.set(key, String(value)); },
            removeItem: (key) => { store.delete(key); }
        }
    };
}
