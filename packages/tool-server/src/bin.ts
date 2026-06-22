#!/usr/bin/env node
// Standalone entrypoint for the long-running daemon. Started either directly by
// an operator or spawned (detached) by the MCP adapter. On startup it publishes
// its handshake two ways: to the discovery file (for future adapter processes)
// and as a single JSON line on stdout (for the parent that spawned it).

import { startToolServer } from "./index.js";
import { clearDaemonInfo, writeDaemonInfo } from "./daemon.js";

async function main(): Promise<void> {
  const handle = await startToolServer({
    port: Number(process.env.MAHERAGENT_PORT ?? 0),
    token: process.env.MAHERAGENT_TOKEN,
  });

  const handshake = { url: handle.url, token: handle.token, pid: process.pid };
  await writeDaemonInfo(handshake);
  // Single line so a spawning parent can read exactly one JSON object and stop.
  process.stdout.write(JSON.stringify(handshake) + "\n");

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await clearDaemonInfo().catch(() => {});
    await handle.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  process.stderr.write(`tool-server failed to start: ${String(err)}\n`);
  process.exit(1);
});
