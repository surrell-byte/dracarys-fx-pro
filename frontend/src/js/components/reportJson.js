export async function readJsonResponse(response, fallbackMessage = "Unable to load report data.") {
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();

    if (!text.trim()) {
        throw new Error(fallbackMessage);
    }

    const looksJson = text.trim().startsWith("{") || text.trim().startsWith("[");
    if (!contentType.includes("application/json") && !looksJson) {
        throw new Error("Report endpoint returned non-JSON content.");
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Error(fallbackMessage);
    }
}
