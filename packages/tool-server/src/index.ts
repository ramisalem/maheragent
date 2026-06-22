// The long-running local daemon. Owns the Registry and every live Service
// (including the BrowserSession), and exposes them over HTTP. Outlives any single
// editor connection so the browser and its state persist across reconnects.

import { randomBytes } from "node:crypto";
import { Registry, type RegistryOptions } from "@ramisalem/registry";
import { createHttpServer } from "./http.js";
import { registerCoreTools } from "./tools/index.js";

export { browserSessionBlueprint } from "./blueprints/browser-session.js";
export type {
  BoundingBox,
  BrowserSession,
  BrowserSessionInput,
  ClickTarget,
  ComputedStyles,
  DescribedElement,
  PageState,
  Screenshot,
} from "./blueprints/browser-session.js";
export {
  compareStyles,
  type ConformanceResult,
  type StyleComparison,
  type CompareOptions,
} from "./conformance.js";
export { coreTools, registerCoreTools } from "./tools/index.js";
export { createHttpServer } from "./http.js";
export {
  clearDaemonInfo,
  daemonHome,
  daemonInfoPath,
  readDaemonInfo,
  writeDaemonInfo,
  type DaemonHandshake,
} from "./daemon.js";

/** Build a Registry with every tool registered. */
export function createToolRegistry(options: RegistryOptions = {}): Registry {
  const registry = new Registry(options);
  registerCoreTools(registry);
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
