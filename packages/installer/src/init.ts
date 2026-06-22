// `maheragent init` — register the MCP server in the chosen editors, optionally
// auto-approve the tools, and copy skills into each editor's native skills dir.
// Interactive (@clack) when run in a TTY without --yes; flag-driven otherwise.

import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_ADAPTERS,
  detectAdapters,
  getAdapterByName,
  getMcpEntry,
  getSkillTargets,
  type AllowlistScope,
  type McpConfigAdapter,
} from "./adapters.js";
import { copySkillsToTargets } from "./skills.js";

export interface InitOptions {
  /** Restrict to one editor by name (skips the multiselect). */
  editor?: string;
  /** Force a scope instead of prompting. */
  scope?: "local" | "global";
  /** Project root for "local" scope (defaults to cwd). */
  root?: string;
  /** Skip the auto-approve allowlist step. */
  noAllowlist?: boolean;
  /** Run without prompts (CI / scripted). */
  yes?: boolean;
}

function parse(argv: string[]): { command: string; opts: InitOptions } {
  const [command = "init", ...rest] = argv;
  const opts: InitOptions = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--editor" && rest[i + 1]) opts.editor = rest[++i];
    else if (a === "--root" && rest[i + 1]) opts.root = resolve(rest[++i]!);
    else if (a === "--global") opts.scope = "global";
    else if (a === "--local") opts.scope = "local";
    else if (a === "--no-allowlist") opts.noAllowlist = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
  }
  return { command, opts };
}

const interactive = (opts: InitOptions): boolean => !opts.yes && Boolean(process.stdout.isTTY);

/** Resolve which editors to configure. */
async function chooseEditors(opts: InitOptions): Promise<McpConfigAdapter[] | null> {
  if (opts.editor) {
    const adapter = getAdapterByName(opts.editor);
    if (!adapter) {
      console.error(
        `Unknown editor "${opts.editor}". Supported: ${ALL_ADAPTERS.map((a) => a.name).join(", ")}.`,
      );
      process.exitCode = 1;
      return null;
    }
    return [adapter];
  }

  const detected = detectAdapters();
  if (!interactive(opts)) return detected.length > 0 ? detected : ALL_ADAPTERS;

  const selected = await p.multiselect({
    message: "Which editors should maheragent be configured for?",
    options: ALL_ADAPTERS.map((a) => ({
      value: a,
      label: a.name,
      hint: detected.includes(a) ? "detected" : undefined,
    })),
    initialValues: detected,
    required: true,
  });
  if (p.isCancel(selected)) return null;
  return selected as McpConfigAdapter[];
}

/** Resolve scope (local/global) and the effective root. */
async function chooseScope(
  opts: InitOptions,
): Promise<{ scope: AllowlistScope; root: string } | null> {
  const root = opts.root ?? process.cwd();
  if (opts.scope) return { scope: opts.scope, root };
  if (!interactive(opts)) return { scope: "local", root };

  const choice = await p.select({
    message: "Install the MCP server locally (this project) or globally (all projects)?",
    options: [
      { value: "local" as const, label: "Local", hint: ".mcp.json / .cursor/mcp.json / …" },
      { value: "global" as const, label: "Global", hint: "~/.claude.json, ~/.cursor/mcp.json, …" },
    ],
  });
  if (p.isCancel(choice)) return null;
  return { scope: choice as AllowlistScope, root };
}

/** Pick the config path for an adapter at a scope, falling back across scopes. */
function configPathFor(
  adapter: McpConfigAdapter,
  scope: AllowlistScope,
  root: string,
): string | null {
  const primary = scope === "global" ? adapter.globalPath() : adapter.projectPath(root);
  if (primary) return primary;
  // Fall back to the other scope if this editor only supports one.
  return scope === "global" ? adapter.projectPath(root) : adapter.globalPath();
}

export async function init(argv: string[]): Promise<void> {
  const { opts } = parse(argv);
  const banner = interactive(opts);
  if (banner) p.intro(pc.bgCyan(pc.black(" maheragent init ")));

  const adapters = await chooseEditors(opts);
  if (!adapters) {
    if (banner) p.cancel("Cancelled.");
    return;
  }

  const scoped = await chooseScope(opts);
  if (!scoped) {
    if (banner) p.cancel("Cancelled.");
    return;
  }
  const { scope, root } = scoped;

  // ── MCP registration ──────────────────────────────────────────────────────
  const entry = getMcpEntry();
  const mcpLines: string[] = [];
  for (const adapter of adapters) {
    const configPath = configPathFor(adapter, scope, root);
    if (!configPath) {
      mcpLines.push(`${pc.yellow("-")} ${adapter.name} (no config path for this scope)`);
      continue;
    }
    try {
      adapter.write(configPath, entry);
      mcpLines.push(`${pc.green("+")} ${adapter.name} ${pc.dim(configPath)}`);
    } catch (err) {
      mcpLines.push(`${pc.red("x")} ${adapter.name}: ${pc.dim(String(err))}`);
    }
  }
  report("MCP servers", mcpLines, banner);

  // ── Auto-approve allowlist ────────────────────────────────────────────────
  let allowlist = !opts.noAllowlist;
  const allowlistable = adapters.filter((a) => a.addAllowlist);
  if (allowlist && allowlistable.length > 0 && interactive(opts)) {
    const ok = await p.confirm({
      message: "Add maheragent tools to the editors' auto-approve lists? (recommended)",
      initialValue: true,
    });
    if (p.isCancel(ok)) {
      p.cancel("Cancelled.");
      return;
    }
    allowlist = ok;
  }
  if (allowlist && allowlistable.length > 0) {
    const lines: string[] = [];
    for (const adapter of allowlistable) {
      try {
        adapter.addAllowlist!(root, scope);
        lines.push(`${pc.green("+")} ${adapter.name}`);
      } catch (err) {
        lines.push(`${pc.red("x")} ${adapter.name}: ${pc.dim(String(err))}`);
      }
    }
    report("Auto-approve", lines, banner);
  }

  // ── Skills into editor-native dirs ────────────────────────────────────────
  const targets = getSkillTargets(adapters, root, scope);
  const skillResults = copySkillsToTargets(targets);
  report(
    "Skills",
    skillResults.map((r) =>
      r.ok ? `${pc.green("+")} ${r.dir}` : `${pc.red("x")} ${r.dir}: ${pc.dim(r.error ?? "")}`,
    ),
    banner,
  );

  const done = `Configured ${adapters.map((a) => a.name).join(", ")} (${scope}). Restart your editor to pick up the change.`;
  if (banner) p.outro(pc.green(done));
  else console.log(done);
}

function report(title: string, lines: string[], banner: boolean): void {
  if (lines.length === 0) return;
  if (banner) p.note(lines.join("\n"), title);
  else console.log(`${title}:\n${lines.join("\n")}`);
}

export { parse as parseInitArgs };
