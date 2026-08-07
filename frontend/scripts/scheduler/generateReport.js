// IO wrapper around report.js's pure functions: pulls today's closed
// signals + all still-open signals from SQLite, builds the report data,
// renders HTML, writes it to disk. Callable both from the scheduler's
// daily cron and manually via `npm run report`.

import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { getClosedSignalsSince, getAllOpenSignals, saveReportSnapshot } from "./db.js";
import { buildReportData, renderReportHtml } from "./report.js";

// Data-only entry point for the live API. A dashboard refresh must not write
// another HTML report file to disk.
export function getLiveReportData({ date = new Date(), period = "daily" } = {}) {
    const periodStart = startForPeriod(date, period);

    const closedRows = getClosedSignalsSince(periodStart.toISOString());
    const openRows = getAllOpenSignals();

    const dateLabel = periodLabel(periodStart, date, period);

    return {
        ...buildReportData(closedRows, openRows, dateLabel),
        reportType: period,
        periodStart: periodStart.toISOString(),
        periodEnd: date.toISOString()
    };
}

export function generateReport({ date = new Date(), period = "daily" } = {}) {
    const data = getLiveReportData({ date, period });
    const html = renderReportHtml(data);

    fs.mkdirSync(config.reportsDir, { recursive: true });
    const filename = `${period}-report-${date.toISOString().slice(0, 10)}.html`;
    const filepath = path.join(config.reportsDir, filename);
    fs.writeFileSync(filepath, html);
    saveReportSnapshot({
        reportType: period,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        generatedAt: data.generatedAt,
        payload: data
    });

    return { filepath, data };
}

function startForPeriod(date, period) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    if (period === "weekly") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
}

function periodLabel(start, end, period) {
    if (period === "weekly") {
        return `Week of ${start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return end.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
