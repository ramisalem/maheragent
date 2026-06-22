// Workspace install. `init` registers the MCP server in an editor's config and
// copies the bundled skills into the workspace; `remove` reverses both. Editors
// disagree on where MCP config lives and what the top-level key is, so that
// knowledge is captured in EDITORS and everything else is editor-agnostic.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** The name we register the server under, in every editor. */
export const SERVER_NAME = "maheragent";

export interface EditorTarget {
  /** Config file, relative to the workspace root. */
  file: string;
  /** Top-level object that holds servers in that editor's schema. */
  key: "mcpServers" | "servers";
}

/** Where each supported editor keeps its MCP server config. */
export const EDITORS: Record<string, EditorTarget> = {
  // Claude Code and the de-facto standard read `.mcp.json` / `mcpServers`.
  claude: { file: ".mcp.json", key: "mcpServers" },
  cursor: { file: ".cursor/mcp.json", key: "mcpServers" },
  vscode: { file: ".vscode/mcp.json", key: "servers" },
};

/** The server entry editors should launch: `node <abs path to the mcp bin>`. */
export function mcpServerEntry(): { command: string; args: string[] } {
  return { command: process.execPath, args: [require.resolve("@ramisalem/mcp/dist/bin.js")] };
}

/** Absolute path to the bundled skills directory. */
export function skillsSource(): string {
  return join(dirname(require.resolve("@ramisalem/skills/package.json")), "skills");
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Merge our server entry into an editor config file without clobbering others. */
export async function registerServer(configPath: string, key: EditorTarget["key"]): Promise<void> {
  const config = await readJson(configPath);
  const servers = (config[key] as Record<string, unknown>) ?? {};
  servers[SERVER_NAME] = mcpServerEntry();
  config[key] = servers;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

/** Remove our server entry, leaving any others (and the file) intact. */
export async function unregisterServer(configPath: string, key: EditorTarget["key"]): Promise<boolean> {
  const config = await readJson(configPath);
  const servers = config[key] as Record<string, unknown> | undefined;
  if (!servers || !(SERVER_NAME in servers)) return false;
  delete servers[SERVER_NAME];
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  return true;
}

/** Copy the bundled skills into <root>/.maheragent/skills. */
export async function copySkills(root: string): Promise<string> {
  const dest = join(root, ".maheragent", "skills");
  await mkdir(dirname(dest), { recursive: true });
  await cp(skillsSource(), dest, { recursive: true });
  return dest;
}

interface ParsedArgs {
  command: string;
  editor: string;
  root: string;
}

function parse(argv: string[]): ParsedArgs {
  const [command = "init", ...rest] = argv;
  let editor = "claude";
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--editor" && rest[i + 1]) editor = rest[++i];
  }
  return { command, editor, root: process.cwd() };
}

/** Entrypoint for `maheragent init|update|remove`. */
export async function runInstaller(argv: string[]): Promise<void> {
  const { command, editor, root } = parse(argv);
  const target = EDITORS[editor];
  if (!target) {
    console.error(`Unknown editor "${editor}". Supported: ${Object.keys(EDITORS).join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const configPath = join(root, target.file);

  if (command === "remove" || command === "uninstall") {
    const removed = await unregisterServer(configPath, target.key);
    await rm(join(root, ".maheragent", "skills"), { recursive: true, force: true });
    console.log(
      removed
        ? `Removed "${SERVER_NAME}" from ${target.file} and deleted copied skills.`
        : `"${SERVER_NAME}" was not registered in ${target.file}; removed copied skills if any.`,
    );
    return;
  }

  // init / install / update
  await registerServer(configPath, target.key);
  const skillsDest = await copySkills(root);
  console.log(`Registered "${SERVER_NAME}" in ${target.file} (${editor}).`);
  console.log(`Copied skills into ${skillsDest.replace(root + "/", "")}.`);
  console.log(`Restart ${editor} (or reload its MCP servers) to pick up the change.`);
}
