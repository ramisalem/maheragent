// Tool registrations. Each Tool is a named, agent-callable operation with a typed
// input schema; it declares the Services it needs and the Registry resolves them.
//
//   perception:   navigate, describe, screenshot
//   interaction:  click, type, hover, scroll, press-key
//   conformance:  extract-styles   (read-only grounding tool; the verdict lives in the skill)
//   diagnostics:  get-console-logs, get-network-log
//
// Later: performance (Lighthouse / CDP trace).

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

const click = defineTool({
  name: "click",
  description:
    "Click an element by its Element Ref, or fall back to viewport coordinates (x, y).",
  input: z
    .object({
      ref: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      session: sessionArg,
    })
    .refine((v) => (v.ref != null) !== (v.x != null && v.y != null), {
      message: "Provide either `ref`, or both `x` and `y` — not both, not neither.",
    }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.click(args.ref != null ? { ref: args.ref } : { x: args.x!, y: args.y! });
    return { ok: true };
  },
});

const type = defineTool({
  name: "type",
  description: "Type text into a field by Element Ref (replacing its contents by default).",
  input: z.object({
    ref: z.string(),
    text: z.string(),
    clear: z.boolean().default(true),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.type(args.ref, args.text, { clear: args.clear });
    return { ok: true };
  },
});

const hover = defineTool({
  name: "hover",
  description: "Hover the pointer over an element by Element Ref.",
  input: z.object({ ref: z.string(), session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.hover(args.ref);
    return { ok: true };
  },
});

const scroll = defineTool({
  name: "scroll",
  description:
    "Scroll an element into view by Element Ref, or scroll the page by (dx, dy) pixels.",
  input: z.object({
    ref: z.string().optional(),
    dx: z.number().default(0),
    dy: z.number().default(0),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.scroll({ ref: args.ref, dx: args.dx, dy: args.dy });
    return { ok: true };
  },
});

const pressKey = defineTool({
  name: "press-key",
  description: 'Press a key (e.g. "Enter", "Escape", "Tab", "ArrowDown").',
  input: z.object({ key: z.string(), session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.pressKey(args.key);
    return { ok: true };
  },
});

const extractStyles = defineTool({
  name: "extract-styles",
  description:
    "Read the computed styles of an element by Element Ref — the grounding evidence for a Conformance Check.",
  input: z.object({ ref: z.string(), session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) => browser.extractStyles(args.ref),
});

const getConsoleLogs = defineTool({
  name: "get-console-logs",
  description:
    "Return console messages and uncaught page errors captured since the session started. Optionally filter by level (e.g. \"error\") and clear the buffer.",
  input: z.object({
    level: z.string().optional(),
    clear: z.boolean().optional(),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) =>
    browser.getConsoleLogs({ level: args.level, clear: args.clear }),
});

const getNetworkLog = defineTool({
  name: "get-network-log",
  description:
    "Return network responses and failed requests captured since the session started. Optionally clear the buffer.",
  input: z.object({ clear: z.boolean().optional(), session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) => browser.getNetworkLog({ clear: args.clear }),
});

/** Every tool the tool-server exposes. */
export const coreTools: AnyToolDefinition[] = [
  navigate,
  describe,
  screenshot,
  click,
  type,
  hover,
  scroll,
  pressKey,
  extractStyles,
  getConsoleLogs,
  getNetworkLog,
];

/** Register all tools on a Registry. */
export function registerCoreTools(registry: Registry): void {
  registry.registerTools(coreTools);
}
