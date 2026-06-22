// CLI subcommands for humans poking at the toolkit from a terminal:
//   server status|start|stop   inspect / control the daemon
//   tools [<name>]             list tools, or show one tool's schema
//   run <tool> [json]          call a tool and print its result
//   flags | enable | disable   read and toggle feature flags
// Everything that needs the browser goes through the same daemon the editor
// uses, so the CLI and the agent share one live session.

import { ensureToolServer, ToolCallError, ToolServerClient } from "@ramisalem/mcp";
import { clearDaemonInfo, readDaemonInfo } from "@ramisalem/tool-server";
import { listFlags, setFlag, type FlagScope } from "@ramisalem/configuration-core";

const USAGE = `maheragent — drive a web app over MCP

Usage:
  maheragent server status|start|stop
  maheragent tools [<name>]
  maheragent run <tool> [json-args]
  maheragent flags
  maheragent enable|disable <flag> [--project]
  maheragent init|remove [--editor claude|cursor|vscode]
  maheragent mcp
`;

/** Entrypoint for every command the umbrella doesn't route elsewhere. */
export async function runCli(argv: string[]): Promise<void> {
  let [cmd, ...rest] = argv;
  // Accept both `server status` and a bare `status`/`start`/`stop`.
  if (cmd === "server") [cmd, ...rest] = rest;

  switch (cmd) {
    case "status":
      return serverStatus();
    case "start":
      return serverStart();
    case "stop":
      return serverStop();
    case "tools":
      return tools(rest[0]);
    case "run":
      return run(rest);
    case "flags":
      return flags();
    case "enable":
      return toggle(rest, true);
    case "disable":
      return toggle(rest, false);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(USAGE.trimEnd());
      return;
    default:
      console.error(`Unknown command "${cmd}".\n`);
      console.log(USAGE.trimEnd());
      process.exitCode = 1;
  }
}

async function serverStatus(): Promise<void> {
  const info = await readDaemonInfo();
  if (!info) {
    console.log("daemon: stopped (no discovery file)");
    return;
  }
  const alive = await new ToolServerClient(info.url, info.token).isHealthy();
  console.log(
    alive
      ? `daemon: running at ${info.url} (pid ${info.pid})`
      : `daemon: stale — ${info.url} (pid ${info.pid}) is advertised but not responding`,
  );
}

async function serverStart(): Promise<void> {
  const client = await ensureToolServer();
  const info = await readDaemonInfo();
  console.log(`daemon: ready at ${info?.url ?? "(unknown)"}`);
  // Touch the client so an unreachable daemon surfaces here, not later.
  if (!(await client.isHealthy())) console.error("warning: daemon did not pass a health check");
}

async function serverStop(): Promise<void> {
  const info = await readDaemonInfo();
  if (!info) {
    console.log("daemon: already stopped");
    return;
  }
  try {
    process.kill(info.pid, "SIGTERM");
    console.log(`daemon: sent SIGTERM to pid ${info.pid}`);
  } catch {
    console.log(`daemon: pid ${info.pid} was not running; clearing discovery file`);
  }
  await clearDaemonInfo();
}

async function tools(name?: string): Promise<void> {
  const client = await ensureToolServer();
  const all = await client.listTools();
  if (name) {
    const tool = all.find((t) => t.name === name);
    if (!tool) {
      console.error(`No such tool "${name}".`);
      process.exitCode = 1;
      return;
    }
    console.log(`${tool.name}${tool.enabled ? "" : " (disabled)"}\n${tool.description}\n`);
    console.log(JSON.stringify(tool.inputSchema, null, 2));
    return;
  }
  for (const t of all) {
    console.log(`${t.enabled ? " " : "·"} ${t.name.padEnd(16)} ${t.description}`);
  }
}

async function run(rest: string[]): Promise<void> {
  const [name, ...argParts] = rest;
  if (!name) {
    console.error("usage: maheragent run <tool> [json-args]");
    process.exitCode = 1;
    return;
  }
  let args: unknown = {};
  const raw = argParts.join(" ").trim();
  if (raw) {
    try {
      args = JSON.parse(raw);
    } catch {
      console.error(`Arguments must be valid JSON. Got: ${raw}`);
      process.exitCode = 1;
      return;
    }
  }
  const client = await ensureToolServer();
  try {
    const result = await client.callTool(name, args);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof ToolCallError) {
      console.error(`${err.code ?? "error"}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function flags(): void {
  const all = listFlags();
  if (all.length === 0) {
    console.log("no flags set");
    return;
  }
  for (const f of all) {
    console.log(`${f.enabled ? "on " : "off"}  ${f.name.padEnd(20)} (${f.scope})`);
  }
}

async function toggle(rest: string[], enabled: boolean): Promise<void> {
  const name = rest.find((a) => !a.startsWith("--"));
  if (!name) {
    console.error(`usage: maheragent ${enabled ? "enable" : "disable"} <flag> [--project]`);
    process.exitCode = 1;
    return;
  }
  const scope: FlagScope = rest.includes("--project") ? "project" : "global";
  await setFlag(name, enabled, scope);
  console.log(`${enabled ? "enabled" : "disabled"} "${name}" (${scope})`);
}
