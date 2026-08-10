// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderBacktestResults, renderWalkForwardResults } from "@core/backtestRender.js";

function makeElements(ids) {
    const els = {};
    for (const id of ids) els[id] = document.createElement("tbody");
    return els;
}

describe("renderBacktestResults", () => {
    it("renders a placeholder row when there are no trades in the window", () => {
        const elements = makeElements(["backtestLeaderboardBody", "backtestBinaryBody"]);
        renderBacktestResults(elements, { spotLeaderboard: [], binaryStats: [] }, "5m");
        expect(elements.backtestLeaderboardBody.innerHTML).toContain("No trades in this window");
        expect(elements.backtestBinaryBody.innerHTML).toContain("No resolved binary bets in this window");
    });

    it("renders leaderboard metrics including confidence interval and profit factor", () => {
        const elements = makeElements(["backtestLeaderboardBody", "backtestBinaryBody"]);
        const result = {
            spotLeaderboard: [{
                label: "Balanced", trades: 40, winRate: 55, totalPnl: 12.5, avgPnl: 0.31,
                expectancy: 0.28, profitFactor: 1.6, maxDrawdown: 8.2, sharpe: 1.1,
                sampleReliable: true, winRateConfidenceInterval: { lower: 48, upper: 62 }
            }],
            binaryStats: []
        };
        renderBacktestResults(elements, result, "5m");

        const html = elements.backtestLeaderboardBody.innerHTML;
        expect(html).toContain('data-pnl="gain"');
        expect(html).toContain("1.60"); // profitFactor.toFixed(2)
        expect(html).toContain("48–62%");
    });

    it("flags an unreliable sample instead of showing a confidence interval", () => {
        const elements = makeElements(["backtestLeaderboardBody", "backtestBinaryBody"]);
        const result = {
            spotLeaderboard: [{
                label: "Scalping", trades: 3, winRate: 33, totalPnl: -2, avgPnl: -0.6,
                expectancy: null, profitFactor: null, maxDrawdown: 4, sharpe: null,
                sampleReliable: false, winRateConfidenceInterval: null
            }],
            binaryStats: []
        };
        renderBacktestResults(elements, result, "5m");
        expect(elements.backtestLeaderboardBody.innerHTML).toContain("n=3, too few");
        expect(elements.backtestLeaderboardBody.innerHTML).toContain('data-pnl="loss"');
    });

    it("renders binary stats with expiry label and edge badge", () => {
        const elements = makeElements(["backtestLeaderboardBody", "backtestBinaryBody"]);
        const result = {
            spotLeaderboard: [],
            binaryStats: [{
                label: "Balanced", expiryLength: 5, trades: 25, reliable: true,
                winRate: 60, breakevenWinRate: 54, edge: 6, verdict: "Edge detected: strong"
            }]
        };
        renderBacktestResults(elements, result, "5m");
        expect(elements.backtestBinaryBody.innerHTML).toContain("5 candles");
        expect(elements.backtestBinaryBody.innerHTML).toContain("edge-positive");
    });
});

describe("renderWalkForwardResults", () => {
    it("shows a no-trades placeholder spanning the fold columns when nothing traded in any fold", () => {
        const elements = makeElements(["backtestWalkForwardRanges", "backtestWalkForwardHead", "backtestWalkForwardBody"]);
        const result = {
            folds: [
                { fold: 1, from: 0, to: 1000, candleCount: 100, spotLeaderboard: [] },
                { fold: 2, from: 1000, to: 2000, candleCount: 100, spotLeaderboard: [] }
            ]
        };
        renderWalkForwardResults(elements, result);
        expect(elements.backtestWalkForwardBody.innerHTML).toContain("No trades across any fold");
        expect(elements.backtestWalkForwardHead.innerHTML).toContain("Fold 1 PnL");
        expect(elements.backtestWalkForwardHead.innerHTML).toContain("Fold 2 PnL");
    });

    it("builds one row per strategy across folds, sorted by avg PnL, with a folds-positive count", () => {
        const elements = makeElements(["backtestWalkForwardRanges", "backtestWalkForwardHead", "backtestWalkForwardBody"]);
        const result = {
            folds: [
                {
                    fold: 1, from: 0, to: 1000, candleCount: 100,
                    spotLeaderboard: [
                        { strategy: "balanced", label: "Balanced", trades: 5, totalPnl: 2 },
                        { strategy: "trend", label: "Trend", trades: 4, totalPnl: -1 }
                    ]
                },
                {
                    fold: 2, from: 1000, to: 2000, candleCount: 100,
                    spotLeaderboard: [
                        { strategy: "balanced", label: "Balanced", trades: 6, totalPnl: 3 }
                        // "trend" has no trades in fold 2 - should render as "--"
                    ]
                }
            ]
        };
        renderWalkForwardResults(elements, result);

        const html = elements.backtestWalkForwardBody.innerHTML;
        // Balanced (avg 2.5) should sort above Trend (avg -1)
        expect(html.indexOf("Balanced")).toBeLessThan(html.indexOf("Trend"));
        expect(html).toContain('data-pnl="gain"');
        expect(html).toContain('class="empty-history">--</td>'); // trend's missing fold 2
        expect(html).toContain("2/2"); // balanced traded positively in both folds it appeared in
    });

    it("formats the fold date range summary", () => {
        const elements = makeElements(["backtestWalkForwardRanges", "backtestWalkForwardHead", "backtestWalkForwardBody"]);
        const result = {
            folds: [{ fold: 1, from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 0, 8), candleCount: 2016, spotLeaderboard: [] }]
        };
        renderWalkForwardResults(elements, result);
        expect(elements.backtestWalkForwardRanges.textContent).toContain("Fold 1:");
        expect(elements.backtestWalkForwardRanges.textContent).toContain("2,016 candles");
    });
});
