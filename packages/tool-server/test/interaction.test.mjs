import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createToolRegistry } from "@ramisalem/tool-server";
import { InvalidToolArgsError } from "@ramisalem/registry";

const FIXTURE = `<!doctype html><html><head><title>Form</title></head><body>
  <h1 style="color: rgb(255, 0, 0)">Title</h1>
  <label for="name">Name</label>
  <input id="name" value="">
  <button aria-label="Reveal">Reveal</button>
  <h2 id="done" style="display:none">Done</h2>
  <script>
    document.querySelector('button').addEventListener('click', function () {
      document.getElementById('done').style.display = 'block';
    });
  </script>
</body></html>`;

const file = join(tmpdir(), `maher-interaction-${process.pid}.html`);
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

const refByName = (els, name) => els.find((e) => e.name === name)?.ref;

test("type fills a field by Element Ref", async () => {
  let els = await registry.execute("describe", {});
  await registry.execute("type", { ref: refByName(els, "Name"), text: "hello" });
  els = await registry.execute("describe", {});
  assert.equal(els.find((e) => e.name === "Name").value, "hello");
});

test("click by Element Ref drives page behavior", async () => {
  let els = await registry.execute("describe", {});
  assert.ok(!els.some((e) => e.name === "Done"), "hidden before click");
  await registry.execute("click", { ref: refByName(els, "Reveal") });
  els = await registry.execute("describe", {});
  assert.ok(
    els.some((e) => e.role === "heading" && e.name === "Done"),
    "revealed after click",
  );
});

test("click requires exactly one of ref or coordinates", async () => {
  await assert.rejects(registry.execute("click", {}), InvalidToolArgsError);
  await assert.rejects(
    registry.execute("click", { ref: "e1", x: 1, y: 2 }),
    InvalidToolArgsError,
  );
});

test("extract-styles returns grounding evidence", async () => {
  const els = await registry.execute("describe", {});
  const styles = await registry.execute("extract-styles", {
    ref: refByName(els, "Title"),
  });
  assert.equal(styles.color, "rgb(255, 0, 0)");
  assert.ok("fontSize" in styles && "fontWeight" in styles);
});

test("extract-styles returns null for a stale Ref", async () => {
  assert.equal(await registry.execute("extract-styles", { ref: "e999" }), null);
});
