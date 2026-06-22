import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SERVER_NAME,
  EDITORS,
  mcpServerEntry,
  skillsSource,
  registerServer,
  unregisterServer,
  copySkills,
} from "@ramisalem/installer";

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), "maher-install-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

const readConfig = (p) => JSON.parse(readFileSync(p, "utf8"));

test("mcpServerEntry points node at the built mcp bin", () => {
  const entry = mcpServerEntry();
  assert.equal(entry.command, process.execPath);
  assert.match(entry.args[0], /mcp\/dist\/bin\.js$/);
  assert.ok(existsSync(entry.args[0]), "the resolved bin exists");
});

test("registerServer adds our entry under mcpServers", async () => {
  const path = join(root, ".mcp.json");
  await registerServer(path, EDITORS.claude.key);
  const config = readConfig(path);
  assert.ok(config.mcpServers[SERVER_NAME]);
  assert.equal(config.mcpServers[SERVER_NAME].command, process.execPath);
});

test("registerServer preserves other servers", async () => {
  const path = join(root, "existing.json");
  writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  await registerServer(path, "mcpServers");
  const config = readConfig(path);
  assert.equal(config.mcpServers.other.command, "x");
  assert.ok(config.mcpServers[SERVER_NAME]);
});

test("unregisterServer removes only our entry", async () => {
  const path = join(root, "mix.json");
  writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "x" }, maheragent: { command: "y" } } }));
  const removed = await unregisterServer(path, "mcpServers");
  assert.equal(removed, true);
  const config = readConfig(path);
  assert.ok(config.mcpServers.other);
  assert.ok(!(SERVER_NAME in config.mcpServers));
  // Removing again is a no-op.
  assert.equal(await unregisterServer(path, "mcpServers"), false);
});

test("vscode uses the `servers` key", () => {
  assert.equal(EDITORS.vscode.key, "servers");
});

test("copySkills copies the bundled SKILL.md files", async () => {
  const dest = await copySkills(root);
  for (const name of ["web-interact", "figma-conformance", "web-performance"]) {
    assert.ok(existsSync(join(dest, name, "SKILL.md")), `${name} copied`);
  }
  assert.ok(skillsSource().endsWith("skills"));
});
