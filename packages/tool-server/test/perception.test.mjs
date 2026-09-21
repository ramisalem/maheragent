// Perception and interaction against a real http origin: shadow DOM, iframes,
// content elements, find, stale refs, the post-action page view, waits,
// viewport, tabs. (file:// would do for most of this, but Chromium treats each
// file:// document as its own origin, which blocks iframe piercing.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createToolRegistry, StaleRefError } from "@ramisalem/tool-server";

const PAGE = `<!doctype html><html><head><title>Perception</title></head><body>
  <h1>Perception</h1>
  <p class="lead" style="color: rgb(10, 20, 30)">Welcome back, <strong>friend</strong></p>
  <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Logo" width="20" height="20">
  <div id="swatch" style="width:20px;height:20px;background:#1a73e8"></div>
  <button id="toggle">Toggle</button>
  <button id="a">A</button>
  <button id="b" style="display:none">B</button>
  <input id="pw" type="password" aria-label="Password">
  <div id="host"></div>
  <iframe id="frame" title="Preview" src="/frame.html" width="300" height="100"></iframe>
  <button id="late-trigger">Show late</button>
  <div id="late" style="display:none">Late content</div>
  <select id="sel" aria-label="Pick"><option value="one">One</option><option value="two">Two</option></select>
  <div id="scroller" style="height:50px;overflow:auto"><div style="height:500px"></div></div>
  <input id="range" type="range" min="0" max="100" value="0" aria-label="Volume" style="width:200px">
  <a id="pop" href="/frame.html" target="_blank">Open popup</a>
  <script>
    toggle.onclick = () => { a.style.display = 'none'; b.style.display = 'block'; };
    b.onclick = () => { document.title = 'B clicked'; };
    host.attachShadow({ mode: 'open' }).innerHTML = '<button id="shadow-btn">Shadow button</button>';
    host.shadowRoot.getElementById('shadow-btn').onclick = () => { document.title = 'shadow clicked'; };
    document.getElementById('late-trigger').onclick = () => setTimeout(() => { late.style.display = 'block'; }, 300);
  </script>
</body></html>`;

const FRAME = `<!doctype html><html><head><title>Frame</title></head><body>
  <button id="inner" onclick="parent.document.title = 'frame clicked'">Inside frame</button>
  <p>Frame text</p>
</body></html>`;

let server;
let base;
let registry;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(req.url === "/frame.html" ? FRAME : PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  registry = createToolRegistry();
  await registry.execute("navigate", { url: `${base}/` });
});

after(async () => {
  await registry.disposeAll();
  await new Promise((r) => server.close(r));
});

const describe = async (args = {}) => (await registry.execute("describe", args)).elements;
const byName = (els, name) => els.find((e) => e.name === name);

test("describe pierces open shadow roots and the Ref is clickable", async () => {
  const els = await describe();
  const shadow = byName(els, "Shadow button");
  assert.ok(shadow, "shadow DOM button listed");
  const view = await registry.execute("click", { ref: shadow.ref });
  assert.equal(view.title, "shadow clicked");
});

test("describe pierces same-origin iframes and tags elements with their frame", async () => {
  const els = await describe();
  const frame = els.find((e) => e.role === "iframe");
  assert.equal(frame?.name, "Preview");
  const inner = byName(els, "Inside frame");
  assert.ok(inner, "iframe button listed");
  assert.equal(inner.frame, frame.ref, "element carries the iframe's Ref");
  // Boxes are in top-viewport coordinates: the button sits inside the iframe's box.
  assert.ok(inner.box.x >= frame.box.x && inner.box.y >= frame.box.y);
  const view = await registry.execute("click", { ref: inner.ref });
  assert.equal(view.title, "frame clicked");
});

test("content: true lists text and images so conformance can measure them", async () => {
  const els = await describe({ content: true });
  const lead = els.find((e) => e.role === "paragraph");
  assert.match(lead.name, /Welcome back/);
  assert.equal(byName(els, "Logo")?.role, "image");
  assert.ok(els.some((e) => e.role === "paragraph" && e.name === "Frame text"), "iframe paragraph too");
  const styles = await registry.execute("extract-styles", { ref: lead.ref });
  assert.equal(styles.color, "rgb(10, 20, 30)");
});

test("find tags by selector or text without invalidating earlier Refs", async () => {
  const before = await describe();
  const toggleRef = byName(before, "Toggle").ref;

  const bySelector = (await registry.execute("find", { selector: ".lead" })).elements;
  assert.equal(bySelector.length, 1);
  assert.equal(bySelector[0].role, "paragraph");
  assert.ok(!before.some((e) => e.ref === bySelector[0].ref), "a new Ref, not a recycled one");

  // Text matches land on the deepest element that renders the text.
  const byText = (await registry.execute("find", { text: "friend" })).elements;
  assert.equal(byText.length, 1);
  assert.equal(byText[0].name, "friend");

  const view = await registry.execute("click", { ref: toggleRef, observe: false });
  assert.equal(view.ok, true, "the earlier Ref still resolves after find");
});

