import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_ADAPTERS,
  getAdapterByName,
  getMcpEntry,
  getSkillTargets,
  addClaudePermission,
  copySkillsToTargets,
  MCP_SERVER_KEY,
  MCP_BINARY_NAME,
} from "@ramisalem/installer";

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), "maher-install-"));
});
after(() => {
  rmSync(root, { recursive: true, force: true });
});

const read = (p) => readFileSync(p, "utf8");

test("getMcpEntry is portable (binary name, not an absolute path)", () => {
  const entry = getMcpEntry();
  assert.equal(entry.command, MCP_BINARY_NAME);
  assert.deepEqual(entry.args, ["mcp"]);
});

test("all 9 editor adapters are registered and findable by name", () => {
  assert.equal(ALL_ADAPTERS.length, 9);
  for (const name of ["cursor", "claude code", "vs code", "windsurf", "gemini", "zed", "opencode", "codex", "hermes"]) {
    assert.ok(getAdapterByName(name), `${name} resolvable`);
  }
});

test("short editor aliases resolve (claude → Claude Code, vscode → VS Code)", () => {
  assert.equal(getAdapterByName("claude")?.name, "Claude Code");
  assert.equal(getAdapterByName("vscode")?.name, "VS Code");
  assert.equal(getAdapterByName("nope"), undefined);
});

test("Claude adapter writes JSON with type:stdio and preserves other servers", () => {
  const adapter = getAdapterByName("claude code");
  const p = join(root, ".mcp.json");
  writeFileSync(p, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  adapter.write(p, getMcpEntry());
  const cfg = JSON.parse(read(p));
  assert.equal(cfg.mcpServers.other.command, "x");
  assert.equal(cfg.mcpServers[MCP_SERVER_KEY].type, "stdio");
  assert.equal(cfg.mcpServers[MCP_SERVER_KEY].command, MCP_BINARY_NAME);
  assert.equal(adapter.hasEntry(p), true);
  assert.equal(adapter.remove(p), true);
  assert.ok(!JSON.parse(read(p)).mcpServers?.[MCP_SERVER_KEY]);
});

test("VS Code adapter uses the `servers` key", () => {
  const adapter = getAdapterByName("vs code");
  const p = join(root, ".vscode", "mcp.json");
  adapter.write(p, getMcpEntry());
  assert.ok(JSON.parse(read(p)).servers[MCP_SERVER_KEY]);
});

test("Zed adapter writes JSONC and preserves user comments", () => {
  const adapter = getAdapterByName("zed");
  const p = join(root, ".zed", "settings.json");
  mkdirSync(join(root, ".zed"), { recursive: true });
  writeFileSync(p, `{\n  // keep me\n  "theme": "Dark"\n}\n`);
  adapter.write(p, getMcpEntry());
  const text = read(p);
  assert.match(text, /\/\/ keep me/, "comment survived");
  assert.match(text, /"theme": "Dark"/, "user setting survived");
  assert.match(text, /context_servers/);
  assert.equal(adapter.hasEntry(p), true);
  adapter.remove(p);
  assert.equal(adapter.hasEntry(p), false);
});

test("Codex adapter round-trips TOML", () => {
  const adapter = getAdapterByName("codex");
  const p = join(root, ".codex", "config.toml");
  adapter.write(p, getMcpEntry());
  assert.match(read(p), /\[mcp_servers\.maheragent\]/);
  assert.equal(adapter.hasEntry(p), true);
  adapter.remove(p);
  assert.equal(adapter.hasEntry(p), false);
});

test("Hermes adapter round-trips YAML", () => {
  const adapter = getAdapterByName("hermes");
  const p = join(root, "hermes.yaml");
  adapter.write(p, getMcpEntry());
  assert.match(read(p), /mcp_servers:/);
  assert.equal(adapter.hasEntry(p), true);
  adapter.remove(p);
  assert.equal(adapter.hasEntry(p), false);
});

test("Claude allowlist adds the permission rule to settings.json", () => {
  addClaudePermission(root, "local");
  const cfg = JSON.parse(read(join(root, ".claude", "settings.json")));
  assert.ok(cfg.permissions.allow.includes("mcp__maheragent"));
});

test("skill targets include editor-native dirs (not a tool-private folder)", () => {
  const claude = getAdapterByName("claude code");
  const cursor = getAdapterByName("cursor");
  const targets = getSkillTargets([claude, cursor], root, "local");
  const dirs = targets.map((t) => t.dir);
  assert.ok(dirs.some((d) => d.endsWith(join(".claude", "skills"))));
  assert.ok(dirs.some((d) => d.endsWith(join(".cursor", "skills"))));
  assert.ok(dirs.some((d) => d.endsWith(join(".agents", "skills"))), "universal target present");
});

test("copySkillsToTargets places the bundled SKILL.md files", () => {
  const target = { editor: "test", dir: join(root, "out", "skills") };
  const [result] = copySkillsToTargets([target]);
  assert.equal(result.ok, true);
  assert.ok(existsSync(join(target.dir, "figma-conformance", "SKILL.md")));
});
