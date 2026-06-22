// The MCP server. Speaks MCP to the editor and forwards every ListTools /
// CallTool to the tool-server over HTTP. Tools are discovered at runtime from
// the daemon's catalog, so this layer is a generic bridge — it knows nothing
// about specific tools, only how to relay them.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolCallError, type ToolServerClient } from "./client.js";

export interface McpServerInfo {
  name: string;
  version: string;
}

/**
 * Build an MCP server that bridges to the tool-server. Each ListTools request
 * re-reads the daemon's catalog, so tools enabled/disabled at runtime stay in
 * sync without restarting the editor.
 */
export function createMcpServer(client: ToolServerClient, info: McpServerInfo): Server {
  const server = new Server(info, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await client.listTools();
    return {
      tools: tools
        .filter((t) => t.enabled)
        .map<Tool>((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: (t.inputSchema as Tool["inputSchema"]) ?? { type: "object" },
        })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const { name, arguments: args } = req.params;
    try {
      const result = await client.callTool(name, args ?? {});
      return { content: [{ type: "text", text: stringify(result) }] };
    } catch (err) {
      // Surface tool failures to the model as an error result, not a transport
      // fault — the agent should see what went wrong and adapt.
      const message =
        err instanceof ToolCallError
          ? `${err.code ?? "tool_failed"}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  });

  return server;
}

/** Connect a built MCP server to stdio (how editors launch and talk to it). */
export async function connectStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function stringify(value: unknown): string {
  if (value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
