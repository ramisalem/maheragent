// CLI subcommands for humans poking at the toolkit from a terminal:
//   server status|start|stop   inspect / control the daemon
//   tools [<name>]             list tools, or show one tool's schema
//   run <tool> [json]          call a tool and print its result
//   flags | enable | disable   read and toggle feature flags
//   secrets                    list the names {{secret:NAME}} can resolve (never values)
//   flow list | run <name>     replay a recorded flow; exit 1 when it fails (CI)
// Everything that needs the browser goes through the same daemon the editor
// uses, so the CLI and the agent share one live session.

import { ensureToolServer, ToolCallError, ToolServerClient } from "@ramisalem/mcp";
import {
  clearDaemonInfo,
  listFlows,
  listSecrets,
  readDaemonInfo,
  resolveFlowPath,
  type FlowReport,
  type StepReport,
} from "@ramisalem/tool-server";
import { listFlags, setFlag, type FlagScope } from "@ramisalem/configuration-core";

const USAGE = `maheragent — drive a web app over MCP

Usage:
  maheragent server status|start|stop
  maheragent tools [<name>]
  maheragent run <tool> [json-args]
  maheragent flags
  maheragent enable|disable <flag> [--project]
  maheragent secrets
  maheragent flow list
  maheragent flow run <name|path> [--update-baselines] [--json]
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
    case "secrets":
      return secrets();
    case "flow":
      return flow(rest);
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
    console.log(`${t.enabled ? " " : "·"} ${t.name.padEnd(20)} ${t.description}`);
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

function secrets(): void {
  const all = listSecrets();
  if (all.length === 0) {
    console.log(
      "no secrets found — define MAHERAGENT_SECRET_<NAME> in the environment, or NAME=value in .maheragent/secrets.env (project) or ~/.maheragent/secrets.env (global)",
    );
    return;
  }
  for (const s of all) {
    console.log(`${s.shadowed ? "·" : " "} ${s.name.padEnd(24)} ${s.source}${s.shadowed ? " (shadowed)" : ""}`);
  }
}

const STATUS_GLYPH: Record<StepReport["status"], string> = { pass: "✓", fail: "✗", error: "✗", skip: "·" };

/** One line per step, indented by nesting depth, then the verdict. */
export function renderFlowReport(report: FlowReport): string {
  const lines = [`Flow "${report.flow}" (${report.steps.length} steps)`];
  for (const step of report.steps) {
    const indent = "  ".repeat(step.depth ?? 0);
    const target = step.target ? ` ${step.target}` : "";
    const reason = step.reason ? ` — ${step.reason}` : "";
    const warning = step.warning ? ` ⚠ ${step.warning}` : "";
    const time = step.status === "skip" ? "" : ` (${step.durationMs}ms)`;
    lines.push(`[${step.index + 1}] ${STATUS_GLYPH[step.status]} ${indent}${step.kind}${target}${reason}${warning}${time}`);
  }
  lines.push(
    `${report.ok ? "PASS" : "FAIL"} — ${report.passed} passed, ${report.failed} failed, ${report.errored} errored, ${report.skipped} skipped`,
  );
  return lines.join("\n");
}

async function flow(rest: string[]): Promise<void> {
  const [sub, ...args] = rest;
  if (sub === "list" || sub === undefined) {
    const flows = listFlows();
    console.log(flows.length ? flows.join("\n") : "no flows in .maheragent/flows/");
    return;
  }
  if (sub !== "run") {
    console.error("usage: maheragent flow list | run <name|path> [--update-baselines] [--json]");
    process.exitCode = 1;
    return;
  }
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) {
    console.error("usage: maheragent flow run <name|path> [--update-baselines] [--json]");
    process.exitCode = 1;
    return;
  }
  // Resolve against *this* cwd: the daemon may have been started elsewhere.
  const path = resolveFlowPath(name);
  const client = await ensureToolServer();
  try {
    const report = (await client.callTool("flow-run", {
      path,
      updateBaselines: args.includes("--update-baselines"),
    })) as FlowReport & { error?: string; message?: string };
    if (report.error) {
      console.error(report.message ?? report.error);
      process.exitCode = 1;
      return;
    }
    console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : renderFlowReport(report));
    if (!report.ok) process.exitCode = 1;
  } catch (err) {
    if (err instanceof ToolCallError) {
      console.error(`${err.code ?? "error"}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
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
