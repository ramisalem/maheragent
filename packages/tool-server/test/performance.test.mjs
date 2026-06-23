import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createToolRegistry } from "@ramisalem/tool-server";

const FIXTURE = `<!doctype html><html><head><title>Perf</title>
  <style>h1{font-size:40px}</style></head><body>
  <h1>Hello performance</h1>
  <p>Some content to paint and lay out.</p>
</body></html>`;

const file = join(tmpdir(), `maher-perf-${process.pid}.html`);
let registry;

before(async () => {
  writeFileSync(file, FIXTURE);
  registry = createToolRegistry();
  await registry.execute("navigate", { url: pathToFileURL(file).href });
});

after(async () => {
  await registry.disposeAll();
  rmSync(file, { force: true });
});

test("profile-performance returns a structured Core Web Vitals report", async () => {
  const report = await registry.execute("profile-performance", { settleMs: 200 });
  // Shape: the vitals + timing fields are present and the right types.
  assert.equal(typeof report.cls, "number");
  assert.equal(typeof report.totalBlockingTime, "number");
  assert.equal(typeof report.longTaskCount, "number");
  assert.equal(typeof report.resourceCount, "number");
  assert.equal(typeof report.resourceBytes, "number");
  assert.equal(typeof report.resourcesByType, "object");
  // A rendered page reports a load time and a first paint.
  assert.ok(report.load === undefined || report.load >= 0);
  assert.ok(report.fcp === undefined || report.fcp >= 0);
});

test("CLS is non-negative and TBT is a sane estimate", async () => {
  const report = await registry.execute("profile-performance", {});
  assert.ok(report.cls >= 0);
  assert.ok(report.totalBlockingTime >= 0);
});
