// Feature flags. A flag is on when a flags file says so; the project file
// (<cwd>/.maheragent/flags.json) overrides the global one (~/.maheragent/
// flags.json). Reads are synchronous so the Registry can gate tools inline;
// writes are async. Zero dependencies — this is the bottom of the stack.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type FlagName = string;
export type FlagScope = "global" | "project";

/** Root for global config; override with MAHERAGENT_HOME. */
function globalHome(): string {
  return process.env.MAHERAGENT_HOME ?? join(homedir(), ".maheragent");
}

/** Path to a scope's flags file. */
export function flagsPath(scope: FlagScope): string {
  const dir = scope === "global" ? globalHome() : join(process.cwd(), ".maheragent");
  return join(dir, "flags.json");
}

function parse(raw: string): Record<string, boolean> {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === "object") {
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === "boolean") out[k] = v;
      }
      return out;
    }
  } catch {
    /* ignore malformed file — treat as empty */
  }
  return {};
}

function readScopeSync(scope: FlagScope): Record<string, boolean> {
  try {
    return parse(readFileSync(flagsPath(scope), "utf8"));
  } catch {
    return {};
  }
}

async function readScope(scope: FlagScope): Promise<Record<string, boolean>> {
  try {
    return parse(await readFile(flagsPath(scope), "utf8"));
  } catch {
    return {};
  }
}

/** Global flags overlaid by project flags. */
export function effectiveFlags(): Record<string, boolean> {
  return { ...readScopeSync("global"), ...readScopeSync("project") };
}

/** Whether a flag is enabled, honoring project-over-global precedence. */
export function isFlagEnabled(name: FlagName): boolean {
  return effectiveFlags()[name] === true;
}

/** A flag's current value plus where the winning value came from. */
export interface FlagState {
  name: FlagName;
  enabled: boolean;
  scope: FlagScope;
}

/** Every flag mentioned in either scope, with its effective value and origin. */
export function listFlags(): FlagState[] {
  const global = readScopeSync("global");
  const project = readScopeSync("project");
  const names = new Set([...Object.keys(global), ...Object.keys(project)]);
  return [...names].sort().map((name) => {
    const inProject = name in project;
    return {
      name,
      enabled: inProject ? project[name] : global[name],
      scope: inProject ? "project" : "global",
    };
  });
}

/** Set a flag in a scope (default global), creating the file if needed. */
export async function setFlag(
  name: FlagName,
  enabled: boolean,
  scope: FlagScope = "global",
): Promise<void> {
  const flags = await readScope(scope);
  flags[name] = enabled;
  const path = flagsPath(scope);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(flags, null, 2) + "\n");
}

/** Synchronous variant of {@link setFlag} (used by simple scripts/tests). */
export function setFlagSync(
  name: FlagName,
  enabled: boolean,
  scope: FlagScope = "global",
): void {
  const flags = readScopeSync(scope);
  flags[name] = enabled;
  const path = flagsPath(scope);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(flags, null, 2) + "\n");
}
