// Renders a theme dropdown into the given container and wires up the
// floating 🎨 button. Self-initializing on import — nothing in core/app.js
// needs to change for this to work.

import themeManager from "../core/themeManager.js";

class ThemeSelector {
    constructor(selector) {
        this.container = document.querySelector(selector);
        if (!this.container) return;

        this.select = document.createElement("select");
        this.select.className = "theme-select";
        this.select.setAttribute("aria-label", "Theme");

        themeManager.getThemes().forEach((theme) => {
            const option = document.createElement("option");
            option.value = theme.id;
            option.textContent = theme.name;
            this.select.appendChild(option);
        });

        this.select.value = themeManager.getCurrentThemeId();
        this.select.addEventListener("change", () => {
            themeManager.applyTheme(this.select.value);
        });

        this.container.appendChild(this.select);

        document.addEventListener("themechange", (e) => {
            if (this.select.value !== e.detail.id) {
                this.select.value = e.detail.id;
            }
        });
    }
}

function wireQuickThemeButton() {
    const btn = document.getElementById("quickTheme");
    if (!btn) return;
    btn.addEventListener("click", () => themeManager.nextTheme());
}

function boot() {
    themeManager.init();
    new ThemeSelector("#themeSelector");
    wireQuickThemeButton();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}

export default ThemeSelector;
