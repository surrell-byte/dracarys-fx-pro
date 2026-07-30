// Sidebar navigation: highlights the active section as you scroll, and
// smooth-scrolls to a section when its menu button is clicked.
//
// This file is intentionally standalone — it only reads data-target
// attributes and section ids, and never touches trading state, so it can't
// interfere with core/app.js.

const menu = document.querySelector("#sideMenu");
if (menu) {
    const buttons = Array.from(menu.querySelectorAll("button[data-target]"));
    const sections = buttons
        .map((btn) => document.getElementById(btn.dataset.target))
        .filter(Boolean);

    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = document.getElementById(btn.dataset.target);
            if (!target) return;
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });

    const setActive = (id) => {
        buttons.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.target === id);
        });
    };

    if ("IntersectionObserver" in window && sections.length) {
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
                if (visible) {
                    setActive(visible.target.id);
                }
            },
            { rootMargin: "-15% 0px -65% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
        );
        sections.forEach((section) => observer.observe(section));
    }
}
