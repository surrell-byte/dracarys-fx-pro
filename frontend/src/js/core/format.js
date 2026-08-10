// Display-formatting helpers used throughout app.js's render functions.
// Pure functions only - no DOM access, no module state - which is what
// makes this the safest possible first cut of app.js (see README's
// "Known gaps" for the rest of the decomposition plan). Extracted
// byte-identical from app.js; call sites there now import from here.

export function formatPrice(value) {
    if (!Number.isFinite(value)) return "--";
    return value.toLocaleString(undefined, {
        maximumFractionDigits: value >= 100 ? 2 : 6
    });
}

export function formatNumber(value, digits = 2) {
    if (!Number.isFinite(value)) return "--";
    return value.toFixed(digits);
}

export function formatCurrency(value) {
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

export function formatSigned(value) {
    if (!Number.isFinite(value)) return "--";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}`;
}
