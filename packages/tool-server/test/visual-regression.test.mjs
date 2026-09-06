// The screenshot-diff tool end to end: baseline creation, a live comparison
// after a real DOM change, region-to-element naming, tolerance, element crops.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createToolRegistry } from "@ramisalem/tool-server";

const FIXTURE = `<!doctype html><html><head><title>Visual</title>
  <style>body{margin:0;background:#fff} #cta{position:absolute;left:100px;top:80px;width:120px;height:40px;background:#1a73e8;color:#fff;border:0}</style>
  </head><body><button id="cta">Continue</button></body></html>`;

let dir;
let registry;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "maher-visual-"));
  writeFileSync(join(dir, "page.html"), FIXTURE);
  registry = createToolRegistry();
  await registry.execute("navigate", { url: pathToFileURL(join(dir, "page.html")).href, observe: false });
  await registry.execute("set-viewport", { width: 400, height: 300, observe: false });
});

after(async () => {
  await registry.disposeAll();
  rmSync(dir, { recursive: true, force: true });
});

test("without a baseline the tool says so, and updateBaseline adopts the capture", async () => {
  const baseline = join(dir, "shots", "home.png");
  const missing = await registry.execute("screenshot-diff", { baseline });
  assert.equal(missing.matches, false);
  assert.equal(missing.error, "no_baseline");
  assert.ok(existsSync(missing.current), "the live capture is kept for inspection");

  const created = await registry.execute("screenshot-diff", { baseline, updateBaseline: true });
  assert.deepEqual({ matches: created.matches, created: created.created }, { matches: true, created: true });
  assert.ok(existsSync(baseline));
});

test("an unchanged page matches its baseline", async () => {
  const result = await registry.execute("screenshot-diff", { baseline: join(dir, "shots", "home.png") });
  assert.equal(result.matches, true);
  assert.equal(result.changedPixels, 0);
  assert.equal(result.diff, undefined, "no diff image when nothing changed");
});

test("a real change is located and named by the element it overlaps", async () => {
  await registry.execute("evaluate", { expression: "document.getElementById('cta').style.background = '#d93025'" });
  const result = await registry.execute("screenshot-diff", { baseline: join(dir, "shots", "home.png") });
  assert.equal(result.matches, false);
  assert.ok(result.mismatchRatio > 0 && result.mismatchRatio < 0.1, `ratio ${result.mismatchRatio}`);
  assert.equal(result.regions.length, 1);
  const region = result.regions[0];
  // The region is the button's box (position:absolute at 100,80, 120x40).
  assert.ok(Math.abs(region.x - 100) <= 1 && Math.abs(region.y - 80) <= 1, `region at ${region.x},${region.y}`);
  assert.ok(Math.abs(region.width - 120) <= 1 && Math.abs(region.height - 40) <= 1);
  assert.equal(region.elements[0].name, "Continue");
  assert.equal(result.diff.format, "png");
  assert.ok(existsSync(result.diffPath));

  // A tolerance wide enough turns the same comparison into a match.
  const tolerated = await registry.execute("screenshot-diff", { baseline: join(dir, "shots", "home.png"), maxMismatch: 0.2 });
  assert.equal(tolerated.matches, true);
});

test("updateBaseline after a mismatch replaces the baseline", async () => {
  const baseline = join(dir, "shots", "home.png");
  const updated = await registry.execute("screenshot-diff", { baseline, updateBaseline: true });
  assert.equal(updated.updated, true);
  const again = await registry.execute("screenshot-diff", { baseline });
  assert.equal(again.matches, true);
});

test("an element crop compares just that element", async () => {
  const { elements } = await registry.execute("describe", {});
  const cta = elements.find((e) => e.name === "Continue");
  const baseline = join(dir, "shots", "cta.png");
  await registry.execute("screenshot-diff", { baseline, ref: cta.ref, updateBaseline: true });
  await registry.execute("evaluate", { expression: "document.getElementById('cta').textContent = 'Go'" });
  const fresh = (await registry.execute("describe", {})).elements.find((e) => e.name === "Go");
  const result = await registry.execute("screenshot-diff", { baseline, ref: fresh.ref });
  assert.equal(result.matches, false);
  assert.equal(result.width, 120);
  assert.equal(result.height, 40);
  assert.equal(result.regions[0].elements[0].name, "Go", "regions map back to the element through its offset");
});
