#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const dist = path.resolve(projectRoot, "frontend/dist");

const requiredFiles = [
    "index.html"
];

const requiredDirectories = [
    "assets"
];

function fail(message) {
    console.error(`❌ ${message}`);
    process.exit(1);
}

if (!fs.existsSync(dist)) {
    fail(`Missing build directory: ${dist}`);
}

for (const file of requiredFiles) {
    const target = path.join(dist, file);

    if (!fs.existsSync(target)) {
        fail(`Missing build file: ${target}`);
    }
}

for (const directory of requiredDirectories) {
    const target = path.join(dist, directory);

    if (!fs.existsSync(target)) {
        fail(`Missing build directory: ${target}`);
    }
}

const indexPath = path.join(dist, "index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");

if (!indexHtml.includes("<html")) {
    fail("dist/index.html does not look like a valid HTML document.");
}

if (!indexHtml.includes("/assets/")) {
    console.warn(
        "⚠️ Warning: dist/index.html contains no /assets/ reference."
    );
}

console.log("");
console.log("========================================");
console.log(" Production build verification");
console.log("========================================");
console.log("");
console.log("✅ frontend/dist exists");
console.log("✅ index.html exists");
console.log("✅ assets directory exists");
console.log("✅ index.html looks valid");
console.log("");
console.log("BUILD VERIFICATION PASSED");
console.log("");
