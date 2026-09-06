// The long-running local daemon. Owns the Registry and every live Service
// (including the BrowserSession), and exposes them over HTTP. Outlives any single
// editor connection so the browser and its state persist across reconnects.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { defineTool, Registry, type RegistryOptions } from "@ramisalem/registry";
import { createHttpServer } from "./http.js";
import { registerCoreTools } from "./tools/index.js";

export { browserSessionBlueprint, StaleRefError } from "./blueprints/browser-session.js";
export type {
  BoundingBox,
  BrowserSession,
  BrowserSessionInput,
  ClickTarget,
  ComputedStyles,
  ConsoleEntry,
  CookieOp,
  DescribedElement,
  DescribeOptions,
  DragOptions,
  FindOptions,
  NetworkEntry,
  PageState,
  PageView,
  PerformanceReport,
  Screenshot,
  SettleOptions,
  SettleResult,
  StorageOp,
  TabInfo,
  TabOp,
  ViewportOptions,
  ViewportState,
  WaitForOptions,
  WaitForResult,
} from "./blueprints/browser-session.js";
export {
  compareStyles,
  type ConformanceResult,
  type StyleComparison,
  type CompareOptions,
} from "./conformance.js";
export {
  hasSecretPlaceholder,
  listSecrets,
  loadSecrets,
  resolveSecrets,
  type SecretListing,
  type SecretLookup,
  type SecretOptions,
} from "./secrets.js";
export { coreTools, registerCoreTools, AUTO_DESCRIBE_FLAG } from "./tools/index.js";
export { createHttpServer } from "./http.js";
export {
  clearDaemonInfo,
  daemonHome,
  daemonInfoPath,
  readDaemonInfo,
  writeDaemonInfo,
  type DaemonHandshake,
} from "./daemon.js";

const SESSION_URN_PREFIX = "BrowserSession:";

/**
 * The one tool that needs the Registry itself: listing and closing live
 * Browser Sessions. Every session name passed to another tool spawns a full
 * Chromium that would otherwise live until the daemon stops.
 */
function sessionsTool(registry: Registry) {
  const live = (): string[] =>
    registry
      .liveUrns()
      .filter((urn) => urn.startsWith(SESSION_URN_PREFIX))
      .map((urn) => urn.slice(SESSION_URN_PREFIX.length));
  return defineTool({
    name: "sessions",
    description:
      'List the live Browser Sessions, or `close` one to free its browser. Every other tool takes an optional `session` name (default "default") and lazily starts a browser for it; a session persists until closed here or until the daemon stops.',
    input: z.object({
      action: z.enum(["list", "close"]).default("list"),
      session: z.string().optional(),
    }),
    execute: async (args) => {
      if (args.action === "close") {
        const name = args.session ?? "default";
        if (!live().includes(name)) {
          return { ok: false as const, error: "no_such_session", sessions: live() };
        }
        await registry.evict(`${SESSION_URN_PREFIX}${name}`);
        return { ok: true as const, closed: name, sessions: live() };
      }
      return { sessions: live() };
    },
  });
}

/** Build a Registry with every tool registered. */
export function createToolRegistry(options: RegistryOptions = {}): Registry {
  const registry = new Registry(options);
  registerCoreTools(registry);
  registry.registerTool(sessionsTool(registry));
  return registry;
}

export interface ToolServerOptions extends RegistryOptions {
  /** Port to bind; 0 (default) lets the OS pick a free one. */
  port?: number;
  /** Host to bind; defaults to loopback only. */
  host?: string;
  /** Bearer token clients must present; generated if omitted. */
  token?: string;
  /** Provide a pre-built registry instead of the default one. */
  registry?: Registry;
}

/** A running tool-server: where to reach it, how to authenticate, and how to stop it. */
export interface ToolServerHandle {
  url: string;
  port: number;
  token: string;
  /** Stop the HTTP server and dispose every live Service. */
  close(): Promise<void>;
}

/** Start the tool-server: build the registry, then listen with bearer auth. */
export async function startToolServer(
  options: ToolServerOptions = {},
): Promise<ToolServerHandle> {
  const { port = 0, host = "127.0.0.1", token = randomBytes(32).toString("hex"), registry: provided, ...registryOptions } = options;
  const registry = provided ?? createToolRegistry(registryOptions);
  const server = createHttpServer(registry, token);

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://${host}:${boundPort}`,
    port: boundPort,
    token,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }).then(() => registry.disposeAll()),
  };
}
