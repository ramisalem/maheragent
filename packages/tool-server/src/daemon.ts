// Where a running daemon advertises itself. The tool-server writes a small
// discovery file on startup so a later MCP adapter process can find an
// already-running daemon (and its live browser) instead of spawning a new one.
// The file holds a bearer token, so it is written owner-readable only.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What a running daemon publishes about how to reach it. */
export interface DaemonHandshake {
  /** Base URL, e.g. http://127.0.0.1:53124 */
  url: string;
  /** Bearer token clients must present. */
  token: string;
  /** PID of the daemon process (for liveness checks). */
  pid: number;
}

/** Root directory for daemon runtime state; override with MAHERAGENT_HOME. */
export function daemonHome(): string {
  return process.env.MAHERAGENT_HOME ?? join(homedir(), ".maheragent");
}

/** Path of the discovery file the daemon writes and the adapter reads. */
export function daemonInfoPath(): string {
  return join(daemonHome(), "daemon.json");
}

/** Publish this daemon's handshake (owner-readable only — it carries a token). */
export async function writeDaemonInfo(info: DaemonHandshake): Promise<void> {
  const path = daemonInfoPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(info), { mode: 0o600 });
}

/** Read the published handshake, or null if no daemon has advertised one. */
export async function readDaemonInfo(): Promise<DaemonHandshake | null> {
  try {
    const raw = await readFile(daemonInfoPath(), "utf8");
    const info = JSON.parse(raw) as DaemonHandshake;
    if (info && typeof info.url === "string" && typeof info.token === "string") {
      return info;
    }
    return null;
  } catch {
    return null;
  }
}

/** Remove the discovery file (on clean daemon shutdown). */
export async function clearDaemonInfo(): Promise<void> {
  await rm(daemonInfoPath(), { force: true });
}
