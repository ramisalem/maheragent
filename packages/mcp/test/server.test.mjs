import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startToolServer } from "@ramisalem/tool-server";
import { ToolServerClient, createMcpServer } from "@ramisalem/mcp";

const file = join(tmpdir(), `maher-mcp-server-${process.pid}.html`);
let toolServer;
let mcp;
let client;

before(async () => {
  writeFileSync(file, `<!doctype html><html><head><title>Home</title></head><body><h1>Hi</h1></body></html>`);
  toolServer = await startToolServer();

  const tsClient = new ToolServerClient(toolServer.url, toolServer.token);
  mcp = createMcpServer(tsClient, { name: "maheragent", version: "0.1.0" });

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverT);
  client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(clientT);
});

after(async () => {
  await client.close();
  await mcp.close();
  await toolServer.close();
  rmSync(file, { force: true });
});

test("MCP ListTools surfaces the daemon's tools", async () => {
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === "navigate"));
  assert.ok(tools.some((t) => t.name === "extract-styles"));
  const navigate = tools.find((t) => t.name === "navigate");
  assert.equal(navigate.inputSchema.type, "object");
});

test("MCP CallTool forwards to the daemon and returns the result", async () => {
  const res = await client.callTool({
    name: "navigate",
    arguments: { url: pathToFileURL(file).href },
  });
  assert.ok(!res.isError);
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.title, "Home");
});

test("MCP CallTool reports a tool failure as an error result", async () => {
  const res = await client.callTool({ name: "navigate", arguments: { url: "not-a-url" } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /invalid_args/);
});
