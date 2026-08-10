import { describe, it, expect } from "vitest";
import { formatPrice, formatNumber, formatCurrency, formatSigned } from "@core/format.js";

describe("formatPrice", () => {
    it("uses 2 decimal places at or above 100", () => {
        expect(formatPrice(12345.678)).toBe("12,345.68");
    });
    it("uses up to 6 decimal places below 100", () => {
        expect(formatPrice(0.123456789)).toBe("0.123457");
    });
    it("returns -- for non-finite input", () => {
        expect(formatPrice(NaN)).toBe("--");
        expect(formatPrice(undefined)).toBe("--");
    });
});

describe("formatNumber", () => {
    it("defaults to 2 decimal places", () => {
        expect(formatNumber(3.14159)).toBe("3.14");
    });
    it("respects a custom digit count", () => {
        expect(formatNumber(3.14159, 4)).toBe("3.1416");
    });
    it("returns -- for non-finite input", () => {
        expect(formatNumber(Infinity)).toBe("--");
    });
});

describe("formatCurrency", () => {
    it("always shows exactly 2 decimal places", () => {
        expect(formatCurrency(10000)).toBe("10,000.00");
        expect(formatCurrency(10000.5)).toBe("10,000.50");
    });
});

describe("formatSigned", () => {
    it("prefixes positive values with +", () => {
        expect(formatSigned(4.2)).toBe("+4.20");
    });
    it("does not double-prefix negative values", () => {
        expect(formatSigned(-4.2)).toBe("-4.20");
    });
    it("returns -- for non-finite input", () => {
        expect(formatSigned(NaN)).toBe("--");
    });
});
