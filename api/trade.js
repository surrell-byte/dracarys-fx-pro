// Vercel serverless proxy for the private trading backend.
// The backend's shared-secret API key stays in Vercel env vars
// and never reaches the browser bundle.

const ALLOWED_MODES = new Set(["dry-run", "paper", "live"]);
const MAX_BODY_BYTES = 64 * 1024; // 64 KB - well above expected trade payload

function createTimeoutSignal(ms) {
  // AbortSignal.timeout() is Node.js 18+; polyfill for older runtimes.
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

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

  // Read and cap body size
  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    response.status(400).json({ error: "Unable to read request body." });
    return;
  }
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    response.status(413).json({ error: "Request body too large." });
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    response.status(400).json({ error: "Invalid JSON body." });
    return;
  }

  // Early validation - reject obviously bad requests before hitting backend
  const validationErrors = [];
  if (!body.signal || !["BUY", "SELL", "HOLD"].includes(body.signal.type)) {
    validationErrors.push("signal.type must be BUY, SELL, or HOLD");
  }
  if (typeof body.symbol !== "string" || !/^[A-Z0-9]+\/[A-Z0-9]+$/i.test(body.symbol)) {
    validationErrors.push("symbol must look like BASE/QUOTE (e.g. BTC/USDT)");
  }
  if (typeof body.quantity !== "number" || !(body.quantity > 0)) {
    validationErrors.push("quantity must be a positive number");
  }
  if (!ALLOWED_MODES.has(body.mode)) {
    validationErrors.push("mode must be one of: dry-run, paper, live");
  }
  for (const field of ["stopLoss", "takeProfit"]) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== "number") {
      validationErrors.push(`${field} must be a number or null`);
    }
  }

  if (validationErrors.length > 0) {
    response.status(400).json({ error: "Invalid trade request", details: validationErrors });
    return;
  }

  // Audit log for live trades
  if (body.mode === "live") {
    console.log(JSON.stringify({
      event: "trade_proxy",
      mode: "live",
      symbol: body.symbol,
      quantity: body.quantity,
      side: body.signal.type,
      timestamp: new Date().toISOString()
    }));
  }

  try {
    const upstream = await fetch(`${backendUrl}/trade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: rawBody,
      signal: createTimeoutSignal(10_000)
    });

    const contentType = upstream.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await upstream.json()
      : { error: await upstream.text() };

    response.status(upstream.status).json(data);
  } catch (error) {
    console.error("Trade proxy failed:", error.message);
    if (error.name === "AbortError") {
      response.status(504).json({ error: "Trading backend request timed out." });
    } else {
      response.status(502).json({ error: "The trading backend could not be reached." });
    }
  }
}
