// HTTP client for the tool-server. The MCP adapter never touches the Registry
// or the browser directly — it speaks to the daemon over loopback HTTP, which
// lets the daemon (and its BrowserSession) outlive any single editor connection.

/** A tool as advertised by the tool-server's `GET /tools`. */
export interface RemoteTool {
  name: string;
  description: string;
  enabled: boolean;
  /** JSON Schema (draft-7) for the tool's arguments. */
  inputSchema: Record<string, unknown>;
}

/** Thrown when the tool-server answers a tool call with a non-2xx status. */
export class ToolCallError extends Error {
  constructor(
    readonly status: number,
    /** Machine-readable error code from the tool-server envelope, if any. */
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ToolCallError";
  }
}

/** Thin, typed wrapper over the tool-server's HTTP face. */
export class ToolServerClient {
  readonly #url: string;
  readonly #token: string;

  constructor(url: string, token: string) {
    this.#url = url.replace(/\/$/, "");
    this.#token = token;
  }

  #headers(extra?: Record<string, string>): Record<string, string> {
    return { authorization: `Bearer ${this.#token}`, ...extra };
  }

  /** Fetch the tool catalog the daemon currently exposes. */
  async listTools(): Promise<RemoteTool[]> {
    const res = await fetch(`${this.#url}/tools`, { headers: this.#headers() });
    if (!res.ok) {
      throw new ToolCallError(res.status, undefined, `GET /tools failed (${res.status})`);
    }
    const body = (await res.json()) as { tools?: RemoteTool[] };
    return body.tools ?? [];
  }

  /**
   * Invoke a tool by name and return its raw result.
   * @throws {ToolCallError} when the daemon reports the call failed.
   */
  async callTool(name: string, args: unknown): Promise<unknown> {
    const res = await fetch(`${this.#url}/tools/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: this.#headers({ "content-type": "application/json" }),
      body: JSON.stringify(args ?? {}),
    });
    const body = (await res.json().catch(() => ({}))) as {
      result?: unknown;
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      throw new ToolCallError(
        res.status,
        body.error,
        body.message ?? `POST /tools/${name} failed (${res.status})`,
      );
    }
    return body.result;
  }

  /** Probe whether the daemon is alive and answering (used by discovery). */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.#url}/tools`, { headers: this.#headers() });
      return res.ok;
    } catch {
      return false;
    }
  }
}
