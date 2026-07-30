import "dotenv/config";
// One-off manual report generation, for testing or generating a report
// on demand outside the daily cron schedule.
//   npx vite-node -c vite.config.js scripts/scheduler/cli-report.js
import { generateReport } from "./generateReport.js";

const { filepath } = generateReport();
console.log(`Report written to ${filepath}`);
