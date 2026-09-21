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
  getFigmaEntry,
  getSkillTargets,
  type AllowlistScope,
  type McpConfigAdapter,
} from "./adapters.js";
import { FIGMA_SERVER_KEY } from "./constants.js";
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
  /** Skip downloading Chromium; the daemon then fetches it on first launch. */
  noBrowser?: boolean;
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
    else if (a === "--no-browser") opts.noBrowser = true;
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
  // Register maheragent plus the Figma Dev Mode server (bridged via mcp-remote),
  // so the figma-conformance skill has both servers it needs out of the box.
  const entry = getMcpEntry();
  const figmaEntry = getFigmaEntry();
  const mcpLines: string[] = [];
  for (const adapter of adapters) {
    const configPath = configPathFor(adapter, scope, root);
    if (!configPath) {
      mcpLines.push(`${pc.yellow("-")} ${adapter.name} (no config path for this scope)`);
      continue;
    }
    try {
      adapter.write(configPath, entry);
      adapter.write(configPath, figmaEntry, FIGMA_SERVER_KEY);
      mcpLines.push(
        `${pc.green("+")} ${adapter.name} ${pc.dim(configPath)} ${pc.dim("(+ Figma Dev Mode)")}`,
      );
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

  // ── Browser ───────────────────────────────────────────────────────────────
  // Playwright's npm package ships without browsers, and each Playwright
  // release pins its own Chromium build. Fetch it now, while the developer is
  // watching, instead of stalling the agent's first tool call.
  if (!opts.noBrowser) await browserStep(banner);

  const done = `Configured ${adapters.map((a) => a.name).join(", ")} (${scope}). Restart your editor to pick up the change.`;
  if (banner) p.outro(pc.green(done));
  else console.log(done);
}

/** Download the Chromium build the daemon launches. Never fails init: the daemon retries on first launch. */
async function browserStep(banner: boolean): Promise<void> {
  const { installBrowser, playwrightVersion } = await import("@ramisalem/tool-server");
  const headless = !process.env.MAHERAGENT_HEADED;
  let label = "Chromium for Playwright";
  try {
    label += ` ${playwrightVersion()}`;
  } catch {
    /* Playwright unresolvable: installBrowser reports it below */
  }
  const spinner = banner ? p.spinner() : null;
  spinner?.start(`Checking ${label}`);
  try {
    await installBrowser({
      headless,
      output: (text) => {
        const percents = [...text.matchAll(/(\d{1,3})%/g)];
        const latest = percents[percents.length - 1]?.[1];
        if (latest) spinner?.message(`Downloading ${label} (${latest}%)`);
      },
    });
    if (spinner) spinner.stop(`${label} is ready`);
    else console.log(`Browser:\n${pc.green("+")} ${label}`);
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).split("\n")[0];
    const hint = "The daemon retries on its first launch, or run `maheragent browser install`.";
    if (spinner) spinner.error(`${label} could not be downloaded: ${reason}\n${hint}`);
    else console.log(`Browser:\n${pc.red("x")} ${label}: ${pc.dim(reason)}\n  ${hint}`);
  }
}

function report(title: string, lines: string[], banner: boolean): void {
  if (lines.length === 0) return;
  if (banner) p.note(lines.join("\n"), title);
  else console.log(`${title}:\n${lines.join("\n")}`);
}

export { parse as parseInitArgs };
