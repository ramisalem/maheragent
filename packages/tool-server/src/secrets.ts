// Secret placeholders. `{{secret:NAME}}` in typed text is replaced on the
// daemon, right before it reaches the page, so the plaintext never enters the
// agent's context: not in the tool call, not in the result, not in the
// transcript. Resolution happens on the machine running the daemon.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PLACEHOLDER = /\{\{\s*secret:([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const ENV_PREFIX = "MAHERAGENT_SECRET_";

export interface SecretLookup {
  name: string;
  value: string;
  /** Where it came from: "env" or a file path. */
  source: string;
}

export interface SecretListing {
  name: string;
  source: string;
  /** True when an earlier source already defines this name and wins. */
  shadowed?: boolean;
}

export interface SecretOptions {
  /** Project root to look under (defaults to the daemon's cwd). */
  cwd?: string;
}

function globalHome(): string {
  return process.env.MAHERAGENT_HOME ?? join(homedir(), ".maheragent");
}

/** Minimal dotenv: `KEY=value` lines, `#` comments, optional single/double quotes. */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = trimmed.slice(eq + 1).trim();
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    out[key] = value;
  }
  return out;
}

/**
 * Every secret each source defines, in precedence order — the first entry for
 * a name wins:
 *   1. `MAHERAGENT_SECRET_<NAME>` environment variables
 *   2. `<cwd>/.maheragent/secrets.env` (every key; gitignore it)
 *   3. `<cwd>/.env.local`, then `<cwd>/.env` (only `MAHERAGENT_SECRET_*` keys)
 *   4. `~/.maheragent/secrets.env` (every key, for every project)
 */
export function loadSecrets(opts: SecretOptions = {}): SecretLookup[] {
  const cwd = opts.cwd ?? process.cwd();
  const out: SecretLookup[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(ENV_PREFIX) && value !== undefined) {
      out.push({ name: key.slice(ENV_PREFIX.length), value, source: "env" });
    }
  }
  const files: Array<{ path: string; prefixedOnly: boolean }> = [
    { path: join(cwd, ".maheragent", "secrets.env"), prefixedOnly: false },
    { path: join(cwd, ".env.local"), prefixedOnly: true },
    { path: join(cwd, ".env"), prefixedOnly: true },
    { path: join(globalHome(), "secrets.env"), prefixedOnly: false },
  ];
  for (const file of files) {
    if (!existsSync(file.path)) continue;
    for (const [key, value] of Object.entries(parseEnvFile(file.path))) {
      if (file.prefixedOnly) {
        // A bare NAME=value in .env belongs to the app, not to us.
        if (!key.startsWith(ENV_PREFIX)) continue;
        out.push({ name: key.slice(ENV_PREFIX.length), value, source: file.path });
      } else {
        out.push({ name: key, value, source: file.path });
      }
    }
  }
  return out;
}

/** The names a placeholder can resolve and where each comes from. Never values. */
export function listSecrets(opts: SecretOptions = {}): SecretListing[] {
  const seen = new Set<string>();
  return loadSecrets(opts).map(({ name, source }) => {
    const shadowed = seen.has(name);
    seen.add(name);
    return shadowed ? { name, source, shadowed } : { name, source };
  });
}

/** Whether the text carries any `{{secret:NAME}}` placeholder. */
export function hasSecretPlaceholder(text: string): boolean {
  return new RegExp(PLACEHOLDER.source).test(text);
}

/**
 * Replace every `{{secret:NAME}}` with its value.
 * @throws when a name is defined by no source — better than typing the
 *         placeholder itself into a password field.
 */
export function resolveSecrets(
  text: string,
  opts: SecretOptions = {},
): { text: string; used: string[] } {
  if (!hasSecretPlaceholder(text)) return { text, used: [] };
  const lookups = loadSecrets(opts);
  const used: string[] = [];
  const resolved = text.replace(PLACEHOLDER, (_match, name: string) => {
    const hit = lookups.find((l) => l.name === name);
    if (!hit) {
      throw new Error(
        `Unknown secret "${name}". Define ${ENV_PREFIX}${name} in the environment, or add ${name}=… to .maheragent/secrets.env (project) or ~/.maheragent/secrets.env (global). Run \`maheragent secrets\` to list the names available.`,
      );
    }
    if (!used.includes(name)) used.push(name);
    return hit.value;
  });
  return { text: resolved, used };
}
