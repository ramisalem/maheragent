// One adapter per editor. Each knows where that editor keeps its MCP config,
// what format it is, and the top-level key its servers live under — so the rest
// of the installer can stay editor-agnostic. Adapters also place the bundled
// skills into each editor's *native* skills directory, so the agent discovers
// them without extra wiring.

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { isMap } from "yaml";
import {
  MCP_SERVER_KEY,
  MCP_BINARY_NAME,
  PERMISSION_RULE,
  CURSOR_ALLOWLIST_PATTERN,
} from "./constants.js";
import {
  dirExists,
  editJsoncFile,
  readJson,
  readJsonc,
  readToml,
  readYaml,
  writeJson,
  writeJsonOrRemove,
  writeToml,
  writeTomlOrRemove,
  writeYaml,
} from "./format.js";

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type AllowlistScope = "local" | "global";

export interface McpConfigAdapter {
  name: string;
  /** Is this editor present on the machine / in the project? */
  detect(): boolean;
  /** Config file for project scope, or null if the editor has none. */
  projectPath(root: string): string | null;
  /** Config file for global scope, or null if the editor has none. */
  globalPath(): string | null;
  write(configPath: string, entry: McpServerEntry): void;
  /** Remove our entry; returns true if something was removed. */
  remove(configPath: string): boolean;
  /** Non-mutating: is our server already configured here? */
  hasEntry(configPath: string): boolean;
  addAllowlist?(root: string, scope: AllowlistScope): void;
  removeAllowlist?(root: string, scope: AllowlistScope): void;
}

/** The portable entry editors launch — binary name, not an absolute path. */
export function getMcpEntry(): McpServerEntry {
  return { command: MCP_BINARY_NAME, args: ["mcp"] };
}

function hasEnv(entry: McpServerEntry): entry is McpServerEntry & { env: Record<string, string> } {
  return entry.env != null && Object.keys(entry.env).length > 0;
}

// ── JSON family ────────────────────────────────────────────────────────────────
// Cursor, Claude Code, VS Code, Windsurf, Gemini all store servers as a JSON
// object under one key. They differ only in: the key, whether each entry needs
// `type: "stdio"`, and where the files live.

interface JsonAdapterSpec {
  name: string;
  key: "mcpServers" | "servers";
  stdioType?: boolean;
  projectFile?: (root: string) => string;
  globalFile?: () => string;
  detect: () => boolean;
}

function makeJsonAdapter(spec: JsonAdapterSpec): McpConfigAdapter {
  const buildEntry = (entry: McpServerEntry) => ({
    ...(spec.stdioType ? { type: "stdio" as const } : {}),
    command: entry.command,
    args: entry.args,
    ...(hasEnv(entry) ? { env: entry.env } : {}),
  });
  return {
    name: spec.name,
    detect: spec.detect,
    projectPath: (root) => spec.projectFile?.(root) ?? null,
    globalPath: () => spec.globalFile?.() ?? null,
    write(configPath, entry) {
      const config = readJson(configPath);
      const servers = (config[spec.key] ?? {}) as Record<string, unknown>;
      servers[MCP_SERVER_KEY] = buildEntry(entry);
      config[spec.key] = servers;
      writeJson(configPath, config);
    },
    remove(configPath) {
      if (!fs.existsSync(configPath)) return false;
      const config = readJson(configPath);
      const servers = config[spec.key] as Record<string, unknown> | undefined;
      if (!servers?.[MCP_SERVER_KEY]) return false;
      delete servers[MCP_SERVER_KEY];
      writeJsonOrRemove(configPath, config);
      return true;
    },
    hasEntry(configPath) {
      if (!fs.existsSync(configPath)) return false;
      const servers = readJson(configPath)[spec.key] as Record<string, unknown> | undefined;
      return Boolean(servers?.[MCP_SERVER_KEY]);
    },
  };
}

// ── Claude permission helpers ──────────────────────────────────────────────────

function claudeSettingsPath(root: string, scope: AllowlistScope): string {
  return scope === "global"
    ? path.join(homedir(), ".claude", "settings.json")
    : path.join(root, ".claude", "settings.json");
}

