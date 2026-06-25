// MCP adapter. Speaks MCP to the editor over stdio; forwards every tool call to
// the tool-server daemon over HTTP, spawning the daemon if it isn't running.

import { ensureToolServer } from "./daemon.js";
import { connectStdio, createMcpServer, type McpServerInfo } from "./server.js";

export { ToolServerClient, ToolCallError, type RemoteTool } from "./client.js";
export { ensureToolServer, spawnDaemon } from "./daemon.js";
export { createMcpServer, connectStdio, type McpServerInfo } from "./server.js";

const DEFAULT_INFO: McpServerInfo = { name: "maheragent", version: "0.1.1" };

/**
 * Start the MCP adapter: ensure a daemon is up, then serve MCP over stdio.
 * Returns once the stdio transport is connected (the process then stays alive
 * handling requests until the editor closes the stream).
 */
export async function startMcp(info: McpServerInfo = DEFAULT_INFO): Promise<void> {
  const client = await ensureToolServer();
  const server = createMcpServer(client, info);
  await connectStdio(server);
}
