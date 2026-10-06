#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { flattenResearchTrades } from "../../src/js/analysis/scorecard.js";

function parseArgs(argv) {
    const args = { input: "reports/analysis/multi-market-walk-forward.json", strategy: null, out: null };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--input") args.input = argv[++i];
        if (argv[i] === "--strategy") args.strategy = argv[++i];
        if (argv[i] === "--out") args.out = argv[++i];
    }
    return args;
}

function csvEscape(v) {
    if (v == null) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.strategy) { console.error("Pass --strategy <id>"); process.exit(1); }
    const raw = await fs.readFile(path.resolve(args.input), "utf8");
    const report = JSON.parse(raw);
    const allTrades = flattenResearchTrades(report);
    const trades = allTrades.filter((t) => t.strategy === args.strategy);
    if (!trades.length) { console.error(`No trades for ${args.strategy}`); process.exit(1); }

    const outPath = path.resolve(args.out || `reports/analysis/${args.strategy}-trades.csv`);
    const header = ["time","symbol","market","strategy","side","pnlPercent","grossPnlPercent","costDragPercent","maePercent","mfePercent","holdingCandles","closeReason"].join(",") + "\n";
    const lines = trades.map((t) => [t.time, t.symbol, t.market, t.strategy, t.side, t.pnlPercent, t.grossPnlPercent, t.costDragPercent, t.maePercent, t.mfePercent, t.holdingCandles, t.closeReason].map(csvEscape).join(","));
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, header + lines.join("\n") + "\n", "utf8");
    console.log(`Wrote ${trades.length} trades to ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
