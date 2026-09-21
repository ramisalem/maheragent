import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
  assert.ok(existsSync(join(home, "daemon.log")), "its stderr goes to daemon.log");
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

test("the daemon does not hold its spawner's stderr open", async () => {
  // Regression: the daemon inherited the spawner's stderr, so a pipe reading
  // it never reached EOF while the daemon lived. \`maheragent server start
  // 2>&1 | cat\` never returned, and an MCP client never saw its server close.
  const home2 = mkdtempSync(join(tmpdir(), "maher-daemon-stderr-"));
  const script = `import("@ramisalem/mcp").then((m) => m.spawnDaemon()).then((h) => process.stdout.write(String(h.pid)))`;
  const spawner = spawn(process.execPath, ["-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MAHERAGENT_HOME: home2 },
  });
  let pid = "";
  spawner.stdout.on("data", (chunk) => (pid += chunk));
  // "close" fires only once the spawner has exited and both of its pipes hit EOF.
  const closed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 15_000);
    spawner.on("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  try {
    assert.ok(pid, "the spawner started a daemon");
    assert.equal(closed, true, "the spawner's pipes closed while its daemon kept running");
  } finally {
    if (pid) {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    rmSync(home2, { recursive: true, force: true });
  }
});
