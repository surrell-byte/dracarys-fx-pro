// Strategy Lab tables: the live strategy tester's leaderboard/regime/
// session/asset breakdowns, and the binary-outcome tracker's stats +
// calibration-curve tables. Extracted byte-identical from app.js; the
// only structural change is taking `elements`/`tester`/`binaryTracker`/
// `interval` as parameters instead of closing over app.js's module-level
// versions of the same names.
import { formatNumber, formatSigned } from "@core/format.js";
import { expiryLabel, clampPayoutRatio, edgeClass, verdictClass } from "@core/labels.js";

function pnlDirection(totalPnl) {
    return totalPnl < 0 ? "loss" : totalPnl > 0 ? "gain" : "flat";
}

export function renderTester(elements, tester) {
    if (!elements.testerBody || !elements.regimeBody || !elements.sessionBody || !elements.assetBody) return;

    const leaderboard = tester.getLeaderboard();
    elements.testerBody.innerHTML = leaderboard.length
        ? leaderboard.map(row => `
            <tr>
                <td>${row.label}</td>
                <td>${row.trades}</td>
                <td>${formatNumber(row.winRate, 1)}%</td>
                <td data-pnl="${pnlDirection(row.totalPnl)}">${formatSigned(row.totalPnl)}%</td>
                <td>${formatSigned(row.avgPnl)}%</td>
            </tr>
        `).join("")
        : `<tr><td colspan="5" class="empty-history">No closed trades yet</td></tr>`;

    const regimes = tester.getRegimeBreakdown();
    elements.regimeBody.innerHTML = regimes.length
        ? regimes.map(row => `
            <tr>
                <td>${row.label}</td>
                <td>${row.regime}</td>
                <td>${row.trades}</td>
                <td>${formatNumber(row.winRate, 1)}%</td>
                <td data-pnl="${pnlDirection(row.totalPnl)}">${formatSigned(row.totalPnl)}%</td>
            </tr>
        `).join("")
        : `<tr><td colspan="5" class="empty-history">No closed trades yet</td></tr>`;

    const sessions = tester.getSessionBreakdown();
    elements.sessionBody.innerHTML = sessions.length
        ? sessions.map(row => `
            <tr>
                <td>${row.label}</td>
                <td>${row.session}</td>
                <td>${row.trades}</td>
                <td>${formatNumber(row.winRate, 1)}%</td>
                <td data-pnl="${pnlDirection(row.totalPnl)}">${formatSigned(row.totalPnl)}%</td>
            </tr>
        `).join("")
        : `<tr><td colspan="5" class="empty-history">No closed trades yet</td></tr>`;

    const assets = tester.getAssetBreakdown();
    elements.assetBody.innerHTML = assets.length
        ? assets.map(row => `
            <tr>
                <td>${row.symbol}</td>
                <td>${row.trades}</td>
                <td>${formatNumber(row.winRate, 1)}%</td>
                <td data-pnl="${pnlDirection(row.totalPnl)}">${formatSigned(row.totalPnl)}%</td>
                <td>${formatSigned(row.avgPnl)}%</td>
            </tr>
        `).join("")
        : `<tr><td colspan="5" class="empty-history">No closed trades yet</td></tr>`;
}

// Milestone: binary-mode outcome tracking. Every number here comes from a
// real resolved bet (a real entry price compared against a real exit price
// N candles later) - buckets under the tracker's minimum sample size show
// "not enough data" instead of a percentage, rather than displaying a
// number that looks calibrated when it isn't.
export function renderBinaryStats(elements, binaryTracker, interval) {
    if (!elements.binaryStatsBody) return;

    const payoutRatio = clampPayoutRatio(elements.payoutRatioInput?.value);
    const stats = binaryTracker.getBinaryStats(undefined, payoutRatio);
    elements.binaryStatsBody.innerHTML = stats.length
        ? stats.map(row => `
            <tr>
                <td>${row.label}</td>
                <td>${expiryLabel(row.expiryLength, interval)}</td>
                <td>${row.trades}</td>
                <td>${row.reliable
                    ? `${formatNumber(row.winRate, 1)}%`
                    : `<span class="empty-history">not enough data (${row.trades}/${row.minSampleSize})</span>`}</td>
                <td>${formatNumber(row.breakevenWinRate, 1)}%</td>
                <td>${row.reliable ? `<span class="${edgeClass(row.edge)}">${formatSigned(row.edge)}%</span>` : "--"}</td>
                <td><span class="badge ${verdictClass(row.verdict)}">${row.verdict}</span></td>
            </tr>
        `).join("")
        : `<tr><td colspan="7" class="empty-history">No resolved binary trades yet</td></tr>`;

    renderCalibrationCurve(elements, binaryTracker);
}

export function renderCalibrationCurve(elements, binaryTracker) {
    if (!elements.calibrationBody) return;

    const buckets = binaryTracker.getCalibrationCurve();
    const anyReliable = buckets.some((b) => b.reliable);

    elements.calibrationBody.innerHTML = anyReliable
        ? buckets.map((b) => {
            const gap = b.reliable ? b.actualWinRate - b.predictedMidpoint : null;
            return `
                <tr>
                    <td>${b.rangeLabel}</td>
                    <td>${b.trades}</td>
                    <td>${b.reliable
                        ? `${formatNumber(b.actualWinRate, 1)}%`
                        : `<span class="empty-history">not enough data (${b.trades}/${b.minSampleSize})</span>`}</td>
                    <td>${gap != null ? `<span class="${gap >= 0 ? "edge-positive" : "edge-negative"}">${formatSigned(gap)}pp</span>` : "--"}</td>
                </tr>
            `;
        }).join("")
        : `<tr><td colspan="4" class="empty-history">Not enough resolved binary trades yet to check calibration (need ${buckets[0]?.minSampleSize ?? 20} per bucket)</td></tr>`;
}
