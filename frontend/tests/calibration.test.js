import { describe, expect, it } from "vitest";
import {
    createConfidenceBuckets,
    computeCalibrationError,
    buildEmpiricalCalibration,
    extractPredictionsFromTrades
} from "@analysis/calibration.js";

function makePredictions(confidence, wins, losses) {
    const preds = [];
    for (let i = 0; i < wins; i += 1) preds.push({ confidence, outcome: "win" });
    for (let i = 0; i < losses; i += 1) preds.push({ confidence, outcome: "loss" });
    return preds;
}

describe("createConfidenceBuckets", () => {
    it("groups predictions into fixed-width buckets", () => {
        const predictions = [...makePredictions(62, 6, 4), ...makePredictions(68, 3, 2)];
        const buckets = createConfidenceBuckets(predictions, 5);

        const b60 = buckets.find((b) => b.bucketStart === 60);
        const b65 = buckets.find((b) => b.bucketStart === 65);

        expect(b60.predictions).toBe(10);
        expect(b60.wins).toBe(6);
        expect(b60.actualWinRate).toBeCloseTo(60, 5);

        expect(b65.predictions).toBe(5);
        expect(b65.wins).toBe(3);
        expect(b65.actualWinRate).toBeCloseTo(60, 5);
    });

    it("ignores non-finite confidence and null/undefined entries", () => {
        const buckets = createConfidenceBuckets([
            { confidence: NaN, outcome: "win" },
            null,
            undefined,
            { confidence: 50, outcome: "win" }
        ]);
        expect(buckets).toHaveLength(1);
        expect(buckets[0].predictions).toBe(1);
    });

    it("returns an empty array for empty input", () => {
        expect(createConfidenceBuckets([])).toEqual([]);
        expect(createConfidenceBuckets(undefined)).toEqual([]);
    });

    it("clamps out-of-range confidence into the nearest valid bucket", () => {
        const buckets = createConfidenceBuckets([{ confidence: 140, outcome: "win" }], 5);
        expect(buckets[0].bucketStart).toBe(100);
    });

    it("leaves actualWinRate null when a bucket has no win/loss outcomes", () => {
        const buckets = createConfidenceBuckets([{ confidence: 50, outcome: "pending" }]);
        expect(buckets[0].predictions).toBe(1);
        expect(buckets[0].actualWinRate).toBeNull();
    });
});

describe("computeCalibrationError", () => {
    it("is 0 when predicted midpoint exactly matches observed win rate", () => {
        const buckets = [
            { bucketStart: 50, bucketEnd: 60, predictions: 10, wins: 5, losses: 5, actualWinRate: 50, predictedMidpoint: 50 }
        ];
        expect(computeCalibrationError(buckets)).toBe(0);
    });

    it("weights the error by each bucket's sample count", () => {
        const buckets = [
            { predictions: 90, wins: 90, losses: 0, actualWinRate: 100, predictedMidpoint: 50 },
            { predictions: 10, wins: 0, losses: 10, actualWinRate: 0, predictedMidpoint: 50 }
        ];
        expect(computeCalibrationError(buckets)).toBeCloseTo(50, 5);
    });

    it("returns null when there is nothing usable", () => {
        expect(computeCalibrationError([])).toBeNull();
        expect(
            computeCalibrationError([
                { predictions: 0, wins: 0, losses: 0, actualWinRate: null, predictedMidpoint: 50 }
            ])
        ).toBeNull();
    });
});

describe("buildEmpiricalCalibration", () => {
    it("only trusts buckets that meet minObservations", () => {
        const predictions = [...makePredictions(72, 20, 5), ...makePredictions(37, 20, 20)];
        const calibration = buildEmpiricalCalibration(predictions);
        expect(calibration.calibratedConfidence(72)).toBeNull();
        expect(calibration.calibratedConfidence(37)).toBeCloseTo(50, 5);
    });

    it("respects a custom minObservations", () => {
        const predictions = makePredictions(80, 4, 1);
        const calibration = buildEmpiricalCalibration(predictions, { minObservations: 5 });
        expect(calibration.calibratedConfidence(80)).toBeCloseTo(80, 5);
    });

    it("returns null from calibratedConfidence for a bucket with no data", () => {
        const calibration = buildEmpiricalCalibration(makePredictions(50, 40, 10));
        expect(calibration.calibratedConfidence(95)).toBeNull();
    });

    it("exposes calibrationError computed only over usable buckets", () => {
        const predictions = [...makePredictions(90, 2, 0), ...makePredictions(50, 15, 15)];
        const calibration = buildEmpiricalCalibration(predictions, { minObservations: 10 });
        expect(calibration.usableBuckets).toHaveLength(1);
        expect(calibration.calibrationError).not.toBeNull();
    });
});

describe("extractPredictionsFromTrades", () => {
    it("maps confidence/outcome off trade records and drops unusable ones", () => {
        const trades = [
            { confidence: 65, outcome: "win", pnlPercent: 1.2 },
            { confidence: null, outcome: "loss", pnlPercent: -0.5 },
            { outcome: "win", pnlPercent: 0.3 },
            { confidence: 40, outcome: "loss", pnlPercent: -0.8 }
        ];
        expect(extractPredictionsFromTrades(trades)).toEqual([
            { confidence: 65, outcome: "win" },
            { confidence: 40, outcome: "loss" }
        ]);
    });

    it("handles empty/undefined input", () => {
        expect(extractPredictionsFromTrades([])).toEqual([]);
        expect(extractPredictionsFromTrades(undefined)).toEqual([]);
    });
});
