import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendDiscordMessage, meetsNotifyThreshold } from "../scripts/scheduler/notify.js";

const ORIGINAL_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

beforeEach(() => {
    vi.unstubAllGlobals();
});

afterEach(() => {
    if (ORIGINAL_WEBHOOK === undefined) delete process.env.DISCORD_WEBHOOK_URL;
    else process.env.DISCORD_WEBHOOK_URL = ORIGINAL_WEBHOOK;
});

describe("sendDiscordMessage", () => {
    it("skips sending and returns false when no webhook URL is configured", async () => {
        delete process.env.DISCORD_WEBHOOK_URL;
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);

        const result = await sendDiscordMessage("hello");
        expect(result).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("posts the message as JSON to the configured webhook and returns true on success", async () => {
        process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";
        const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal("fetch", fetchSpy);

        const result = await sendDiscordMessage("hello world");

        expect(result).toBe(true);
        expect(fetchSpy).toHaveBeenCalledWith(
            "https://discord.com/api/webhooks/test",
            expect.objectContaining({
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: "hello world" })
            })
        );
    });

    it("returns false without throwing when Discord responds with a non-ok status", async () => {
        process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            text: async () => "Unknown Webhook"
        }));

        const result = await sendDiscordMessage("hello");
        expect(result).toBe(false);
    });

    it("returns false without throwing when the network request itself fails", async () => {
        process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

        // A notification failure must never take down the scheduler - this
        // is the whole reason sendDiscordMessage wraps the fetch in try/catch.
        const result = await sendDiscordMessage("hello");
        expect(result).toBe(false);
    });
});

describe("meetsNotifyThreshold", () => {
    const notifyConfig = { enabled: true, minConfidence: 75, minQuality: "Medium" };

    it("returns false outright when notifications are disabled", () => {
        expect(meetsNotifyThreshold({ confidence: 99, quality: "High" }, { enabled: false })).toBe(false);
    });

    it("requires both confidence and quality thresholds to be met", () => {
        expect(meetsNotifyThreshold({ confidence: 80, quality: "High" }, notifyConfig)).toBe(true);
        expect(meetsNotifyThreshold({ confidence: 60, quality: "High" }, notifyConfig)).toBe(false);
        expect(meetsNotifyThreshold({ confidence: 80, quality: "Low" }, notifyConfig)).toBe(false);
    });
});