export function addClaudePermission(root: string, scope: AllowlistScope): void {
  const p = claudeSettingsPath(root, scope);
  const config = readJson(p);
  const permissions = (config.permissions ?? {}) as Record<string, unknown>;
  const allow = (permissions.allow ?? []) as string[];
  if (!allow.includes(PERMISSION_RULE)) {
    allow.push(PERMISSION_RULE);
    permissions.allow = allow;
    config.permissions = permissions;
    writeJson(p, config);
  }
}

export function removeClaudePermission(root: string, scope: AllowlistScope): void {
  const p = claudeSettingsPath(root, scope);
  if (!fs.existsSync(p)) return;
  const config = readJson(p);
  const allow = (config.permissions as Record<string, unknown>)?.allow as string[] | undefined;
  if (!Array.isArray(allow)) return;
  const idx = allow.indexOf(PERMISSION_RULE);
  if (idx === -1) return;
  allow.splice(idx, 1);
  writeJsonOrRemove(p, config);
}

// ── Cursor ─────────────────────────────────────────────────────────────────────

const cursorAdapter: McpConfigAdapter = {
  ...makeJsonAdapter({
    name: "Cursor",
    key: "mcpServers",
    projectFile: (root) => path.join(root, ".cursor", "mcp.json"),
    globalFile: () => path.join(homedir(), ".cursor", "mcp.json"),
    detect: () =>
      dirExists(path.join(homedir(), ".cursor")) || dirExists(path.join(process.cwd(), ".cursor")),
  }),
  addAllowlist() {
    const p = path.join(homedir(), ".cursor", "permissions.json");
    const config = readJson(p);
    const list = (config.mcpAllowlist ?? []) as string[];
    if (!list.includes(CURSOR_ALLOWLIST_PATTERN)) {
      list.push(CURSOR_ALLOWLIST_PATTERN);
      config.mcpAllowlist = list;
      writeJson(p, config);
    }
  },
  removeAllowlist() {
    const p = path.join(homedir(), ".cursor", "permissions.json");
    if (!fs.existsSync(p)) return;
    const config = readJson(p);
    const list = config.mcpAllowlist as string[] | undefined;
    if (!Array.isArray(list)) return;
    const idx = list.indexOf(CURSOR_ALLOWLIST_PATTERN);
    if (idx === -1) return;
    list.splice(idx, 1);
    config.mcpAllowlist = list;
    writeJsonOrRemove(p, config);
  },
};

// ── Claude Code ────────────────────────────────────────────────────────────────

const claudeAdapter: McpConfigAdapter = {
  ...makeJsonAdapter({
    name: "Claude Code",
    key: "mcpServers",
    stdioType: true,
    projectFile: (root) => path.join(root, ".mcp.json"),
    globalFile: () => path.join(homedir(), ".claude.json"),
    detect: () =>
      fs.existsSync(path.join(process.cwd(), ".mcp.json")) ||
      fs.existsSync(path.join(homedir(), ".claude.json")) ||
      dirExists(path.join(process.cwd(), ".claude")) ||
      dirExists(path.join(homedir(), ".claude")),
  }),
  addAllowlist: addClaudePermission,
  removeAllowlist: removeClaudePermission,
};

// ── VS Code (project only; `servers` key) ──────────────────────────────────────

const vscodeAdapter: McpConfigAdapter = makeJsonAdapter({
  name: "VS Code",
  key: "servers",
  stdioType: true,
  projectFile: (root) => path.join(root, ".vscode", "mcp.json"),
  detect: () =>
    dirExists(path.join(process.cwd(), ".vscode")) || dirExists(path.join(homedir(), ".vscode")),
});

// ── Windsurf (global only) ──────────────────────────────────────────────────────

