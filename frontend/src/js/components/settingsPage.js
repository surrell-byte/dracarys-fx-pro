import demo from "@demo/demoAccount.js";
import { clearJournal } from "@demo/journal.js";

const STORAGE_KEY = "dracarysfxpro-settings";
const PRESENTATION_KEY = "dracarysfxpro-presentation-mode";

const page = document.querySelector("#page-settings");

function readSettings() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

function saveSettings(patch) {
    const current = readSettings();
    const next = { ...current, ...patch };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    return next;
}

function flashSaved(noteEl) {
    if (!noteEl) return;
    noteEl.hidden = false;
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => { noteEl.hidden = true; }, 1600);
}

function applyNotificationPref(show) {
    document.querySelectorAll(".icon-btn--has-badge .notif-dot").forEach((dot) => {
        dot.style.display = show ? "" : "none";
    });
}

function applyReduceMotion(reduce) {
    document.documentElement.classList.toggle("reduce-motion", reduce);
}

function applyDisplayName(name) {
    const label = (name || "Trader").trim() || "Trader";
    document.querySelectorAll("#topbarUserName, .profile-username").forEach((el) => {
        el.textContent = label;
    });
}

function init() {
    if (!page) return;

    const nameInput = page.querySelector("#settingsDisplayName");
    const presentationToggle = page.querySelector("#settingsPresentationMode");
    const notificationsToggle = page.querySelector("#settingsNotifications");
    const reduceMotionToggle = page.querySelector("#settingsReduceMotion");
    const resetBtn = page.querySelector("#settingsResetDemo");
    const savedNote = page.querySelector("#settingsSavedNote");

    const settings = readSettings();
    const presentationActive = localStorage.getItem(PRESENTATION_KEY) === "true";

    if (nameInput) nameInput.value = settings.displayName || "";
    if (presentationToggle) presentationToggle.checked = presentationActive;
    if (notificationsToggle) notificationsToggle.checked = settings.notifications !== false;
    if (reduceMotionToggle) reduceMotionToggle.checked = !!settings.reduceMotion;

    applyDisplayName(settings.displayName);
    applyNotificationPref(settings.notifications !== false);
    applyReduceMotion(!!settings.reduceMotion);

    nameInput?.addEventListener("input", () => {
        saveSettings({ displayName: nameInput.value });
        applyDisplayName(nameInput.value);
        flashSaved(savedNote);
    });

    presentationToggle?.addEventListener("change", () => {
        const enabled = presentationToggle.checked;
        try {
            localStorage.setItem(PRESENTATION_KEY, String(enabled));
        } catch {}
        document.body.classList.toggle("presentation-mode", enabled);
        const quickBtn = document.getElementById("quickPresentation");
        if (quickBtn) {
            quickBtn.setAttribute("aria-pressed", String(enabled));
            quickBtn.title = enabled ? "Exit Presentation Mode" : "Enter Presentation Mode (smartboard)";
        }
        flashSaved(savedNote);
    });

    notificationsToggle?.addEventListener("change", () => {
        saveSettings({ notifications: notificationsToggle.checked });
        applyNotificationPref(notificationsToggle.checked);
        flashSaved(savedNote);
    });

    reduceMotionToggle?.addEventListener("change", () => {
        saveSettings({ reduceMotion: reduceMotionToggle.checked });
        applyReduceMotion(reduceMotionToggle.checked);
        flashSaved(savedNote);
    });

    resetBtn?.addEventListener("click", () => {
        const confirmed = window.confirm("Reset the demo account? This clears balance, trade history, and the AI journal. Trading pair, strategy, and theme choices are kept.");
        if (!confirmed) return;
        demo.reset();
        clearJournal();
        flashSaved(savedNote);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
