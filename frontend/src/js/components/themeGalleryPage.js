import themeManager from "@core/themeManager.js";

const SWATCHES = {
    "playful-blue": { primary: "#2563EB", panel: "#FFFFFF", bg: "#F8FAFC" },
    "dark-classic": { primary: "#22c55e", panel: "#101613", bg: "#0a0f0c" },
    "tradingview": { primary: "#ffb000", panel: "#14110d", bg: "#0a0807" },
    "bloomberg": { primary: "#ff9500", panel: "#0d0d0d", bg: "#000000" },
    "matrix": { primary: "#00ff66", panel: "#061206", bg: "#020402" },
    "cyberpunk": { primary: "#ff2e88", panel: "#170b2e", bg: "#0b0116" },
    "midnight": { primary: "#4ba3ff", panel: "#0d1830", bg: "#050b1a" },
    "professional": { primary: "#3b82f6", panel: "#171b21", bg: "#0f1216" }
};

const gallery = document.querySelector("#themeGallery");

function render() {
    if (!gallery) return;
    const current = themeManager.getCurrentThemeId();

    gallery.innerHTML = themeManager.getThemes().map((theme) => {
        const sw = SWATCHES[theme.id] || {};
        const active = theme.id === current;
        return `
            <button type="button" class="theme-card${active ? " theme-card--active" : ""}" data-theme-id="${theme.id}" aria-pressed="${active}">
                <span class="theme-card-preview" style="background:${sw.bg};">
                    <span class="theme-card-preview-panel" style="background:${sw.panel};">
                        <span class="theme-card-preview-dot" style="background:${sw.primary};"></span>
                    </span>
                </span>
                <span class="theme-card-name">${theme.name}</span>
                ${active ? '<span class="theme-card-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> Active</span>' : ""}
            </button>
        `;
    }).join("");
}

if (gallery) {
    render();
    gallery.addEventListener("click", (e) => {
        const btn = e.target.closest(".theme-card");
        if (!btn) return;
        themeManager.applyTheme(btn.dataset.themeId);
    });
    document.addEventListener("themechange", render);
}
