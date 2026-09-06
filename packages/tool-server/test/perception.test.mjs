// Perception and interaction against a real http origin: shadow DOM, iframes,
// content elements, find, stale refs. (file:// would do for most of this, but Chromium treats each
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

const title = async () => (await registry.execute("describe", {})).title;

test("describe pierces open shadow roots and the Ref is clickable", async () => {
  const els = await describe();
  const shadow = byName(els, "Shadow button");
  assert.ok(shadow, "shadow DOM button listed");
  await registry.execute("click", { ref: shadow.ref });
  assert.equal(await title(), "shadow clicked");
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
  await registry.execute("click", { ref: inner.ref });
  assert.equal(await title(), "frame clicked");
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

  const result = await registry.execute("click", { ref: toggleRef });
  assert.equal(result.ok, true, "the earlier Ref still resolves after find");
});

test("re-describe never leaves two elements sharing a Ref", async () => {
  // Regression: the hidden button kept its old Ref while the newly visible one
  // was assigned the same number, so click failed with a strict-mode violation.
  const els = await describe();
  assert.ok(byName(els, "B"), "B visible after the toggle in the previous test");
  assert.ok(!byName(els, "A"), "A hidden");
  await registry.execute("click", { ref: byName(els, "B").ref });
  assert.equal(await title(), "B clicked");
});

test("password values never leave the page as text", async () => {
  const pw = byName(await describe(), "Password");
  await registry.execute("type", { ref: pw.ref, text: "s3cret!" });
  assert.equal(byName(await describe(), "Password").value, "***");
});

test("a stale Ref fails fast instead of waiting out the actionability timeout", async () => {
  const els = await describe();
  const ref = byName(els, "Toggle").ref;
  await registry.execute("navigate", { url: "about:blank" });
  const start = Date.now();
  await assert.rejects(registry.execute("click", { ref }), (err) => err instanceof StaleRefError);
  assert.ok(Date.now() - start < 3000, "no 30s wait");
  await registry.execute("navigate", { url: `${base}/` });
});
