import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isFlagEnabled,
  effectiveFlags,
  listFlags,
  setFlag,
  flagsPath,
} from "@ramisalem/configuration-core";

let home;
let project;
let origCwd;

before(() => {
  origCwd = process.cwd();
  project = mkdtempSync(join(tmpdir(), "maher-proj-"));
  process.chdir(project);
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "maher-home-"));
  process.env.MAHERAGENT_HOME = home;
  // Reset the project flags file between cases.
  rmSync(join(project, ".maheragent"), { recursive: true, force: true });
});

after(() => {
  process.chdir(origCwd);
  delete process.env.MAHERAGENT_HOME;
  rmSync(project, { recursive: true, force: true });
});

test("absent flag is disabled", () => {
  assert.equal(isFlagEnabled("diagnostics"), false);
});

test("setFlag (global) enables a flag", async () => {
  await setFlag("diagnostics", true);
  assert.equal(isFlagEnabled("diagnostics"), true);
  assert.equal(effectiveFlags().diagnostics, true);
});

test("project flags override global", async () => {
  await setFlag("diagnostics", true, "global");
  await setFlag("diagnostics", false, "project");
  assert.equal(isFlagEnabled("diagnostics"), false);
  const state = listFlags().find((f) => f.name === "diagnostics");
  assert.equal(state.scope, "project");
  assert.equal(state.enabled, false);
});

test("listFlags unions both scopes, sorted", async () => {
  await setFlag("zeta", true, "global");
  await setFlag("alpha", true, "project");
  assert.deepEqual(
    listFlags().map((f) => f.name),
    ["alpha", "zeta"],
  );
});

test("a malformed flags file is treated as empty", () => {
  mkdirSync(join(home), { recursive: true });
  writeFileSync(flagsPath("global"), "{ not json");
  assert.equal(isFlagEnabled("anything"), false);
  assert.deepEqual(listFlags(), []);
});
