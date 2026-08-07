// Vercel serverless proxy for the private GCP report API. The upstream Basic
// Auth credentials stay in Vercel environment variables and never reach the
// browser bundle.
export default async function handler(request, response) {
    const url = process.env.REPORTS_API_URL;
    const user = process.env.REPORTS_API_USER;
    const password = process.env.REPORTS_API_PASSWORD;

    if (!url || !user || !password) {
        response.status(503).json({ error: "Live reports have not been configured." });
        return;
    }

    try {
        const upstream = await fetch(url, {
            headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` },
            signal: AbortSignal.timeout(10_000)
        });
        if (!upstream.ok) {
            response.status(502).json({ error: "The report server could not be reached." });
            return;
        }
        response.setHeader("Cache-Control", "no-store, max-age=0");
        response.status(200).json(await upstream.json());
    } catch (error) {
        console.error("Live reports proxy failed:", error.message);
        response.status(502).json({ error: "The report server could not be reached." });
    }
}
