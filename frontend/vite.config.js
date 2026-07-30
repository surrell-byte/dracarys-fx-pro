import { fileURLToPath, URL } from "url";

// Deliberately NOT using `import { defineConfig } from "vite"` here.
// defineConfig is just a type-hint helper — this plain object is equally
// valid to Vite at runtime, and staying plain lets scripts/check-imports.js
// import this file directly with plain Node (no Vite install required just
// to validate paths, e.g. in a CI step that runs before `npm install`).
export default {
    resolve: {
        alias: {
            "@core": fileURLToPath(new URL("./src/js/core", import.meta.url)),
            "@indicators": fileURLToPath(new URL("./src/js/indicators", import.meta.url)),
            "@patterns": fileURLToPath(new URL("./src/js/patterns", import.meta.url)),
            "@services": fileURLToPath(new URL("./src/js/services", import.meta.url)),
            "@signals": fileURLToPath(new URL("./src/js/signals", import.meta.url)),
            "@analysis": fileURLToPath(new URL("./src/js/analysis", import.meta.url)),
            "@chartPatterns": fileURLToPath(new URL("./src/js/chartPatterns", import.meta.url)),
            "@marketRegime": fileURLToPath(new URL("./src/js/marketRegime", import.meta.url)),
            "@smartMoney": fileURLToPath(new URL("./src/js/smartMoney", import.meta.url)),
            "@ai": fileURLToPath(new URL("./src/js/ai", import.meta.url)),
            "@risk": fileURLToPath(new URL("./src/js/risk", import.meta.url)),
            "@demo": fileURLToPath(new URL("./src/js/demo", import.meta.url))
        }
    },
    server: {
        port: 5173
    }
};


