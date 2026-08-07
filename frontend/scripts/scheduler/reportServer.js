// A small, dependency-free read-only file server for the daily HTML
// reports, so they're viewable from a phone browser instead of only
// living on the server's disk. Deliberately separate from
// runScheduler.js - a bug or crash here can never take down the actual
// trading scheduler, and vice versa.
//
// Auth: HTTP Basic Auth, credentials from REPORTS_USER / REPORTS_PASSWORD
// in frontend/.env. This is the minimum needed before exposing anything
// on a public IP - it is NOT strong security (no rate limiting, no
// HTTPS on its own), so don't reuse a password you care about elsewhere,
// and see reportServer.js's companion setup script for putting this
// behind a firewall rule that isn't wide open to the whole internet.

import "dotenv/config";
import http from "http";
import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { getLiveReportData } from "./generateReport.js";
import { getRecentClosedSignals, getReportSnapshots } from "./db.js";

const PORT = process.env.REPORTS_PORT || 8787;
const USER = process.env.REPORTS_USER;
const PASSWORD = process.env.REPORTS_PASSWORD;
const CORS_ORIGIN = process.env.REPORTS_CORS_ORIGIN || "";

if (!USER || !PASSWORD) {
    console.error(
        "REPORTS_USER and REPORTS_PASSWORD must be set in frontend/.env before " +
        "starting the report server - see .env.example for the two lines to add."
    );
    process.exit(1);
}

function checkAuth(req) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Basic ")) return false;
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const user = decoded.slice(0, separator);
    const pass = decoded.slice(separator + 1);
    return user === USER && pass === PASSWORD;
}

function apiHeaders(extra = {}) {
    return CORS_ORIGIN ? { "Access-Control-Allow-Origin": CORS_ORIGIN, ...extra } : extra;
}

function listReports() {
    if (!fs.existsSync(config.reportsDir)) return [];
    return fs.readdirSync(config.reportsDir)
        .filter(f => f.endsWith(".html"))
        .sort()
        .reverse(); // most recent first
}

const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, apiHeaders({
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization",
            "Access-Control-Max-Age": "86400"
        }));
        res.end();
        return;
    }

    if (!checkAuth(req)) {
        res.writeHead(401, apiHeaders({ "WWW-Authenticate": 'Basic realm="Dracarys FX Pro Reports"' }));
        res.end("Authentication required.");
        return;
    }

    const url = decodeURIComponent(req.url.split("?")[0]);

    if (req.method === "GET" && url === "/api/latest") {
        try {
            res.writeHead(200, apiHeaders({
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            }));
            res.end(JSON.stringify(getLiveReportData()));
        } catch (error) {
            console.error("Failed to build live report data:", error);
            res.writeHead(500, apiHeaders({ "Content-Type": "application/json; charset=utf-8" }));
            res.end(JSON.stringify({ error: "Failed to load live report data." }));
        }
        return;
    }

    if (req.method === "GET" && url === "/api/history") {
        try {
            const query = new URL(req.url, "http://localhost").searchParams;
            const limit = query.get("limit") || 100;
            res.writeHead(200, apiHeaders({
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            }));
            res.end(JSON.stringify({ trades: getRecentClosedSignals(limit) }));
        } catch (error) {
            console.error("Failed to load trade history:", error);
            res.writeHead(500, apiHeaders({ "Content-Type": "application/json; charset=utf-8" }));
            res.end(JSON.stringify({ error: "Failed to load trade history." }));
        }
        return;
    }

    if (req.method === "GET" && /^\/api\/reports\/(daily|weekly)$/.test(url)) {
        try {
            const reportType = url.split("/").at(-1);
            const query = new URL(req.url, "http://localhost").searchParams;
            res.writeHead(200, apiHeaders({
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            }));
            res.end(JSON.stringify({ reports: getReportSnapshots(reportType, query.get("limit") || 12) }));
        } catch (error) {
            console.error("Failed to load report snapshots:", error);
            res.writeHead(500, apiHeaders({ "Content-Type": "application/json; charset=utf-8" }));
            res.end(JSON.stringify({ error: "Failed to load report snapshots." }));
        }
        return;
    }

    if (url === "/" || url === "/index.html") {
        const files = listReports();
        const items = files.length
            ? files.map(f => `<li><a href="/reports/${f}">${f}</a></li>`).join("")
            : "<li>No reports generated yet.</li>";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8">
            <title>Dracarys FX Pro — Reports</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { background:#0a0f0c; color:#eef2ef; font-family:-apple-system,sans-serif; padding:24px; }
                h1 { font-size:18px; }
                ul { padding-left:20px; line-height:1.9; }
                a { color:#22c55e; text-decoration:none; }
                a:hover { text-decoration:underline; }
            </style></head>
            <body><h1>Daily Reports</h1><ul>${items}</ul></body></html>`);
        return;
    }

    if (url.startsWith("/reports/")) {
        const filename = path.basename(url.replace("/reports/", ""));
        const filepath = path.join(config.reportsDir, filename);
        if (!filepath.startsWith(config.reportsDir) || !fs.existsSync(filepath)) {
            res.writeHead(404);
            res.end("Not found.");
            return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        fs.createReadStream(filepath).pipe(res);
        return;
    }

    res.writeHead(404);
    res.end("Not found.");
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`Report server listening on port ${PORT}. Reports dir: ${config.reportsDir}`);
});
