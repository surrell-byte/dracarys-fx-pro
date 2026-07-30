#!/usr/bin/env node
// scripts/check-imports.js
//
// Walks every .js file in the project (skipping node_modules) and verifies
// that every relative AND aliased import/export/dynamic-import path resolves
// to a real file on disk. Aliases are read directly from
// frontend/vite.config.js, so this can never silently drift out of sync with
// the actual alias map - if you add/rename an alias there, the checker picks
// it up automatically next run.
//
// Exits with code 1 and a list of problems if anything is broken.
// Run manually with `npm run check-imports`, or let "npm run dev" run it for
// you automatically (wired up via the "predev" script).

import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join, dirname, extname, resolve, sep } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_CONFIG_PATH = resolve(ROOT, "frontend/vite.config.js");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);
const JS_EXTENSIONS = [".js", ".mjs", ".cjs"];

// Matches: import ... from "x"   export ... from "x"   import("x")
const IMPORT_RE = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

async function loadAliases() {
    if (!existsSync(VITE_CONFIG_PATH)) return {};
    try {
        const mod = await import(pathToFileURL(VITE_CONFIG_PATH).href);
        return mod.default?.resolve?.alias ?? {};
    } catch (error) {
        console.warn(`⚠️  Could not read aliases from ${VITE_CONFIG_PATH}: ${error.message}`);
        console.warn("   Alias imports will not be checked this run.\n");
        return {};
    }
}

function walk(dir, files = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
            walk(full, files);
        } else if (JS_EXTENSIONS.includes(extname(entry))) {
            files.push(full);
        }
    }
    return files;
}

function candidatesFor(basePath) {
    return [basePath, ...JS_EXTENSIONS.map(ext => basePath + ext), join(basePath, "index.js")];
}

function resolveImport(fromFile, importPath, aliases) {
    // Bare specifiers like "express" or "ws" are npm packages, out of scope.
    if (!importPath.startsWith(".") && !importPath.startsWith("@")) {
        return { skip: true };
    }

    // Alias import, e.g. "@indicators/ema.js"
    for (const [alias, target] of Object.entries(aliases)) {
        if (importPath === alias || importPath.startsWith(alias + "/")) {
            const rest = importPath.slice(alias.length);
            const base = target + rest;
            const found = candidatesFor(base).some(c => existsSync(c) && statSync(c).isFile());
            return { skip: false, found, kind: "alias" };
        }
    }

    // A path starting with "@" that didn't match any known alias is still
    // worth flagging - it's not a valid npm package name pattern here.
    if (importPath.startsWith("@")) {
        return { skip: false, found: false, kind: "unknown-alias" };
    }

    // Plain relative import.
    const base = resolve(dirname(fromFile), importPath);
    const found = candidatesFor(base).some(c => existsSync(c) && statSync(c).isFile());
    return { skip: false, found, kind: "relative" };
}

async function main() {
    const aliases = await loadAliases();
    const aliasCount = Object.keys(aliases).length;
    const files = walk(ROOT);
    const problems = [];
    let checkedCount = 0;

    for (const file of files) {
        const content = readFileSync(file, "utf8");
        IMPORT_RE.lastIndex = 0;
        let match;
        while ((match = IMPORT_RE.exec(content))) {
            const importPath = match[1];
            const result = resolveImport(file, importPath, aliases);
            if (result.skip) continue;
            checkedCount += 1;
            if (!result.found) {
                problems.push({
                    file: file.replace(ROOT + sep, ""),
                    importPath,
                    kind: result.kind
                });
            }
        }
    }

    if (problems.length) {
        console.error(`\n❌ Found ${problems.length} broken import path(s):\n`);
        for (const p of problems) {
            const hint = p.kind === "unknown-alias"
                ? " (starts with @ but doesn't match any alias in frontend/vite.config.js)"
                : "";
            console.error(`  ${p.file}\n    -> "${p.importPath}" does not resolve${hint}\n`);
        }
        process.exit(1);
    }

    console.log(`✅ All ${checkedCount} imports resolve correctly (${aliasCount} alias(es) loaded from vite.config.js).`);
}

main();
