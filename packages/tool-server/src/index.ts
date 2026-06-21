// The long-running local daemon. Owns the Registry and every live Service
// (including the BrowserSession). Outlives any single editor connection.
//
// Step 1 wires the Registry + tools. The HTTP shell (listen on a local port with
// a bearer token; expose GET /tools + POST /tools/<name>) lands in the next step.

import { Registry, type RegistryOptions } from "@ramisalem/registry";
import { registerCoreTools } from "./tools/index.js";

export { browserSessionBlueprint } from "./blueprints/browser-session.js";
export type {
  BrowserSession,
  BrowserSessionInput,
  DescribedElement,
  PageState,
  Screenshot,
} from "./blueprints/browser-session.js";
export { coreTools, registerCoreTools } from "./tools/index.js";

/** Build a Registry with this slice's tools registered. */
export function createToolRegistry(options: RegistryOptions = {}): Registry {
  const registry = new Registry(options);
  registerCoreTools(registry);
  return registry;
}

export async function startToolServer(): Promise<void> {
  // TODO: HTTP shell — listen with bearer auth, expose GET /tools + POST /tools/<name>.
}
