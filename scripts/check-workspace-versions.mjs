#!/usr/bin/env node
// Lockstep versioning guard: every package under packages/* must share one
// version. A release bump that misses a package would otherwise ship a bundled
// umbrella whose inlined pieces disagree on their version. Run via
// `npm run check:versions`.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages");

const byVersion = new Map(); // version -> [package names]
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(packagesDir, entry.name, "package.json"), "utf8"));
  } catch {
    continue;
  }
  if (!manifest.version) continue;
  const names = byVersion.get(manifest.version) ?? [];
  names.push(manifest.name ?? entry.name);
  byVersion.set(manifest.version, names);
}

if (byVersion.size <= 1) {
  const [version] = byVersion.keys();
  console.log(`All workspace packages are at ${version ?? "(none found)"}.`);
  process.exit(0);
}

console.error("Workspace package versions are out of sync:");
for (const [version, names] of [...byVersion].sort()) {
  console.error(`  ${version}: ${names.sort().join(", ")}`);
}
console.error("\nEvery package under packages/* must share one version. Bump the outliers to match.");
process.exit(1);
