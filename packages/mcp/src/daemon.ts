// Ensures a tool-server daemon is running and returns a client for it.
//
// Discovery order (ADR-0001 — the daemon must outlive any single editor/MCP
// process so the BrowserSession survives reconnects):
//   1. If the discovery file points at a live daemon, reuse it.
//   2. Otherwise spawn the tool-server bin *detached*, read its handshake line
//      from stdout, then unref it so this process can exit independently.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readDaemonInfo, type DaemonHandshake } from "@ramisalem/tool-server";
import { ToolServerClient } from "./client.js";

const require = createRequire(import.meta.url);

/** Resolve the path to the tool-server's standalone entrypoint. */
function toolServerBin(): string {
  return require.resolve("@ramisalem/tool-server/dist/bin.js");
}

/** Return a client for a live daemon, reusing one if already running. */
export async function ensureToolServer(): Promise<ToolServerClient> {
  const existing = await readDaemonInfo();
  if (existing) {
    const client = new ToolServerClient(existing.url, existing.token);
    if (await client.isHealthy()) return client;
  }
  const handshake = await spawnDaemon();
  return new ToolServerClient(handshake.url, handshake.token);
}

/** Spawn the daemon detached and resolve once it prints its handshake line. */
export function spawnDaemon(timeoutMs = 15_000): Promise<DaemonHandshake> {
  return new Promise<DaemonHandshake>((resolve, reject) => {
    const child = spawn(process.execPath, [toolServerBin()], {
      detached: true,
      // stdout: read the one-line handshake. stderr inherited for diagnostics.
      stdio: ["ignore", "pipe", "inherit"],
    });

    let buffer = "";
    let settled = false;

    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.removeAllListeners();
      fn();
    };

    const timer = setTimeout(() => {
      done(() => {
        child.kill();
        reject(new Error("Timed out waiting for the tool-server to start."));
      });
    }, timeoutMs);

    child.on("error", (err) => done(() => reject(err)));
    child.on("exit", (code) =>
      done(() => reject(new Error(`tool-server exited before handshake (code ${code}).`))),
    );

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      try {
        const handshake = JSON.parse(line) as DaemonHandshake;
        done(() => {
          // Release the pipe and detach so this process can exit on its own
          // while the daemon keeps running (e.g. a short-lived CLI command).
          child.stdout?.destroy();
          child.unref();
          resolve(handshake);
        });
      } catch (err) {
        done(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    });
  });
}
