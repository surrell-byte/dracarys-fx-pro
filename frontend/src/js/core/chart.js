// Sparkline-style price chart for the dashboard canvas. Extracted from
// app.js byte-identical except for taking (canvas, ctx, candles) as
// explicit parameters instead of reading app.js's module-level `elements`
// and `state` directly - that's what lets this file be imported by app.js
// rather than the other way around, avoiding a circular dependency.
import { formatPrice } from "@core/format.js";

export function resizeCanvas(canvas, ctx) {
    const pixelRatio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width * pixelRatio);
    const height = Math.floor(rect.height * pixelRatio);

    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    return { width: rect.width, height: rect.height };
}

export function drawChart(canvas, ctx, candles) {
    const visible = candles.slice(-80);
    const { width, height } = resizeCanvas(canvas, ctx);

    ctx.clearRect(0, 0, width, height);

    if (visible.length < 2) return;

    const closes = visible.map(candle => candle.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const xStep = width / (visible.length - 1);

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#56d6a7";
    ctx.beginPath();

    visible.forEach((candle, index) => {
        const x = index * xStep;
        const y = height - (((candle.close - min) / range) * (height - 28)) - 14;

        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();

    ctx.fillStyle = "#475569";
    ctx.font = "12px Arial";
    ctx.fillText(formatPrice(max), 8, 16);
    ctx.fillText(formatPrice(min), 8, height - 8);
}
