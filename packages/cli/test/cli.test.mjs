import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@ramisalem/cli";

let home;

// Capture stdout/stderr for the duration of one runCli call.
async function capture(argv) {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => err.push(a.join(" "));
  process.exitCode = 0;
  try {
    await runCli(argv);
  } finally {
    console.log = log;
    console.error = error;
  }
  return { out: out.join("\n"), err: err.join("\n"), code: process.exitCode };
}

before(() => {
  home = mkdtempSync(join(tmpdir(), "maher-cli-"));
  process.env.MAHERAGENT_HOME = home;
});

beforeEach(() => {
  process.exitCode = 0;
});

after(() => {
  delete process.env.MAHERAGENT_HOME;
  process.exitCode = 0;
  rmSync(home, { recursive: true, force: true });
});

test("no args prints usage", async () => {
  const { out } = await capture([]);
  assert.match(out, /Usage:/);
});

test("unknown command exits non-zero", async () => {
  const { err, code } = await capture(["frobnicate"]);
  assert.match(err, /Unknown command/);
  assert.equal(code, 1);
});

test("server status reports a stopped daemon", async () => {
  const { out } = await capture(["server", "status"]);
  assert.match(out, /daemon: stopped/);
});

test("server stop on a stopped daemon is graceful", async () => {
  const { out } = await capture(["stop"]);
  assert.match(out, /already stopped/);
});

test("flags: empty, then enable shows it on", async () => {
  assert.match((await capture(["flags"])).out, /no flags set/);
  await capture(["enable", "diagnostics"]);
  const { out } = await capture(["flags"]);
  assert.match(out, /on .*diagnostics .*global/);
});

test("enable without a flag name errors", async () => {
  const { code } = await capture(["enable"]);
  assert.equal(code, 1);
});