test("re-describe never leaves two elements sharing a Ref", async () => {
  // Regression: the hidden button kept its old Ref while the newly visible one
  // was assigned the same number, so click failed with a strict-mode violation.
  const els = await describe();
  assert.ok(byName(els, "B"), "B visible after the toggle in the previous test");
  assert.ok(!byName(els, "A"), "A hidden");
  const view = await registry.execute("click", { ref: byName(els, "B").ref });
  assert.equal(view.title, "B clicked");
});

test("password values never leave the page as text", async () => {
  const pw = byName(await describe(), "Password");
  await registry.execute("type", { ref: pw.ref, text: "s3cret!", observe: false });
  assert.equal(byName(await describe(), "Password").value, "***");
  assert.equal(
    await registry.execute("evaluate", { expression: "document.getElementById('pw').value" }).then((r) => r.value),
    "s3cret!",
    "the value did reach the field",
  );
});

test("interactions return the page after the action; observe:false skips it", async () => {
  const els = await describe();
  const view = await registry.execute("hover", { ref: byName(els, "Toggle").ref });
  assert.equal(view.ok, true);
  assert.equal(view.title, "B clicked");
  assert.ok(Array.isArray(view.elements) && view.elements.length > 0);
  const bare = await registry.execute("hover", { ref: byName(els, "Toggle").ref, observe: false });
  assert.deepEqual(bare, { ok: true });
});

test("wait-for blocks until the element appears, and idle waits for a quiet DOM", async () => {
  const els = await describe();
  await registry.execute("click", { ref: byName(els, "Show late").ref, observe: false });
  const view = await registry.execute("wait-for", { text: "Late content" });
  assert.ok(view.waitedMs >= 200, `waited ${view.waitedMs}ms for the delayed reveal`);
  assert.ok(view.elements.length > 0, "comes with the post-wait page view");

  const idle = await registry.execute("wait-for", { idle: true, observe: false });
  assert.equal(idle.settled, true);

  await assert.rejects(
    registry.execute("wait-for", { selector: "#nope", timeoutMs: 300 }),
    /Timed out after 300ms/,
  );
});

test("a stale Ref fails fast instead of waiting out the actionability timeout", async () => {
  const els = await describe();
  const ref = byName(els, "Toggle").ref;
  await registry.execute("navigate", { url: "about:blank", observe: false });
  const start = Date.now();
  await assert.rejects(registry.execute("click", { ref }), (err) => err instanceof StaleRefError);
  assert.ok(Date.now() - start < 3000, "no 30s wait");
  await registry.execute("navigate", { url: `${base}/`, observe: false });
});

test("set-viewport resizes the page and emulates a color scheme", async () => {
  const view = await registry.execute("set-viewport", { width: 500, height: 400, colorScheme: "dark" });
  assert.deepEqual(
    { width: view.viewport.width, height: view.viewport.height, colorScheme: view.viewport.colorScheme },
    { width: 500, height: 400, colorScheme: "dark" },
  );
  const dark = await registry.execute("evaluate", {
    expression: "matchMedia('(prefers-color-scheme: dark)').matches",
  });
  assert.equal(dark.value, true);
  await registry.execute("set-viewport", { width: 1280, height: 720, colorScheme: "light", observe: false });
});

test("screenshot by Ref crops to the element", async () => {
  const swatch = (await registry.execute("find", { selector: "#swatch" })).elements[0];
  const shot = await registry.execute("screenshot", { ref: swatch.ref });
  const png = Buffer.from(shot.base64, "base64");
  // IHDR width is the big-endian uint32 at byte 16.
  assert.equal(png.readUInt32BE(16), 20);
});

test("select-option, scroll inside an element, and drag work by Ref", async () => {
  const els = await describe();
  const picked = await registry.execute("select-option", { ref: byName(els, "Pick").ref, label: "Two", observe: false });
  assert.deepEqual(picked.selected, ["two"]);

  const scroller = (await registry.execute("find", { selector: "#scroller" })).elements[0];
  await registry.execute("scroll", { ref: scroller.ref, dy: 120, observe: false });
  const top = await registry.execute("evaluate", { ref: scroller.ref, expression: "el.scrollTop" });
  assert.equal(top.value, 120);

  const range = byName(els, "Volume");
  await registry.execute("drag", { ref: range.ref, dx: 80, observe: false });
  const value = await registry.execute("evaluate", { ref: range.ref, expression: "Number(el.value)" });
  assert.ok(value.value > 0, `slider moved to ${value.value}`);
});

test("tabs: a popup is announced, can be selected, and cannot leave zero tabs", async () => {
  const els = await describe();
  const view = await registry.execute("click", { ref: byName(els, "Open popup").ref });
  assert.deepEqual(view.openedTabs, ["t2"]);

  const listed = (await registry.execute("tabs", { action: "list" })).tabs;
  assert.equal(listed.length, 2);
  assert.equal(listed.find((t) => t.active).tab, "t1", "actions stay on the active tab until told otherwise");

  await registry.execute("tabs", { action: "select", tab: "t2" });
  assert.ok(byName(await describe(), "Inside frame"), "describe now reads the popup");

  const remaining = (await registry.execute("tabs", { action: "close" })).tabs;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].active, true, "the survivor becomes active");
  await assert.rejects(registry.execute("tabs", { action: "close" }), /last tab/);
});
