// Tool registrations. Each Tool is a named, agent-callable operation with a typed
// input schema; it declares the Services it needs and the Registry resolves them.
//
//   perception:   navigate, describe, screenshot
//   interaction:  click, type, hover, scroll, press-key
//   conformance:  extract-styles, compare-styles   (grounding + deterministic diff)
//   diagnostics:  get-console-logs, get-network-log
//   performance:  profile-performance   (Core Web Vitals via in-page APIs)

import { z } from "zod";
import {
  defineTool,
  ref,
  type AnyToolDefinition,
  type Registry,
} from "@ramisalem/registry";
import { browserSessionBlueprint } from "../blueprints/browser-session.js";
import { compareStyles } from "../conformance.js";

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
  description:
    "Capture a PNG of the current page. Returns base64 by default, or pass `path` to write the PNG to disk and return the path (cheaper for the agent than decoding base64).",
  input: z.object({
    fullPage: z.boolean().default(false),
    path: z.string().optional(),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) => browser.screenshot({ fullPage: args.fullPage, path: args.path }),
});

const click = defineTool({
  name: "click",
  description:
    'Click an element by its Element Ref, or fall back to viewport coordinates (x, y). If a click visibly focuses the element but its handler never fires (typical inside virtualized data grids, whose cells re-render between mousedown and mouseup), retry with `mode: "js"` — it dispatches el.click() programmatically and is immune to that race. Signature of the race: the element gains a focus ring, yet nothing navigates/opens.',
  input: z
    .object({
      ref: z.string().optional(),
      mode: z.enum(["native", "js"]).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      session: sessionArg,
    })
    .refine((v) => (v.ref != null) !== (v.x != null && v.y != null), {
      message: "Provide either `ref`, or both `x` and `y` — not both, not neither.",
    })
    .refine((v) => v.mode == null || v.ref != null, {
      message: "`mode` only applies to ref clicks.",
    }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.click(
      args.ref != null ? { ref: args.ref, mode: args.mode } : { x: args.x!, y: args.y! },
    );
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
    "Read the computed styles of an element by Element Ref — the grounding evidence for a Conformance Check. Returns a curated set (colors, typography, box, per-side borders); pass `properties` to add any other CSS property, e.g. [\"outlineColor\", \"gap\", \"--brand\"]. Names may be camelCase or CSS spelling.",
  input: z.object({
    ref: z.string(),
    properties: z.array(z.string()).optional(),
    closest: z.string().optional(),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) =>
    browser.extractStyles(args.ref, {
      properties: args.properties,
      closest: args.closest,
    }),
});

const compareStylesTool = defineTool({
  name: "compare-styles",
  description:
    "Compare an element's computed styles against expected design values (e.g. Figma variables). Normalizes units (hex<->rgb, px, font-weight names<->numbers) and returns a per-property pass/fail conformance report — the deterministic core of a Conformance Check. Every property in `expected` is measured, whatever it is. If a result looks wrong (0px borders, inherited colors), the Ref is probably an inner ARIA node rather than the styled wrapper — re-run with `closest`, e.g. \".MuiTabs-root\".",
  input: z.object({
    ref: z.string(),
    expected: z.record(z.string()),
    closest: z.string().optional(),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    // Measure exactly what the caller asserts. Without this, a property outside
    // the curated set read as absent and was reported as a mismatch — a false
    // failure indistinguishable from a real design regression.
    const actual = await browser.extractStyles(args.ref, {
      properties: Object.keys(args.expected),
      closest: args.closest,
    });
    if (actual == null) {
      return { ref: args.ref, conforms: false, error: "stale_ref", comparisons: [] };
    }
    return { ref: args.ref, ...compareStyles(args.expected, actual) };
  },
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

const profilePerformance = defineTool({
  name: "profile-performance",
  description:
    "Profile the current page's performance — Core Web Vitals (LCP, CLS, FCP), estimated Total Blocking Time, navigation timing, and a resource summary. Navigate to the page first; metrics come from the loaded document's buffered performance entries.",
  input: z.object({
    settleMs: z.number().int().min(0).max(10000).optional(),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) => browser.profilePerformance({ settleMs: args.settleMs }),
});

const getNetworkLog = defineTool({
  name: "get-network-log",
  description:
    'Return network responses and failed requests captured since the session started. A full page load is mostly static assets, so FILTER: `urlPattern` keeps only URLs containing a substring (case-insensitive), `minStatus` keeps only statuses >= it plus every failed request — `{minStatus: 400}` gives just the errors. Entries with status >= 400 carry `errorBody`, the response body (truncated), which is what tells you why a request failed. Optionally clear the buffer.',
  input: z.object({
    urlPattern: z.string().optional(),
    minStatus: z.number().int().min(100).max(599).optional(),
    clear: z.boolean().optional(),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) =>
    browser.getNetworkLog({
      urlPattern: args.urlPattern,
      minStatus: args.minStatus,
      clear: args.clear,
    }),
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
  compareStylesTool,
  getConsoleLogs,
  getNetworkLog,
  profilePerformance,
];

/** Register all tools on a Registry. */
export function registerCoreTools(registry: Registry): void {
  registry.registerTools(coreTools);
}
