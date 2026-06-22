import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startToolServer } from "@ramisalem/tool-server";

const file = join(tmpdir(), `maher-http-${process.pid}.html`);
let server;

const auth = () => ({ authorization: `Bearer ${server.token}` });
const postJson = (name, body, headers = {}) =>
  fetch(`${server.url}/tools/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

before(async () => {
  writeFileSync(file, `<!doctype html><html><head><title>Checkout</title></head><body><button>Go</button></body></html>`);
  server = await startToolServer();
});

after(async () => {
  await server.close();
  rmSync(file, { force: true });
});

test("rejects requests without a bearer token", async () => {
  const res = await fetch(`${server.url}/tools`);
  assert.equal(res.status, 401);
});

test("GET /tools lists tools with JSON Schema", async () => {
  const res = await fetch(`${server.url}/tools`, { headers: auth() });
  assert.equal(res.status, 200);
  const { tools } = await res.json();
  const navigate = tools.find((t) => t.name === "navigate");
  assert.ok(navigate, "navigate present");
  assert.equal(navigate.enabled, true);
  assert.equal(navigate.inputSchema.type, "object");
  assert.ok(tools.some((t) => t.name === "extract-styles"));
});

test("POST /tools/navigate runs the tool", async () => {
  const res = await postJson("navigate", { url: pathToFileURL(file).href }, auth());
  assert.equal(res.status, 200);
  const { result } = await res.json();
  assert.equal(result.title, "Checkout");
});

test("unknown tool -> 404", async () => {
  const res = await postJson("does-not-exist", {}, auth());
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "unknown_tool");
});

test("invalid args -> 400", async () => {
  const res = await postJson("navigate", { url: "not-a-url" }, auth());
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_args");
});

test("malformed JSON body -> 400", async () => {
  const res = await postJson("navigate", "{ not json", auth());
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid_json");
});
