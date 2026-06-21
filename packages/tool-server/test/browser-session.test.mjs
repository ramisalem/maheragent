import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createToolRegistry } from "@ramisalem/tool-server";

// A self-contained fixture page (no network) exercising names, values, visibility.
const FIXTURE = `<!doctype html><html><head><title>Checkout</title></head><body>
  <h1>Checkout</h1>
  <label for="email">Email</label>
  <input id="email" type="email" value="a@b.com">
  <button aria-label="Place order">Place order</button>
  <a href="/help">Need help?</a>
  <button style="display:none">Hidden</button>
</body></html>`;

const file = join(tmpdir(), `maher-tool-server-${process.pid}.html`);
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

test("navigate reports the page state", async () => {
  const state = await registry.execute("navigate", { url: pathToFileURL(file).href });
  assert.equal(state.title, "Checkout");
});

test("describe returns elements with stable Element Refs", async () => {
  const els = await registry.execute("describe", {});
  const byRole = (r) => els.filter((e) => e.role === r);

  assert.ok(byRole("heading").some((e) => e.name === "Checkout"), "heading");
  assert.ok(byRole("button").some((e) => e.name === "Place order"), "aria-label name");
  assert.ok(
    byRole("textbox").some((e) => e.name === "Email" && e.value === "a@b.com"),
    "input name + value",
  );
  assert.ok(byRole("link").some((e) => e.name === "Need help?"), "link");
  assert.ok(!els.some((e) => e.name === "Hidden"), "invisible element excluded");
  assert.ok(els.every((e) => /^e\d+$/.test(e.ref)), "every element has an Element Ref");
});

test("screenshot returns real PNG bytes", async () => {
  const shot = await registry.execute("screenshot", {});
  const bytes = Buffer.from(shot.base64, "base64");
  assert.equal(shot.format, "png");
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG magic");
  assert.ok(bytes.length > 1000);
});

test("the session is reused across tool calls (one URN)", () => {
  assert.deepEqual(registry.liveUrns(), ["BrowserSession:default"]);
});
