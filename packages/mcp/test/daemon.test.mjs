import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolServerClient, spawnDaemon, ensureToolServer } from "@ramisalem/mcp";
import { readDaemonInfo } from "@ramisalem/tool-server";

let home;
let daemonPid;

before(() => {
  home = mkdtempSync(join(tmpdir(), "maher-daemon-"));
  process.env.MAHERAGENT_HOME = home;
});

after(() => {
  if (daemonPid) {
    try {
      process.kill(daemonPid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  delete process.env.MAHERAGENT_HOME;
  rmSync(home, { recursive: true, force: true });
});

test("spawnDaemon starts a live, reachable daemon", async () => {
  const handshake = await spawnDaemon();
  daemonPid = handshake.pid;
  assert.match(handshake.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(handshake.token.length > 0);

  const client = new ToolServerClient(handshake.url, handshake.token);
  assert.equal(await client.isHealthy(), true);

  // It also published itself to the discovery file.
  const info = await readDaemonInfo();
  assert.equal(info.pid, handshake.pid);
});

test("ensureToolServer reuses the running daemon instead of spawning", async () => {
  const before = await readDaemonInfo();
  assert.ok(before, "a daemon should already be advertised");

  const client = await ensureToolServer();
  assert.equal(await client.isHealthy(), true);

  // No new process: the advertised pid is unchanged.
  const after = await readDaemonInfo();
  assert.equal(after.pid, before.pid);
});
