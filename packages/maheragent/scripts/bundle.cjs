#!/usr/bin/env node
"use strict";

// Build the single, self-contained `maheragent` package. esbuild inlines the
// @ramisalem/* workspace code (resolved from source) into two bundles — the CLI
// dispatcher and the spawned daemon — while leaving heavy/native npm deps
// (playwright, the MCP SDK, …) external so they install normally for consumers.
// The bundled skills ship beside the CLI bundle.

const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const PKG = path.resolve(__dirname, "..");
const ROOT = path.resolve(PKG, "..", "..");
const DIST = path.join(PKG, "dist");
const src = (p) => path.join(ROOT, "packages", p);

// Resolve workspace packages from their TypeScript source so the bundle never
// depends on per-package build freshness.
const ALIASES = {
  "@ramisalem/registry": src("registry/src/index.ts"),
  "@ramisalem/configuration-core": src("configuration-core/src/index.ts"),
  "@ramisalem/tool-server": src("tool-server/src/index.ts"),
  "@ramisalem/mcp": src("mcp/src/index.ts"),
  "@ramisalem/cli": src("cli/src/index.ts"),
  "@ramisalem/installer": src("installer/src/index.ts"),
};

// Public npm deps stay external (declared in package.json#dependencies).
const EXTERNAL = [
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/*",
  "playwright",
  "zod",
  "zod-to-json-schema",
  "jsonc-parser",
  "smol-toml",
  "yaml",
  "@clack/prompts",
  "picocolors",
];

const BANNER = {
  js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
};

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // Prefer ESM entries so statically-imported deps fully inline (e.g. jsonc-parser
  // ships both UMD `main` and ESM `module`; UMD's runtime require() can't inline).
  mainFields: ["module", "main"],
  alias: ALIASES,
  external: EXTERNAL,
  banner: BANNER,
  logLevel: "warning",
};

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // CLI dispatcher (bin: maheragent). esbuild preserves the entry's shebang, so
  // the shared banner must not add a second one.
  await esbuild.build({
    ...common,
    entryPoints: [path.join(PKG, "src", "cli.ts")],
    outfile: path.join(DIST, "cli.js"),
  });

  // Daemon entrypoint, spawned as a detached child by the CLI/MCP layer.
  await esbuild.build({
    ...common,
    entryPoints: [src("tool-server/src/bin.ts")],
    outfile: path.join(DIST, "daemon.mjs"),
  });

  // Ship the skills beside the bundle so the installer can find them.
  fs.cpSync(src("skills/skills"), path.join(DIST, "skills"), { recursive: true });

  fs.chmodSync(path.join(DIST, "cli.js"), 0o755);
  console.log("bundled → dist/cli.js · dist/daemon.mjs · dist/skills/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
