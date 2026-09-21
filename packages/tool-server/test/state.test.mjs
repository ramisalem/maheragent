// Page-state tools: evaluate, cookies, storage, and the sessions tool.
// Cookies need a real http origin, so the fixture is served, not a file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createToolRegistry } from "@ramisalem/tool-server";
import { InvalidToolArgsError } from "@ramisalem/registry";

let server;
let base;
let registry;

before(async () => {
  server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><title>State</title></head><body><h1>State</h1></body></html>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  registry = createToolRegistry();
  await registry.execute("navigate", { url: `${base}/`, observe: false });
});

after(async () => {
  await registry.disposeAll();
  await new Promise((r) => server.close(r));
});

test("evaluate returns a JSON value, and binds `el` when given a Ref", async () => {
  assert.equal((await registry.execute("evaluate", { expression: "1 + 2" })).value, 3);
  assert.equal((await registry.execute("evaluate", { expression: "document.title" })).value, "State");
  const { elements } = await registry.execute("describe", {});
  const h1 = elements.find((e) => e.role === "heading");
  assert.equal((await registry.execute("evaluate", { ref: h1.ref, expression: "el.tagName" })).value, "H1");
  await assert.rejects(registry.execute("evaluate", { expression: "nope.nope" }), /nope/);
});

test("cookies round-trip through set, get, delete, clear", async () => {
  await registry.execute("cookies", { action: "set", name: "sid", value: "abc", url: base, httpOnly: true });
  const { cookies } = await registry.execute("cookies", { action: "get", url: base });
  const sid = cookies.find((c) => c.name === "sid");
  assert.equal(sid?.value, "abc");
  assert.equal(sid?.httpOnly, true, "HttpOnly cookies are visible to the agent");
  // The page really has it (non-HttpOnly copy for document.cookie).
  await registry.execute("cookies", { action: "set", name: "theme", value: "dark", url: base });
  await registry.execute("navigate", { url: `${base}/`, observe: false });
  assert.match((await registry.execute("evaluate", { expression: "document.cookie" })).value, /theme=dark/);

  const afterDelete = (await registry.execute("cookies", { action: "delete", name: "sid" })).cookies;
  assert.ok(!afterDelete.some((c) => c.name === "sid"));
  assert.deepEqual((await registry.execute("cookies", { action: "clear" })).cookies, []);
});

test("storage reads and writes localStorage and sessionStorage separately", async () => {
  await registry.execute("storage", { store: "local", action: "set", key: "k", value: "v" });
  assert.equal((await registry.execute("storage", { store: "local", action: "get", key: "k" })).value, "v");
  assert.deepEqual((await registry.execute("storage", { store: "local", action: "get" })).value, { k: "v" });
  assert.equal((await registry.execute("storage", { store: "session", action: "get", key: "k" })).value, null);
  await registry.execute("storage", { store: "local", action: "remove", key: "k" });
  assert.deepEqual((await registry.execute("storage", { store: "local", action: "get" })).value, {});
  await assert.rejects(registry.execute("storage", { store: "local", action: "set", key: "k" }), InvalidToolArgsError);
});

test("sessions lists live browsers and closes one on request", async () => {
  assert.deepEqual(await registry.execute("sessions", {}), { sessions: ["default"] });
  await registry.execute("navigate", { url: `${base}/`, session: "scratch", observe: false });
  assert.deepEqual((await registry.execute("sessions", {})).sessions.sort(), ["default", "scratch"]);
  const closed = await registry.execute("sessions", { action: "close", session: "scratch" });
  assert.equal(closed.ok, true);
  assert.deepEqual(closed.sessions, ["default"]);
  const missing = await registry.execute("sessions", { action: "close", session: "scratch" });
  assert.equal(missing.error, "no_such_session");
});
