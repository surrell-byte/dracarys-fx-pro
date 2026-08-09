// Vercel serverless proxy for the private trading backend. The backend's
// shared-secret API key stays in Vercel environment variables and never
// reaches the browser bundle. The browser calls /api/trade; this function
// forwards to the real backend with the key attached.
export default async function handler(request, response) {
    if (request.method !== "POST") {
        response.status(405).json({ error: "Method not allowed" });
        return;
    }

    const backendUrl = process.env.TRADE_BACKEND_URL;
    const apiKey = process.env.TRADE_API_KEY;

    if (!backendUrl || !apiKey) {
        response.status(503).json({ error: "Trading backend has not been configured." });
        return;
    }

    try {
        const upstream = await fetch(`${backendUrl}/trade`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey
            },
            body: JSON.stringify(request.body),
            signal: AbortSignal.timeout(10_000)
        });

        const data = await upstream.json().catch(() => ({ error: "Invalid response from trading backend" }));
        response.status(upstream.status).json(data);
    } catch (error) {
        console.error("Trade proxy failed:", error.message);
        response.status(502).json({ error: "The trading backend could not be reached." });
    }
}
