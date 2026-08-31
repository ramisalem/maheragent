import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createToolRegistry } from "@ramisalem/tool-server";
import { InvalidToolArgsError } from "@ramisalem/registry";

const FIXTURE = `<!doctype html><html><head><title>Form</title></head><body>
  <!-- font-style is outside the curated property set, so it exercises the
       caller-requested path. Deliberately not text-transform: that rewrites
       innerText and would change the element's accessible name. -->
  <h1 style="color: rgb(255, 0, 0); font-style: italic">Title</h1>
  <label for="name">Name</label>
  <input id="name" value="">
  <button aria-label="Reveal">Reveal</button>
  <h2 id="done" style="display:none">Done</h2>
  <!-- Mirrors how component libraries nest: the ARIA role sits on an inner
       node while the border lives on the wrapper (cf. MUI Tabs). -->
  <div class="tabs-root" style="border-bottom: 2px solid rgb(224, 225, 230)">
    <div role="tablist" aria-label="Sections">
      <button role="tab" aria-label="First">First</button>
    </div>
  </div>
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

test("extract-styles reports per-side border widths", async () => {
  const els = await registry.execute("describe", {});
  const styles = await registry.execute("extract-styles", {
    ref: refByName(els, "Sections"),
    closest: ".tabs-root",
  });
  // The `borderColor`/`borderTopWidth` shorthands describe the *unset* edges
  // here, so an underline is only visible through the bottom-specific keys.
  assert.equal(styles.borderBottomWidth, "2px");
  assert.equal(styles.borderBottomColor, "rgb(224, 225, 230)");
});

test("extract-styles measures properties outside the curated set", async () => {
  const els = await registry.execute("describe", {});
  const styles = await registry.execute("extract-styles", {
    ref: refByName(els, "Title"),
    properties: ["fontStyle", "font-style"],
  });
  // Both spellings resolve, and each is echoed under the name that was asked for.
  assert.equal(styles.fontStyle, "italic");
  assert.equal(styles["font-style"], "italic");
});

test("compare-styles never reports a requested property as unmeasured", async () => {
  const els = await registry.execute("describe", {});
  const report = await registry.execute("compare-styles", {
    ref: refByName(els, "Title"),
    expected: { fontStyle: "italic" },
  });
  // Regression guard: this used to come back `actual: null` / "no computed
  // value", which reads as a design failure rather than a tooling gap.
  assert.equal(report.comparisons[0].actual, "italic");
  assert.equal(report.conforms, true);
});

test("compare-styles retargets to the styled wrapper via closest", async () => {
  const els = await registry.execute("describe", {});
  const ref = refByName(els, "Sections");
  const expected = { borderBottomWidth: "2px" };

  const onRole = await registry.execute("compare-styles", { ref, expected });
  assert.equal(onRole.conforms, false, "the role node carries no border");

  const onWrapper = await registry.execute("compare-styles", {
    ref,
    expected,
    closest: ".tabs-root",
  });
  assert.equal(onWrapper.conforms, true);
});

test("compare-styles reports a stale ref when closest matches nothing", async () => {
  const els = await registry.execute("describe", {});
  const report = await registry.execute("compare-styles", {
    ref: refByName(els, "Sections"),
    expected: { color: "rgb(0, 0, 0)" },
    closest: ".no-such-wrapper",
  });
  // Better an explicit error than silently measuring the wrong element.
  assert.equal(report.error, "stale_ref");
});