const windsurfAdapter: McpConfigAdapter = {
  ...makeJsonAdapter({
    name: "Windsurf",
    key: "mcpServers",
    globalFile: () => path.join(homedir(), ".codeium", "windsurf", "mcp_config.json"),
    detect: () => dirExists(path.join(homedir(), ".codeium", "windsurf")),
  }),
  addAllowlist() {
    const p = path.join(homedir(), ".codeium", "windsurf", "mcp_config.json");
    const config = readJson(p);
    const servers = (config.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
    const entry = servers[MCP_SERVER_KEY];
    if (!entry) return;
    entry.alwaysAllow = ["*"];
    writeJson(p, config);
  },
  removeAllowlist() {
    const p = path.join(homedir(), ".codeium", "windsurf", "mcp_config.json");
    if (!fs.existsSync(p)) return;
    const config = readJson(p);
    const entry = (config.mcpServers as Record<string, Record<string, unknown>>)?.[MCP_SERVER_KEY];
    if (!entry?.alwaysAllow) return;
    delete entry.alwaysAllow;
    writeJsonOrRemove(p, config);
  },
};

// ── Gemini CLI ──────────────────────────────────────────────────────────────────

const geminiAdapter: McpConfigAdapter = {
  ...makeJsonAdapter({
    name: "Gemini",
    key: "mcpServers",
    projectFile: (root) => path.join(root, ".gemini", "settings.json"),
    globalFile: () => path.join(homedir(), ".gemini", "settings.json"),
    detect: () =>
      dirExists(path.join(homedir(), ".gemini")) || dirExists(path.join(process.cwd(), ".gemini")),
  }),
  addAllowlist(root, scope) {
    const p = scope === "global" ? this.globalPath() : this.projectPath(root);
    if (!p) return;
    const config = readJson(p);
    const entry = (config.mcpServers as Record<string, Record<string, unknown>>)?.[MCP_SERVER_KEY];
    if (!entry) return;
    entry.trust = true;
    writeJson(p, config);
  },
  removeAllowlist(root, scope) {
    const p = scope === "global" ? this.globalPath() : this.projectPath(root);
    if (!p || !fs.existsSync(p)) return;
    const config = readJson(p);
    const entry = (config.mcpServers as Record<string, Record<string, unknown>>)?.[MCP_SERVER_KEY];
    if (!entry?.trust) return;
    delete entry.trust;
    writeJsonOrRemove(p, config);
  },
};

// ── Zed (JSONC; context_servers) ────────────────────────────────────────────────

const zedAdapter: McpConfigAdapter = {
  name: "Zed",
  detect: () => dirExists(path.join(homedir(), ".config", "zed")),
  projectPath: (root) => path.join(root, ".zed", "settings.json"),
  globalPath: () => path.join(homedir(), ".config", "zed", "settings.json"),
  write(configPath, entry) {
    editJsoncFile(configPath, ["context_servers", MCP_SERVER_KEY], {
      source: "custom",
      command: entry.command,
      args: entry.args,
      ...(hasEnv(entry) ? { env: entry.env } : {}),
    });
  },
  remove(configPath) {
    if (!fs.existsSync(configPath)) return false;
    const servers = readJsonc(configPath).context_servers as Record<string, unknown> | undefined;
    if (!servers?.[MCP_SERVER_KEY]) return false;
    editJsoncFile(configPath, ["context_servers", MCP_SERVER_KEY], undefined);
    return true;
  },
  hasEntry(configPath) {
    if (!fs.existsSync(configPath)) return false;
    const servers = readJsonc(configPath).context_servers as Record<string, unknown> | undefined;
    return Boolean(servers?.[MCP_SERVER_KEY]);
  },
  addAllowlist(root, scope) {
    const p =
      scope === "global"
        ? path.join(homedir(), ".config", "zed", "settings.json")
        : path.join(root, ".zed", "settings.json");
    editJsoncFile(p, ["agent", "tool_permissions", "default"], "allow");
  },
  removeAllowlist(root, scope) {
    const p =
      scope === "global"
        ? path.join(homedir(), ".config", "zed", "settings.json")
        : path.join(root, ".zed", "settings.json");
    if (!fs.existsSync(p)) return;
    const perms = (readJsonc(p).agent as Record<string, unknown>)?.tool_permissions as
      | Record<string, unknown>
      | undefined;
    if (perms?.default !== "allow") return;
    editJsoncFile(p, ["agent", "tool_permissions", "default"], "confirm");
  },
};

// ── opencode (JSONC; mcp) ────────────────────────────────────────────────────────

const OPENCODE_ALLOWLIST_PATTERN = `${MCP_SERVER_KEY}*`;

function hasOpencodeBinary(): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", ["opencode"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

const opencodeAdapter: McpConfigAdapter = {
  name: "opencode",
  detect: hasOpencodeBinary,
  projectPath: (root) => path.join(root, "opencode.json"),
  globalPath: () => path.join(homedir(), ".config", "opencode", "opencode.json"),
  write(configPath, entry) {
    editJsoncFile(configPath, ["mcp", MCP_SERVER_KEY], {
      type: "local",
      command: [entry.command, ...entry.args],
      enabled: true,
      ...(hasEnv(entry) ? { environment: entry.env } : {}),
    });
  },
  remove(configPath) {
    if (!fs.existsSync(configPath)) return false;
    const servers = readJsonc(configPath).mcp as Record<string, unknown> | undefined;
    if (!servers?.[MCP_SERVER_KEY]) return false;
    editJsoncFile(configPath, ["mcp", MCP_SERVER_KEY], undefined);
    return true;
  },
  hasEntry(configPath) {
    if (!fs.existsSync(configPath)) return false;
    const servers = readJsonc(configPath).mcp as Record<string, unknown> | undefined;
    return Boolean(servers?.[MCP_SERVER_KEY]);
  },
  addAllowlist(root, scope) {
    const p = scope === "global" ? this.globalPath() : this.projectPath(root);
    if (!p) return;
    editJsoncFile(p, ["tools", OPENCODE_ALLOWLIST_PATTERN], true);
  },
  removeAllowlist(root, scope) {
    const p = scope === "global" ? this.globalPath() : this.projectPath(root);
    if (!p || !fs.existsSync(p)) return;
    const tools = readJsonc(p).tools as Record<string, unknown> | undefined;
    if (!tools || !(OPENCODE_ALLOWLIST_PATTERN in tools)) return;
    editJsoncFile(p, ["tools", OPENCODE_ALLOWLIST_PATTERN], undefined);
  },
};

// ── Codex (TOML; mcp_servers) ────────────────────────────────────────────────────

const codexAdapter: McpConfigAdapter = {
  name: "Codex",
  detect: () =>
    dirExists(path.join(homedir(), ".codex")) || dirExists(path.join(process.cwd(), ".codex")),
  projectPath: (root) => path.join(root, ".codex", "config.toml"),
  globalPath: () => path.join(homedir(), ".codex", "config.toml"),
  write(configPath, entry) {
    const config = readToml(configPath);
    const servers = (config.mcp_servers ?? {}) as Record<string, unknown>;
    servers[MCP_SERVER_KEY] = {
      command: entry.command,
      args: entry.args,
      ...(hasEnv(entry) ? { env: entry.env } : {}),
    };
    config.mcp_servers = servers;
    writeToml(configPath, config);
  },
  remove(configPath) {
    if (!fs.existsSync(configPath)) return false;
    const config = readToml(configPath);
    const servers = config.mcp_servers as Record<string, unknown> | undefined;
    if (!servers?.[MCP_SERVER_KEY]) return false;
    delete servers[MCP_SERVER_KEY];
    writeTomlOrRemove(configPath, config);
    return true;
  },
  hasEntry(configPath) {
    if (!fs.existsSync(configPath)) return false;
    const servers = readToml(configPath).mcp_servers as Record<string, unknown> | undefined;
    return Boolean(servers?.[MCP_SERVER_KEY]);
  },
};

// ── Hermes (YAML; mcp_servers) ───────────────────────────────────────────────────

const hermesAdapter: McpConfigAdapter = {
  name: "Hermes",
  detect: () => dirExists(path.join(homedir(), ".hermes")),
  projectPath: () => null,
  globalPath: () => path.join(homedir(), ".hermes", "config.yaml"),
  write(configPath, entry) {
    const doc = readYaml(configPath);
    const existing = doc.get("mcp_servers");
    if (existing != null && !isMap(existing)) {
      throw new Error(`mcp_servers in ${configPath} is not a YAML mapping`);
    }
    if (existing == null) doc.delete("mcp_servers");
    doc.setIn(["mcp_servers", MCP_SERVER_KEY], {
      command: entry.command,
      args: entry.args,
      ...(hasEnv(entry) ? { env: entry.env } : {}),
    });
    writeYaml(configPath, doc);
  },
  remove(configPath) {
    if (!fs.existsSync(configPath)) return false;
    const doc = readYaml(configPath);
    const servers = doc.get("mcp_servers");
    if (!isMap(servers) || !servers.has(MCP_SERVER_KEY)) return false;
    servers.delete(MCP_SERVER_KEY);
    if (servers.items.length === 0) doc.delete("mcp_servers");
    writeYaml(configPath, doc);
    return true;
  },
  hasEntry(configPath) {
    if (!fs.existsSync(configPath)) return false;
    const servers = readYaml(configPath).get("mcp_servers");
    return isMap(servers) && servers.has(MCP_SERVER_KEY);
  },
};

// ── Registry ─────────────────────────────────────────────────────────────────────

export const ALL_ADAPTERS: McpConfigAdapter[] = [
  cursorAdapter,
  claudeAdapter,
  vscodeAdapter,
  windsurfAdapter,
  geminiAdapter,
  zedAdapter,
  opencodeAdapter,
  codexAdapter,
  hermesAdapter,
];

export function detectAdapters(): McpConfigAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.detect());
}

