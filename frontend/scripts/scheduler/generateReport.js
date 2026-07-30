// IO wrapper around report.js's pure functions: pulls today's closed
// signals + all still-open signals from SQLite, builds the report data,
// renders HTML, writes it to disk. Callable both from the scheduler's
// daily cron and manually via `npm run report`.

import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { getClosedSignalsSince, getAllOpenSignals } from "./db.js";
import { buildReportData, renderReportHtml } from "./report.js";

export function generateReport({ date = new Date() } = {}) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const closedRows = getClosedSignalsSince(startOfDay.toISOString());
    const openRows = getAllOpenSignals();

    const dateLabel = date.toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    const data = buildReportData(closedRows, openRows, dateLabel);
    const html = renderReportHtml(data);

    fs.mkdirSync(config.reportsDir, { recursive: true });
    const filename = `report-${date.toISOString().slice(0, 10)}.html`;
    const filepath = path.join(config.reportsDir, filename);
    fs.writeFileSync(filepath, html);

    return { filepath, data };
}
