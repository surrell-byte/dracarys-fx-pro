import viteConfig from "./vite.config.js";

// Reuses vite.config.js's alias map rather than redefining it - if a new
// @alias is added to the app, tests automatically see it too instead of
// silently failing to resolve imports until someone remembers to update
// a second config file.
export default {
    ...viteConfig,
    test: {
        environment: "node",
        include: ["tests/**/*.test.js"],
        setupFiles: ["./tests/setup.js"]
    }
};
