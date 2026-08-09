// Same-origin proxy for historical trades and saved daily/weekly snapshots.
// Only known read-only upstream routes may be requested.
export default async function handler(request, response) {
    const url = process.env.REPORTS_API_URL;
    const user = process.env.REPORTS_API_USER;
    const password = process.env.REPORTS_API_PASSWORD;
    const route = String(request.query.route || "history");
    const allowed = new Set(["history", "reports/daily", "reports/weekly"]);

    if (!url || !user || !password) {
        response.status(503).json({ error: "Live reports have not been configured." });
        return;
    }
    if (!allowed.has(route)) {
        response.status(400).json({ error: "Unknown report route." });
        return;
    }

    try {
        const upstreamUrl = new URL(url);
        upstreamUrl.pathname = `/api/${route}`;
        if (request.query.limit) upstreamUrl.searchParams.set("limit", String(request.query.limit));
        const upstream = await fetch(upstreamUrl, {
            headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` },
            signal: AbortSignal.timeout(10_000)
        });
        if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`);
        response.setHeader("Cache-Control", "no-store, max-age=0");
        response.status(200).json(await upstream.json());
    } catch (error) {
        console.error("Report history proxy failed:", error.message);
        response.status(502).json({ error: "The report server could not be reached." });
    }
}