export function getAdapterByName(name: string): McpConfigAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.name.toLowerCase() === name.toLowerCase());
}

export type AdapterConfigScope = "project" | "global";

export interface ConfiguredAdapterScope {
  adapter: McpConfigAdapter;
  scope: AdapterConfigScope;
  configPath: string;
}

/** Where our server is already configured — used by `remove` to target real entries. */
export function findConfiguredAdapterScopes(
  adapters: readonly McpConfigAdapter[],
  projectRoot: string,
): ConfiguredAdapterScope[] {
  const results: ConfiguredAdapterScope[] = [];
  const has = (a: McpConfigAdapter, p: string): boolean => {
    try {
      return a.hasEntry(p);
    } catch {
      return false;
    }
  };
  for (const adapter of adapters) {
    const projectPath = adapter.projectPath(projectRoot);
    if (projectPath && has(adapter, projectPath)) {
      results.push({ adapter, scope: "project", configPath: projectPath });
    }
    const globalPath = adapter.globalPath();
    if (globalPath && has(adapter, globalPath)) {
      results.push({ adapter, scope: "global", configPath: globalPath });
    }
  }
  return results;
}

// ── Editor-native skills placement ───────────────────────────────────────────────
// Skills go where each editor actually discovers them, not a tool-private dir.

export interface SkillTarget {
  editor: string;
  dir: string;
}

/** The skills directories to populate for the selected editors + scope. */
export function getSkillTargets(
  adapters: readonly McpConfigAdapter[],
  root: string,
  scope: AllowlistScope,
): SkillTarget[] {
  const base = scope === "global" ? homedir() : root;
  const targets: SkillTarget[] = [
    // Universal location some agents read.
    { editor: "agents", dir: path.join(base, ".agents", "skills") },
  ];
  for (const adapter of adapters) {
    switch (adapter.name) {
      case "Claude Code":
        targets.push({
          editor: adapter.name,
          dir: path.join(scope === "global" ? homedir() : root, ".claude", "skills"),
        });
        break;
      case "Cursor":
        targets.push({ editor: adapter.name, dir: path.join(base, ".cursor", "skills") });
        break;
      case "opencode":
        targets.push({
          editor: adapter.name,
          dir:
            scope === "global"
              ? path.join(homedir(), ".config", "opencode", "skills")
              : path.join(root, ".opencode", "skills"),
        });
        break;
    }
  }
  return targets;
}
