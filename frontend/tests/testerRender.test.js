// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderTester, renderBinaryStats, renderCalibrationCurve } from "@core/testerRender.js";

function makeElements(ids) {
    const els = {};
    for (const id of ids) {
        const el = document.createElement("tbody");
        els[id] = el;
    }
    return els;
}

describe("renderTester", () => {
    it("does nothing if any required table body is missing", () => {
        const elements = makeElements(["testerBody"]); // missing the other three
        expect(() => renderTester(elements, { getLeaderboard: () => [] })).not.toThrow();
        expect(elements.testerBody.innerHTML).toBe("");
    });

    it("renders leaderboard rows with pnl direction and a placeholder when empty", () => {
        const elements = makeElements(["testerBody", "regimeBody", "sessionBody", "assetBody"]);
        const tester = {
            getLeaderboard: () => [{ label: "Balanced", trades: 10, winRate: 55.5, totalPnl: 3.2, avgPnl: 0.32 }],
            getRegimeBreakdown: () => [],
            getSessionBreakdown: () => [],
            getAssetBreakdown: () => []
        };
        renderTester(elements, tester);

        expect(elements.testerBody.innerHTML).toContain("Balanced");
        expect(elements.testerBody.innerHTML).toContain('data-pnl="gain"');
        expect(elements.regimeBody.innerHTML).toContain("No closed trades yet");
    });

    it("marks losing rows with data-pnl=\"loss\" and flat rows with \"flat\"", () => {
        const elements = makeElements(["testerBody", "regimeBody", "sessionBody", "assetBody"]);
        const tester = {
            getLeaderboard: () => [
                { label: "A", trades: 1, winRate: 0, totalPnl: -1, avgPnl: -1 },
                { label: "B", trades: 1, winRate: 0, totalPnl: 0, avgPnl: 0 }
            ],
            getRegimeBreakdown: () => [],
            getSessionBreakdown: () => [],
            getAssetBreakdown: () => []
        };
        renderTester(elements, tester);
        expect(elements.testerBody.innerHTML).toContain('data-pnl="loss"');
        expect(elements.testerBody.innerHTML).toContain('data-pnl="flat"');
    });
});

describe("renderBinaryStats", () => {
    it("renders a placeholder row when there are no resolved trades", () => {
        const elements = makeElements(["binaryStatsBody", "calibrationBody"]);
        const binaryTracker = {
            getBinaryStats: () => [],
            getCalibrationCurve: () => [{ reliable: false, minSampleSize: 20 }]
        };
        renderBinaryStats(elements, binaryTracker, "5m");
        expect(elements.binaryStatsBody.innerHTML).toContain("No resolved binary trades yet");
    });

    it("renders a reliable row with expiry label and edge badge, and cascades into the calibration table", () => {
        const elements = makeElements(["binaryStatsBody", "calibrationBody"]);
        const binaryTracker = {
            getBinaryStats: () => [{
                label: "Balanced", expiryLength: 5, trades: 50,
                reliable: true, winRate: 62, breakevenWinRate: 54, edge: 8,
                verdict: "Edge detected: strong"
            }],
            getCalibrationCurve: () => [{
                rangeLabel: "60-65%", trades: 30, reliable: true,
                actualWinRate: 63, predictedMidpoint: 62.5, minSampleSize: 20
            }]
        };
        renderBinaryStats(elements, binaryTracker, "5m");

        expect(elements.binaryStatsBody.innerHTML).toContain("5 candles (~25m)");
        expect(elements.binaryStatsBody.innerHTML).toContain("edge-positive");
        expect(elements.binaryStatsBody.innerHTML).toContain("verdict-edge");
        // renderBinaryStats cascades into renderCalibrationCurve internally
        expect(elements.calibrationBody.innerHTML).toContain("60-65%");
    });

    it("shows a not-enough-data note for unreliable rows instead of a percentage", () => {
        const elements = makeElements(["binaryStatsBody", "calibrationBody"]);
        const binaryTracker = {
            getBinaryStats: () => [{
                label: "Balanced", expiryLength: 5, trades: 3,
                reliable: false, minSampleSize: 20, winRate: 0, breakevenWinRate: 54,
                edge: null, verdict: "Inconclusive"
            }],
            getCalibrationCurve: () => []
        };
        renderBinaryStats(elements, binaryTracker, "5m");
        expect(elements.binaryStatsBody.innerHTML).toContain("not enough data (3/20)");
    });
});

describe("renderCalibrationCurve", () => {
    it("shows the gap between predicted and actual win rate", () => {
        const elements = makeElements(["calibrationBody"]);
        const binaryTracker = {
            getCalibrationCurve: () => [{
                rangeLabel: "70-75%", trades: 25, reliable: true,
                actualWinRate: 71, predictedMidpoint: 72.5, minSampleSize: 20
            }]
        };
        renderCalibrationCurve(elements, binaryTracker);
        expect(elements.calibrationBody.innerHTML).toContain("edge-negative"); // 71 - 72.5 < 0
    });
});
