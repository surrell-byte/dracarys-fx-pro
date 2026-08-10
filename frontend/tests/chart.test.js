import { describe, it, expect, vi } from "vitest";
import { drawChart, resizeCanvas } from "@core/chart.js";

function makeFakeCtx() {
    return {
        calls: [],
        clearRect(...a) { this.calls.push(["clearRect", ...a]); },
        beginPath() { this.calls.push(["beginPath"]); },
        moveTo(...a) { this.calls.push(["moveTo", ...a]); },
        lineTo(...a) { this.calls.push(["lineTo", ...a]); },
        stroke() { this.calls.push(["stroke"]); },
        fillText(...a) { this.calls.push(["fillText", ...a]); },
        setTransform() {},
        set lineWidth(v) {}, set strokeStyle(v) {}, set fillStyle(v) {}, set font(v) {}
    };
}

function makeFakeCanvas(rect = { width: 400, height: 200 }) {
    return {
        width: 0,
        height: 0,
        getBoundingClientRect: () => rect
    };
}

function candle(close) {
    return { time: 0, open: close, high: close, low: close, close, volume: 1 };
}

describe("resizeCanvas", () => {
    it("sizes the canvas to the bounding rect times device pixel ratio", () => {
        const canvas = makeFakeCanvas({ width: 300, height: 150 });
        const ctx = makeFakeCtx();
        const { width, height } = resizeCanvas(canvas, ctx);
        expect(width).toBe(300);
        expect(height).toBe(150);
        expect(canvas.width).toBe(300); // devicePixelRatio is 1 in jsdom
    });
});

describe("drawChart", () => {
    it("does nothing beyond clearing when fewer than 2 candles are given", () => {
        const canvas = makeFakeCanvas();
        const ctx = makeFakeCtx();
        drawChart(canvas, ctx, [candle(100)]);
        expect(ctx.calls.some(c => c[0] === "clearRect")).toBe(true);
        expect(ctx.calls.some(c => c[0] === "stroke")).toBe(false);
    });

    it("draws a line through every visible candle and labels the high/low", () => {
        const canvas = makeFakeCanvas();
        const ctx = makeFakeCtx();
        const candles = [candle(100), candle(110), candle(90), candle(105)];
        drawChart(canvas, ctx, candles);

        const moveTos = ctx.calls.filter(c => c[0] === "moveTo");
        const lineTos = ctx.calls.filter(c => c[0] === "lineTo");
        expect(moveTos.length).toBe(1); // first point only
        expect(lineTos.length).toBe(candles.length - 1);

        const fillTexts = ctx.calls.filter(c => c[0] === "fillText");
        expect(fillTexts).toEqual([
            ["fillText", "110", 8, 16],
            ["fillText", "90", 8, expect.any(Number)]
        ]);
    });

    it("only plots the most recent 80 candles", () => {
        const canvas = makeFakeCanvas();
        const ctx = makeFakeCtx();
        const candles = Array.from({ length: 200 }, (_, i) => candle(100 + i));
        drawChart(canvas, ctx, candles);

        const lineTos = ctx.calls.filter(c => c[0] === "lineTo");
        expect(lineTos.length).toBe(79); // 80 visible points -> 79 line segments
    });
});
