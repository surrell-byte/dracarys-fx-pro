// Manual Presentation Mode toggle for smartboards/classroom displays -
// large text, simplified nav, high contrast. Deliberately separate from
// app.js (which already handles live data/signals) so this small,
// self-contained feature can't introduce a regression there.
// Persists the choice in localStorage so it survives a page reload.

const STORAGE_KEY = "dracarysfxpro-presentation-mode";

function applyState(enabled) {
    document.body.classList.toggle("presentation-mode", enabled);
    const btn = document.getElementById("quickPresentation");
    if (btn) {
        btn.setAttribute("aria-pressed", String(enabled));
        btn.title = enabled ? "Exit Presentation Mode" : "Enter Presentation Mode (smartboard)";
    }
}

function init() {
    const saved = localStorage.getItem(STORAGE_KEY) === "true";
    applyState(saved);

    const btn = document.getElementById("quickPresentation");
    if (!btn) return;

    btn.addEventListener("click", () => {
        const next = !document.body.classList.contains("presentation-mode");
        localStorage.setItem(STORAGE_KEY, String(next));
        applyState(next);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
