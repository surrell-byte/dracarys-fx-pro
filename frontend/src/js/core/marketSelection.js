// Pure derivation of market identity from a selected <option> in the pair
// dropdown, extracted from app.js's updateMarketFromSelection. Everything
// else in that function (reading elements.pairSelect, writing
// elements.marketLabel.textContent, reading/writing state.*) is DOM/state
// glue and stays in app.js - this is just the part that turns "which
// option is selected, plus the current interval" into the values the rest
// of the app needs, with no DOM access at all.
export function resolveMarketSelection({ symbolValue, apiSymbolAttr, assetClassAttr, interval }) {
    const symbol = symbolValue;
    const apiSymbol = apiSymbolAttr ?? symbol.toUpperCase();
    const assetClass = assetClassAttr ?? "crypto";
    const marketLabel = `${symbol.toUpperCase()} · ${interval} live candles`;

    return { symbol, apiSymbol, assetClass, marketLabel };
}
