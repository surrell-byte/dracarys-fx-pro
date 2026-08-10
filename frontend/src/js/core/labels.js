// Pure helpers for the binary-outcome stats table, calibration curve, and
// backtest results table: interval parsing, expiry-length -> time label,
// and the CSS class helpers for edge/verdict badges. No DOM, no module
// state - `interval` is passed in explicitly rather than read from
// app.js's `state`, which is what lets one function serve both the live
// binary stats table and the backtest results table. Those two call
// sites used to carry hand-duplicated copies of this exact logic
// (`expiryLabel` and `backtestExpiryLabel`); this is now the single
// source of truth for both.

export function intervalToMinutes(interval) {
    const match = /^(\d+)([mhd])$/.exec(interval ?? "");
    if (!match) return null;
    const value = Number(match[1]);
    const unit = match[2];
    if (unit === "m") return value;
    if (unit === "h") return value * 60;
    if (unit === "d") return value * 60 * 24;
    return null;
}

export function expiryLabel(expiryLength, interval) {
    const minutesPerCandle = intervalToMinutes(interval);
    if (!Number.isFinite(minutesPerCandle)) return `${expiryLength} candles`;
    const totalMinutes = expiryLength * minutesPerCandle;
    const timeLabel = totalMinutes >= 60
        ? `${(totalMinutes / 60).toFixed(totalMinutes % 60 === 0 ? 0 : 1)}h`
        : `${totalMinutes}m`;
    return `${expiryLength} candles (~${timeLabel})`;
}

// Payout ratios outside (0, 1] aren't a real broker payout - fall back to
// the 85% default rather than feeding a nonsense number into the edge math.
export function clampPayoutRatio(rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0 || value > 1) return 0.85;
    return value;
}

export function edgeClass(edge) {
    if (!Number.isFinite(edge)) return "";
    return edge > 0 ? "edge-positive" : "edge-negative";
}

export function verdictClass(verdict) {
    if (!verdict) return "";
    if (verdict.startsWith("Edge detected")) return "verdict-edge";
    if (verdict.startsWith("No edge")) return "verdict-none";
    return "verdict-inconclusive";
}
