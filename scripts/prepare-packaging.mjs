// One-shot, idempotent: stamp publish metadata onto every workspace package.
// Run with `node scripts/prepare-packaging.mjs`. Safe to re-run.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = "https://github.com/ramisalem/maheragent";
const root = new URL("..", import.meta.url).pathname;
const pkgsDir = join(root, "packages");

const common = (name, hasBuild) => ({
  license: "MIT",
  engines: { node: ">=20" },
  repository: { type: "git", url: `git+${REPO}.git`, directory: `packages/${name}` },
  homepage: `${REPO}#readme`,
  publishConfig: { access: "public" },
  ...(hasBuild ? { files: ["dist"] } : {}),
});

let changed = 0;
for (const dir of readdirSync(pkgsDir)) {
  const path = join(pkgsDir, dir, "package.json");
  if (!existsSync(path)) continue;
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  const hasBuild = existsSync(join(pkgsDir, dir, "tsconfig.json"));

  // Merge without clobbering anything already set intentionally (e.g. skills' files).
  const fields = common(dir, hasBuild);
  for (const [k, v] of Object.entries(fields)) {
    if (k === "files" && pkg.files) continue; // keep an explicit files list
    pkg[k] = v;
  }
  // Build before packing so `dist` exists in the tarball (skills ships raw markdown).
  if (hasBuild) {
    pkg.scripts = pkg.scripts ?? {};
    pkg.scripts.prepack = "tsc --build";
  }

  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  changed++;
  console.log(`stamped ${pkg.name}`);
}
console.log(`done — ${changed} packages`);
