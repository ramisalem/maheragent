// The tool-server's HTTP face. A tiny Node-http router over a Registry:
//   GET  /tools            -> the tool catalog (name, description, enabled, JSON Schema)
//   POST /tools/<name>     -> validate + run a tool, return its result
// Every request must carry `Authorization: Bearer <token>`.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  InvalidToolArgsError,
  ToolDisabledError,
  UnknownToolError,
  type Registry,
} from "@ramisalem/registry";

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw); // throws SyntaxError on malformed body
}

/** Map a thrown error to an HTTP status + payload. */
function errorResponse(err: unknown): { status: number; body: unknown } {
  if (err instanceof UnknownToolError) {
    return { status: 404, body: { error: "unknown_tool", message: err.message } };
  }
  if (err instanceof ToolDisabledError) {
    return { status: 403, body: { error: "tool_disabled", message: err.message } };
  }
  if (err instanceof InvalidToolArgsError) {
    const issues = (err.cause as { issues?: unknown })?.issues;
    return { status: 400, body: { error: "invalid_args", message: err.message, issues } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: "tool_failed", message } };
}

/**
 * Build (but don't start) the tool-server's HTTP server.
 *
 * @param registry the registry the routes dispatch to
 * @param token    the bearer token every request must present
 */
export function createHttpServer(registry: Registry, token: string): Server {
  return createServer((req, res) => {
    void handle(req, res, registry, token);
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  registry: Registry,
  token: string,
): Promise<void> {
  if (req.headers.authorization !== `Bearer ${token}`) {
    return send(res, 401, { error: "unauthorized" });
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/tools") {
    const tools = await registry.listTools();
    return send(res, 200, {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        enabled: t.enabled,
        inputSchema: zodToJsonSchema(t.input, { target: "jsonSchema7" }),
      })),
    });
  }

  const callMatch = req.method === "POST" && /^\/tools\/(.+)$/.exec(path);
  if (callMatch) {
    const name = decodeURIComponent(callMatch[1]);
    let args: unknown;
    try {
      args = await readJson(req);
    } catch {
      return send(res, 400, { error: "invalid_json", message: "Request body is not valid JSON." });
    }
    try {
      const result = await registry.execute(name, args);
      return send(res, 200, { result });
    } catch (err) {
      const { status, body } = errorResponse(err);
      return send(res, status, body);
    }
  }

  return send(res, 404, { error: "not_found" });
}
