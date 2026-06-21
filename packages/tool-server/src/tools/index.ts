// Tool registrations. Each Tool is a named, agent-callable operation with a typed
// input schema; it declares the Services it needs and the Registry resolves them.
//
// Step 1 (this slice): the BrowserSession lifecycle + perception.
//   navigate, describe, screenshot
// Later: interaction (click/type/scroll/...), diagnostics, performance, extract-styles.

import { z } from "zod";
import {
  defineTool,
  ref,
  type AnyToolDefinition,
  type Registry,
} from "@ramisalem/registry";
import { browserSessionBlueprint } from "../blueprints/browser-session.js";

/** Shared arg: which Browser Session to act on (defaults to a single session). */
const sessionArg = z.string().optional();

/** Resolve the BrowserSession dependency for a tool call. */
const browserOf = (session?: string) => ({
  browser: ref(browserSessionBlueprint, { sessionId: session ?? "default" }),
});

const navigate = defineTool({
  name: "navigate",
  description: "Navigate the browser to a URL and return the resulting page state.",
  input: z.object({ url: z.string().url(), session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) => browser.navigate(args.url),
});

const describe = defineTool({
  name: "describe",
  description:
    "List the interactable elements on the current page, each with a stable Element Ref to target.",
  input: z.object({ session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: (_args, { browser }) => browser.describe(),
});

const screenshot = defineTool({
  name: "screenshot",
  description: "Capture a PNG screenshot of the current page (base64-encoded).",
  input: z.object({ fullPage: z.boolean().default(false), session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) => browser.screenshot({ fullPage: args.fullPage }),
});

/** Every tool in this slice. */
export const coreTools: AnyToolDefinition[] = [navigate, describe, screenshot];

/** Register this slice's tools on a Registry. */
export function registerCoreTools(registry: Registry): void {
  registry.registerTools(coreTools);
}
