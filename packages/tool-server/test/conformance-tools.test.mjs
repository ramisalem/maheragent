import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createToolRegistry } from "@ramisalem/tool-server";

const FIXTURE = `<!doctype html><html><head><title>Conf</title></head><body>
  <h1 id="title" style="color: rgb(0, 101, 128); font-size: 33.46px; font-weight: 700; width: 400px; height: 50px">Heading</h1>
  <button>Go</button>
</body></html>`;

const file = join(tmpdir(), `maher-conf-${process.pid}.html`);
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

const titleRef = async () => {
  const els = await registry.execute("describe", {});
  return els.find((e) => e.name === "Heading");
};

test("describe now returns a bounding box", async () => {
  const h = await titleRef();
  assert.ok(h.box, "box present");
  assert.equal(h.box.width, 400);
  assert.equal(h.box.height, 50);
  assert.equal(typeof h.box.x, "number");
});

test("compare-styles passes when computed matches the design", async () => {
  const h = await titleRef();
  const report = await registry.execute("compare-styles", {
    ref: h.ref,
    expected: { color: "#006580", fontSize: "33.46px", fontWeight: "Bold" },
  });
  assert.equal(report.conforms, true);
  assert.equal(report.matched, 3);
});

test("compare-styles flags the specific property that diverges", async () => {
  const h = await titleRef();
  const report = await registry.execute("compare-styles", {
    ref: h.ref,
    expected: { color: "#006580", fontSize: "20px" },
  });
  assert.equal(report.conforms, false);
  const size = report.comparisons.find((c) => c.property === "fontSize");
  assert.equal(size.match, false);
  assert.equal(report.comparisons.find((c) => c.property === "color").match, true);
});

test("compare-styles on a stale ref returns a structured error", async () => {
  const report = await registry.execute("compare-styles", { ref: "e999", expected: { color: "#000" } });
  assert.equal(report.conforms, false);
  assert.equal(report.error, "stale_ref");
});

test("screenshot writes a PNG to disk when given a path", async () => {
  const out = join(tmpdir(), `maher-shot-${process.pid}.png`);
  const result = await registry.execute("screenshot", { path: out });
  assert.equal(result.path, out);
  assert.equal(result.base64, undefined, "base64 omitted when written to disk");
  assert.ok(existsSync(out) && statSync(out).size > 0, "PNG file written");
  rmSync(out, { force: true });
});
