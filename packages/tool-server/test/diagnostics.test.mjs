import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createToolRegistry } from "@ramisalem/tool-server";

const FIXTURE = `<!doctype html><html><head><title>Diag</title></head><body>
  <h1>Diagnostics</h1>
  <img src="does-not-exist.png" alt="missing">
  <script>
    console.log("hello from page");
    console.error("boom");
    throw new Error("uncaught oops");
  </script>
</body></html>`;

const file = join(tmpdir(), `maher-diag-${process.pid}.html`);
let registry;

const settle = () => new Promise((r) => setTimeout(r, 150));

before(async () => {
  writeFileSync(file, FIXTURE);
  registry = createToolRegistry();
  await registry.execute("navigate", { url: pathToFileURL(file).href });
  await settle(); // let console/network events flush
});

after(async () => {
  await registry.disposeAll();
  rmSync(file, { force: true });
});

test("get-console-logs captures logs and page errors", async () => {
  const logs = await registry.execute("get-console-logs", {});
  assert.ok(logs.some((e) => e.text.includes("hello from page") && e.type === "log"));
  assert.ok(logs.some((e) => e.text.includes("boom") && e.type === "error"));
  // The uncaught throw is captured as a page error (type "error").
  assert.ok(logs.some((e) => e.text.includes("uncaught oops")));
  for (const e of logs) assert.equal(typeof e.time, "number");
});

test("get-console-logs filters by level", async () => {
  const errors = await registry.execute("get-console-logs", { level: "error" });
  assert.ok(errors.length > 0);
  assert.ok(errors.every((e) => e.type === "error"));
});

test("get-network-log records the failed image request", async () => {
  const net = await registry.execute("get-network-log", {});
  const img = net.find((e) => e.url.includes("does-not-exist.png"));
  assert.ok(img, "the missing image request was captured");
  assert.ok(img.failure || img.status, "it has a failure or a status");
});

test("clear empties the buffer", async () => {
  await registry.execute("get-console-logs", { clear: true });
  const after = await registry.execute("get-console-logs", {});
  assert.equal(after.length, 0);
});
