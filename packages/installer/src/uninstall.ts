// `maheragent remove` — reverse what init did: drop our MCP entry from every
// editor config that has it, remove the allowlist entries, and delete the
// skills we copied.

import pc from "picocolors";
import {
  ALL_ADAPTERS,
  detectAdapters,
  findConfiguredAdapterScopes,
  getAdapterByName,
  getSkillTargets,
  type McpConfigAdapter,
} from "./adapters.js";
import { removeSkillsFromTargets } from "./skills.js";
import { parseInitArgs } from "./init.js";

export async function uninstall(argv: string[]): Promise<void> {
  const { opts } = parseInitArgs(argv);
  const root = opts.root ?? process.cwd();

  let adapters: McpConfigAdapter[];
  if (opts.editor) {
    const one = getAdapterByName(opts.editor);
    if (!one) {
      console.error(`Unknown editor "${opts.editor}".`);
      process.exitCode = 1;
      return;
    }
    adapters = [one];
  } else {
    // Consider every editor that currently has our entry, plus detected ones.
    adapters = ALL_ADAPTERS;
  }

  const configured = findConfiguredAdapterScopes(adapters, root);
  const lines: string[] = [];
  for (const { adapter, scope, configPath } of configured) {
    try {
      const removed = adapter.remove(configPath);
      adapter.removeAllowlist?.(root, scope === "global" ? "global" : "local");
      if (removed) lines.push(`${pc.green("-")} ${adapter.name} ${pc.dim(configPath)}`);
    } catch (err) {
      lines.push(`${pc.red("x")} ${adapter.name}: ${pc.dim(String(err))}`);
    }
  }

  // Remove copied skills from both scopes for the targeted adapters.
  for (const scope of ["local", "global"] as const) {
    removeSkillsFromTargets(getSkillTargets(adapters, root, scope));
  }

  console.log(
    lines.length > 0
      ? `Removed maheragent from:\n${lines.join("\n")}`
      : "maheragent was not configured in any detected editor.",
  );
  void detectAdapters; // (kept for symmetry; detection not needed for removal)
}
