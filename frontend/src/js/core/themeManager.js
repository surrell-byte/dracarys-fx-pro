// Theme engine: swaps the `data-theme` attribute on <html>, which is all
// themes.css needs to re-skin the whole app (every color in the CSS module
// files is a var() that traces back to the tokens each theme overrides).
//
// This module owns no DOM elements itself except a single toast node — the
// dropdown and floating button live in components/themeSelector.js, which
// imports this as the source of truth so both stay in sync.

const STORAGE_KEY = "dracarysfxpro-theme";

const THEMES = [
    { id: "tradingview", name: "TradingView" },
    { id: "bloomberg", name: "Bloomberg" },
    { id: "matrix", name: "Matrix" },
    { id: "cyberpunk", name: "Cyberpunk" },
    { id: "midnight", name: "Midnight" },
    { id: "professional", name: "Professional" }
];

let currentIndex = 0;
let toastEl = null;
let toastHideTimer = null;
let toastRemoveTimer = null;

function findIndex(id) {
    const idx = THEMES.findIndex((t) => t.id === id);
    return idx === -1 ? 0 : idx;
}

function readSavedThemeId() {
    try {
        return window.localStorage.getItem(STORAGE_KEY);
    } catch {
        // localStorage can throw in locked-down environments (private
        // browsing, disabled storage) — theme switching still works,
        // it just won't persist across reloads.
        return null;
    }
}

function saveThemeId(id) {
    try {
        window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
        /* ignore, see readSavedThemeId */
    }
}

function showToast(message) {
    if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.className = "theme-toast";
        document.body.appendChild(toastEl);
    }

    clearTimeout(toastHideTimer);
    clearTimeout(toastRemoveTimer);

    toastEl.textContent = message;
    toastEl.classList.remove("show");
    // force reflow so the transition re-triggers if a toast is already visible
    void toastEl.offsetWidth;

    requestAnimationFrame(() => {
        toastEl.classList.add("show");
    });

    toastHideTimer = setTimeout(() => {
        toastEl.classList.remove("show");
    }, 2200);
}

function applyTheme(id, { silent = false } = {}) {
    currentIndex = findIndex(id);
    const theme = THEMES[currentIndex];

    document.documentElement.dataset.theme = theme.id;
    document.title = `Dracarys FX Pro • ${theme.name}`;
    saveThemeId(theme.id);

    document.dispatchEvent(
        new CustomEvent("themechange", { detail: { id: theme.id, name: theme.name } })
    );

    if (!silent) {
        showToast(`${theme.name} Theme Activated`);
    }
}

function nextTheme() {
    const next = THEMES[(currentIndex + 1) % THEMES.length];
    applyTheme(next.id);
}

function previousTheme() {
    const prev = THEMES[(currentIndex - 1 + THEMES.length) % THEMES.length];
    applyTheme(prev.id);
}

function init() {
    const saved = readSavedThemeId();
    const initial = saved && THEMES.some((t) => t.id === saved) ? saved : THEMES[0].id;
    applyTheme(initial, { silent: true });

    document.addEventListener("keydown", (e) => {
        // Don't hijack F9/F8 while someone is typing in a field/select.
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

        if (e.key === "F9") {
            e.preventDefault();
            nextTheme();
        } else if (e.key === "F8") {
            e.preventDefault();
            previousTheme();
        }
    });
}

function getThemes() {
    return THEMES.slice();
}

function getCurrentThemeId() {
    return THEMES[currentIndex].id;
}

const themeManager = {
    init,
    applyTheme,
    nextTheme,
    previousTheme,
    showToast,
    getThemes,
    getCurrentThemeId
};

export default themeManager;
