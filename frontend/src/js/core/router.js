// Client-side router. Turns the sidebar into real navigation: each button
// maps to its own URL (e.g. /signals, /market) and only that page's <div
// class="page"> is shown. Uses the History API (not #hash) so URLs look
// like a normal multi-page site, but nothing ever full-page-reloads, so
// the live websocket feed, chart, and demo-account state in app.js never
// get torn down.
//
// Deliberately standalone, same as the old sidebar.js it replaces — it
// only reads data-target/page ids and never touches trading state.

const menu = document.querySelector("#sideMenu");
const pages = Array.from(document.querySelectorAll(".page"));
const buttons = menu ? Array.from(menu.querySelectorAll("button[data-target]")) : [];

const DEFAULT_PAGE = "page-dashboard";
const ROUTES = new Map(
    buttons
        .filter((btn) => btn.dataset.target)
        .map((btn) => [pathFor(btn.dataset.target), btn.dataset.target])
);

function pathFor(pageId) {
    // "page-dashboard" -> "/", "page-signals" -> "/signals"
    const name = pageId.replace(/^page-/, "");
    return name === "dashboard" ? "/" : `/${name}`;
}

function pageIdForPath(path) {
    return ROUTES.get(path) ?? DEFAULT_PAGE;
}

function showPage(pageId) {
    pages.forEach((page) => {
        page.classList.toggle("active", page.id === pageId);
    });
    buttons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.target === pageId);
    });
    // Scroll to top of the main column on every navigation, since pages
    // no longer live in one continuous scroll.
    document.querySelector(".main")?.scrollTo({ top: 0, behavior: "instant" });
    window.scrollTo({ top: 0, behavior: "instant" });
}

function navigate(pageId, { replace = false } = {}) {
    const path = pathFor(pageId);
    const state = { pageId };
    if (replace) {
        history.replaceState(state, "", path);
    } else if (location.pathname !== path) {
        history.pushState(state, "", path);
    }
    showPage(pageId);
}

if (menu && buttons.length) {
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.disabled || !btn.dataset.target) return;
            navigate(btn.dataset.target);
        });
    });

    window.addEventListener("popstate", (e) => {
        const pageId = e.state?.pageId ?? pageIdForPath(location.pathname);
        showPage(pageId);
    });

    // Initial load: honor whatever path the user landed on (deep link,
    // refresh, or back/forward into this session).
    navigate(pageIdForPath(location.pathname), { replace: true });
}
