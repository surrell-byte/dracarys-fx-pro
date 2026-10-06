import test from "node:test";
import assert from "node:assert/strict";
import { assertProtectiveLevels } from "./trader.js";

test("accepts correctly ordered BUY protection", () => {
    assert.doesNotThrow(() => assertProtectiveLevels("buy", 100, 95, 110));
});

test("accepts correctly ordered SELL protection", () => {
    assert.doesNotThrow(() => assertProtectiveLevels("sell", 100, 105, 90));
});

test("rejects missing protection", () => {
    assert.throws(
        () => assertProtectiveLevels("buy", 100, null, 110),
        /require finite entry, stop-loss, and take-profit/
    );
});

test("rejects protection on the wrong side of entry", () => {
    assert.throws(
        () => assertProtectiveLevels("buy", 100, 105, 110),
        /correct side of entry/
    );
    assert.throws(
        () => assertProtectiveLevels("sell", 100, 95, 90),
        /correct side of entry/
    );
});
