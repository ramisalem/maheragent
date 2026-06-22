import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startToolServer } from "@ramisalem/tool-server";
import { ToolServerClient, ToolCallError } from "@ramisalem/mcp";

const file = join(tmpdir(), `maher-mcp-client-${process.pid}.html`);
let server;
let client;

before(async () => {
  writeFileSync(file, `<!doctype html><html><head><title>Pricing</title></head><body><h1>Plans</h1></body></html>`);
  server = await startToolServer();
  client = new ToolServerClient(server.url, server.token);
});

after(async () => {
  await server.close();
  rmSync(file, { force: true });
});

test("listTools returns the daemon catalog", async () => {
  const tools = await client.listTools();
  assert.ok(tools.some((t) => t.name === "navigate"));
  const navigate = tools.find((t) => t.name === "navigate");
  assert.equal(navigate.enabled, true);
  assert.equal(navigate.inputSchema.type, "object");
});

test("callTool runs a tool and returns its result", async () => {
  const result = await client.callTool("navigate", { url: pathToFileURL(file).href });
  assert.equal(result.title, "Pricing");
});

test("callTool throws ToolCallError on an unknown tool", async () => {
  await assert.rejects(
    client.callTool("nope", {}),
    (err) => err instanceof ToolCallError && err.status === 404 && err.code === "unknown_tool",
  );
});

test("callTool throws ToolCallError on invalid args", async () => {
  await assert.rejects(
    client.callTool("navigate", { url: "not-a-url" }),
    (err) => err instanceof ToolCallError && err.status === 400 && err.code === "invalid_args",
  );
});

test("isHealthy reports a live daemon", async () => {
  assert.equal(await client.isHealthy(), true);
  assert.equal(await new ToolServerClient("http://127.0.0.1:1", "x").isHealthy(), false);
});

test("a wrong token is rejected", async () => {
  const bad = new ToolServerClient(server.url, "wrong");
  await assert.rejects(bad.listTools(), (err) => err instanceof ToolCallError && err.status === 401);
});
