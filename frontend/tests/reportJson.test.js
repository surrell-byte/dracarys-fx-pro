import { describe, it, expect } from "vitest";
import { readJsonResponse } from "../src/js/components/reportJson.js";

describe("readJsonResponse", () => {
    it("rejects non-JSON report payloads before the component can render them", async () => {
        const response = {
            headers: { get: () => "text/html; charset=utf-8" },
            text: async () => "<html><body>No reports generated yet.</body></html>"
        };

        await expect(readJsonResponse(response, "Unable to load daily reports.")).rejects.toThrow("non-JSON");
    });

    it("parses a valid JSON report payload", async () => {
        const response = {
            headers: { get: () => "application/json; charset=utf-8" },
            text: async () => JSON.stringify({ reports: [{ id: 1 }] })
        };

        const payload = await readJsonResponse(response, "Unable to load daily reports.");
        expect(payload.reports).toHaveLength(1);
    });
});
