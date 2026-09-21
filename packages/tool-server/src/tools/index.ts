// Tool registrations. Each Tool is a named, agent-callable operation with a typed
// input schema; it declares the Services it needs and the Registry resolves them.
//
//   perception:   navigate, describe, find, wait-for, screenshot, set-viewport
//   interaction:  click, type, hover, scroll, drag, press-key, select-option, upload-file
//   conformance:  extract-styles, compare-styles, screenshot-diff
//   state:        evaluate, cookies, storage, tabs
//   diagnostics:  get-console-logs, get-network-log
//   performance:  profile-performance   (Core Web Vitals via in-page APIs)
//
// Every interaction returns the page *after* the action — url, title, and a
// fresh element list — so the agent's next step needs no separate `describe`.
// Pass `observe: false` (or enable the `disable-auto-describe` flag) to skip it.

import { z } from "zod";
import {
  defineTool,
  ref,
  type AnyToolDefinition,
  type Registry,
} from "@ramisalem/registry";
import { isFlagEnabled } from "@ramisalem/configuration-core";
import {
  browserSessionBlueprint,
  type BrowserSession,
  type PageView,
} from "../blueprints/browser-session.js";
import { compareStyles } from "../conformance.js";
import { resolveSecrets } from "../secrets.js";
import { screenshotDiff } from "../screenshot-diff.js";

/** Flag that turns off the element list appended to every action's result. */
export const AUTO_DESCRIBE_FLAG = "disable-auto-describe";

/** Shared arg: which Browser Session to act on (defaults to a single session). */
const sessionArg = z.string().optional();
/** Shared arg: whether to append the post-action page view (default true). */
const observeArg = z.boolean().optional();

const OBSERVE_NOTE =
  "Returns the page after the action: `url`, `title`, and the fresh `elements` list (plus `openedTabs` if the action opened a tab). Pass `observe: false` to skip that.";

/** Resolve the BrowserSession dependency for a tool call. */
const browserOf = (session?: string) => ({
  browser: ref(browserSessionBlueprint, { sessionId: session ?? "default" }),
});

/** An action result, with the post-action page view unless opted out. */
async function observed<T extends object>(
  browser: BrowserSession,
  observe: boolean | undefined,
  extra: T,
): Promise<{ ok: true } & T & Partial<PageView>> {
  const base = { ok: true as const, ...extra };
  if (observe === false || isFlagEnabled(AUTO_DESCRIBE_FLAG)) return base;
  return { ...base, ...(await browser.observe()) };
}

// ── Perception ──────────────────────────────────────────────────────────────

const navigate = defineTool({
  name: "navigate",
  description: `Navigate the browser to a URL. ${OBSERVE_NOTE}`,
  input: z.object({ url: z.string().url(), observe: observeArg, session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    const state = await browser.navigate(args.url);
    return observed(browser, args.observe, state);
  },
});

const describe = defineTool({
  name: "describe",
  description:
    "List the elements on the current page, each with a stable Element Ref (e1, e2, …) to target, a role, a name, and a viewport box. Interactables and headings by default; `content: true` adds paragraphs, list items, cells, labels, and images (what design conformance needs to measure). Pierces open shadow roots and same-origin iframes (`frame` names the iframe). Refs are renumbered on every describe, so re-describe after the page changes.",
  input: z.object({
    content: z.boolean().optional(),
    maxElements: z.number().int().min(1).max(10000).optional(),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) =>
    browser.describe({ content: args.content, maxElements: args.maxElements }),
});

const find = defineTool({
  name: "find",
  description:
    'Tag and return the elements matching a CSS `selector` and/or a case-insensitive `text` substring — the way to get a Ref for anything `describe` does not list (a paragraph, an image, a `.hero` card). Existing Refs stay valid; new ones continue the numbering. Text matches land on the deepest element that renders the text.',
  input: z
    .object({
      selector: z.string().optional(),
      text: z.string().optional(),
      maxElements: z.number().int().min(1).max(10000).optional(),
      session: sessionArg,
    })
    .refine((v) => v.selector != null || v.text != null, {
      message: "Provide `selector`, `text`, or both.",
    }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) =>
    browser.find({ selector: args.selector, text: args.text, maxElements: args.maxElements }),
});

const waitFor = defineTool({
  name: "wait-for",
  description: `Wait for an element (by \`ref\`, CSS \`selector\`, or visible \`text\`) to reach a \`state\` — visible (default), hidden, attached, detached — and/or for the page to go idle (\`idle: true\`: no DOM mutations for \`stableMs\`). Use this instead of polling with describe or screenshot. Element waits fail after \`timeoutMs\` (default 10000); an idle wait reports \`settled: false\` instead. ${OBSERVE_NOTE}`,
  input: z
    .object({
      ref: z.string().optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
      state: z.enum(["visible", "hidden", "attached", "detached"]).optional(),
      idle: z.boolean().optional(),
      stableMs: z.number().int().min(50).max(10000).optional(),
      timeoutMs: z.number().int().min(100).max(120000).optional(),
      observe: observeArg,
      session: sessionArg,
    })
    .refine((v) => v.ref != null || v.selector != null || v.text != null || v.idle === true, {
      message: "Provide `ref`, `selector`, or `text` to wait on, or `idle: true`.",
    }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    const result = await browser.waitFor(args);
    return observed(browser, args.observe, result);
  },
});

const screenshot = defineTool({
  name: "screenshot",
  description:
    "Capture a PNG of the current page, or of one element by `ref`. Returned as an image the model can look at, or pass `path` to write the PNG to disk and get the path back instead.",
  input: z.object({
    fullPage: z.boolean().default(false),
    ref: z.string().optional(),
    path: z.string().optional(),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) =>
    browser.screenshot({ fullPage: args.fullPage, path: args.path, ref: args.ref }),
});

const setViewport = defineTool({
  name: "set-viewport",
  description: `Resize the viewport (\`width\`/\`height\` in CSS px — match the Figma frame's width before a conformance check) and/or emulate \`colorScheme\` (light|dark) and \`reducedMotion\`. The session starts at 1280x720. ${OBSERVE_NOTE}`,
  input: z.object({
    width: z.number().int().min(100).max(10000).optional(),
    height: z.number().int().min(100).max(10000).optional(),
    colorScheme: z.enum(["light", "dark", "no-preference"]).optional(),
    reducedMotion: z.enum(["reduce", "no-preference"]).optional(),
    observe: observeArg,
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    const viewport = await browser.setViewport(args);
    return observed(browser, args.observe, { viewport });
  },
});

// ── Interaction ─────────────────────────────────────────────────────────────

const click = defineTool({
  name: "click",
  description: `Click an element by its Element Ref, or fall back to viewport coordinates (x, y). If a click visibly focuses the element but its handler never fires (typical inside virtualized data grids, whose cells re-render between mousedown and mouseup), retry with \`mode: "js"\` — it dispatches el.click() programmatically and is immune to that race. A Ref that is no longer on the page fails immediately with \`stale_ref\`: describe again. ${OBSERVE_NOTE}`,
  input: z
    .object({
      ref: z.string().optional(),
      mode: z.enum(["native", "js"]).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      observe: observeArg,
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
    return observed(browser, args.observe, {});
  },
});

const type = defineTool({
  name: "type",
  description: `Type text into a field by Element Ref, replacing its contents by default (\`clear: false\` appends); \`submit: true\` presses Enter afterwards. For credentials write \`{{secret:NAME}}\` — the daemon substitutes the value from MAHERAGENT_SECRET_NAME or a secrets.env file, so the plaintext never enters your context (and the post-action view is skipped for that call). ${OBSERVE_NOTE}`,
  input: z.object({
    ref: z.string(),
    text: z.string(),
    clear: z.boolean().default(true),
    submit: z.boolean().optional(),
    observe: observeArg,
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    const { text, used } = resolveSecrets(args.text);
    await browser.type(args.ref, text, { clear: args.clear, submit: args.submit });
    // Never echo a page state that could carry the resolved value back.
    if (used.length > 0) return { ok: true as const, secrets: used, observed: false };
    return observed(browser, args.observe, {});
  },
});

const hover = defineTool({
  name: "hover",
  description: `Hover the pointer over an element by Element Ref (opens hover menus and tooltips). ${OBSERVE_NOTE}`,
  input: z.object({ ref: z.string(), observe: observeArg, session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.hover(args.ref);
    return observed(browser, args.observe, {});
  },
});

const scroll = defineTool({
  name: "scroll",
  description: `Scroll: \`ref\` alone brings the element into view; \`ref\` with \`dx\`/\`dy\` scrolls *inside* that element (lists, panes); \`dx\`/\`dy\` alone scrolls the page by that many pixels. ${OBSERVE_NOTE}`,
  input: z.object({
    ref: z.string().optional(),
    dx: z.number().default(0),
    dy: z.number().default(0),
    observe: observeArg,
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.scroll({ ref: args.ref, dx: args.dx, dy: args.dy });
    return observed(browser, args.observe, {});
  },
});

const drag = defineTool({
  name: "drag",
  description: `Drag an element by Ref and drop it onto another element (\`toRef\`), or move it by \`dx\`/\`dy\` pixels from its center (sliders, reorderable lists). ${OBSERVE_NOTE}`,
  input: z
    .object({
      ref: z.string(),
      toRef: z.string().optional(),
      dx: z.number().optional(),
      dy: z.number().optional(),
      observe: observeArg,
      session: sessionArg,
    })
    .refine((v) => v.toRef != null || v.dx != null || v.dy != null, {
      message: "Provide `toRef`, or `dx`/`dy`.",
    }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.drag(args);
    return observed(browser, args.observe, {});
  },
});

const pressKey = defineTool({
  name: "press-key",
  description: `Press a key or chord, e.g. "Enter", "Escape", "Tab", "ArrowDown", "Control+a", "Shift+Tab". ${OBSERVE_NOTE}`,
  input: z.object({ key: z.string(), observe: observeArg, session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.pressKey(args.key);
    return observed(browser, args.observe, {});
  },
});

const selectOption = defineTool({
  name: "select-option",
  description: `Choose an option in a native <select> by Ref — by option \`value\`, visible \`label\`, or \`index\`. (Custom dropdowns are plain elements: click them.) ${OBSERVE_NOTE}`,
  input: z
    .object({
      ref: z.string(),
      value: z.string().optional(),
      label: z.string().optional(),
      index: z.number().int().min(0).optional(),
      observe: observeArg,
      session: sessionArg,
    })
    .refine((v) => v.value != null || v.label != null || v.index != null, {
      message: "Provide `value`, `label`, or `index`.",
    }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    const selected = await browser.selectOption(args.ref, args);
    return observed(browser, args.observe, { selected });
  },
});

const uploadFile = defineTool({
  name: "upload-file",
  description: `Attach local files to a file input by Ref (absolute \`paths\`). ${OBSERVE_NOTE}`,
  input: z.object({
    ref: z.string(),
    paths: z.array(z.string()).min(1),
    observe: observeArg,
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    await browser.uploadFile(args.ref, args.paths);
    return observed(browser, args.observe, {});
  },
});

// ── Conformance ─────────────────────────────────────────────────────────────

const extractStyles = defineTool({
  name: "extract-styles",
  description:
    "Read the computed styles of an element by Element Ref — the grounding evidence for a Conformance Check. Returns a curated set (colors, typography, box, per-side borders); pass `properties` to add any other CSS property, e.g. [\"outlineColor\", \"gap\", \"--brand\"]. Names may be camelCase or CSS spelling. Use `find` first to get a Ref for a paragraph, image, or container.",
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

const screenshotDiffTool = defineTool({
  name: "screenshot-diff",
  description:
    "Visual regression: compare a `baseline` PNG against the live page (default), one element (`ref`), or a saved `current` PNG. Returns `matches`, the `mismatchRatio`, and the changed `regions` — each with the elements it overlaps, so you can name what moved — plus a diff image with the changes in red. No baseline yet? Pass `updateBaseline: true` to adopt the current capture (it also replaces a baseline after a mismatch). `maxMismatch` (fraction, default 0) tolerates small noise; `threshold` (0..1, default 0.1) is the per-pixel color sensitivity. Naming the overlapped elements re-describes the page, so use the Refs this result returns.",
  input: z.object({
    baseline: z.string(),
    current: z.string().optional(),
    ref: z.string().optional(),
    fullPage: z.boolean().optional(),
    threshold: z.number().min(0).max(1).optional(),
    maxMismatch: z.number().min(0).max(1).optional(),
    updateBaseline: z.boolean().optional(),
    outputDir: z.string().optional(),
    includeImage: z.boolean().optional(),
    session: sessionArg,
  }),
  services: (args) => browserOf(args.session),
  execute: (args, { browser }) => screenshotDiff(browser, args),
});

// ── Page state ──────────────────────────────────────────────────────────────

const evaluate = defineTool({
  name: "evaluate",
  description:
    'Evaluate a JavaScript expression in the page and return its JSON-serializable value, e.g. `document.title` or `(() => window.__STORE__.getState().user)()`. With `ref`, the expression runs with `el` bound to that element: `el.scrollTop`, `getComputedStyle(el).gap`. For reading app state and probing theories, not for driving the UI — use click/type for that.',
  input: z.object({ expression: z.string(), ref: z.string().optional(), session: sessionArg }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => ({
    value: (await browser.evaluate(args.expression, args.ref)) ?? null,
  }),
});

const cookies = defineTool({
  name: "cookies",
  description:
    "Read or write the session's cookies (HttpOnly included). `get` (optionally scoped by `url`), `set` (`name`, `value`, plus `url` or `domain`; optional `path`, `httpOnly`, `secure`, `sameSite`, `expires` in Unix seconds), `delete` (`name`), `clear`. Seed auth before a flow or check what a login left behind.",
  input: z
    .object({
      action: z.enum(["get", "set", "delete", "clear"]),
      name: z.string().optional(),
      value: z.string().optional(),
      url: z.string().url().optional(),
      domain: z.string().optional(),
      path: z.string().optional(),
      httpOnly: z.boolean().optional(),
      secure: z.boolean().optional(),
      sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
      expires: z.number().optional(),
      session: sessionArg,
    })
    .refine((v) => v.action !== "set" || (v.name != null && v.value != null && (v.url != null || v.domain != null)), {
      message: "`set` needs `name`, `value`, and `url` or `domain`.",
    })
    .refine((v) => v.action !== "delete" || v.name != null, {
      message: "`delete` needs `name`.",
    }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    switch (args.action) {
      case "get":
        return { cookies: await browser.cookies({ action: "get", url: args.url }) };
      case "set":
        return {
          cookies: await browser.cookies({
            action: "set",
            name: args.name!,
            value: args.value!,
            url: args.url,
            domain: args.domain,
            path: args.path,
            httpOnly: args.httpOnly,
            secure: args.secure,
            sameSite: args.sameSite,
            expires: args.expires,
          }),
        };
      case "delete":
        return {
          cookies: await browser.cookies({
            action: "delete",
            name: args.name!,
            domain: args.domain,
            path: args.path,
          }),
        };
      case "clear":
        return { cookies: await browser.cookies({ action: "clear" }) };
    }
  },
});

const storage = defineTool({
  name: "storage",
  description:
    "Read or write the active page's Web Storage. `store`: local | session. `get` returns one `key` or every entry; `set` needs `key` and `value`; `remove` needs `key`; `clear` empties the store. Per origin of the active tab.",
  input: z
    .object({
      store: z.enum(["local", "session"]).default("local"),
      action: z.enum(["get", "set", "remove", "clear"]),
      key: z.string().optional(),
      value: z.string().optional(),
      session: sessionArg,
    })
    .refine((v) => v.action !== "set" || (v.key != null && v.value != null), {
      message: "`set` needs `key` and `value`.",
    })
    .refine((v) => v.action !== "remove" || v.key != null, { message: "`remove` needs `key`." }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => ({
    store: args.store,
    value: await browser.storage({
      store: args.store,
      action: args.action,
      key: args.key,
      value: args.value,
    }),
  }),
});

const tabs = defineTool({
  name: "tabs",
  description:
    "Manage the session's tabs. Every other tool acts on the *active* tab. `list` shows them (ids t1, t2, …); `select` makes `tab` active; `new` opens a tab (optionally at `url`) and activates it; `close` closes `tab` (default: the active one). An action's result lists `openedTabs` when it opened a popup or target=_blank link — select it to follow.",
  input: z
    .object({
      action: z.enum(["list", "select", "new", "close"]).default("list"),
      tab: z.string().optional(),
      url: z.string().url().optional(),
      session: sessionArg,
    })
    .refine((v) => v.action !== "select" || v.tab != null, { message: "`select` needs `tab`." }),
  services: (args) => browserOf(args.session),
  execute: async (args, { browser }) => {
    switch (args.action) {
      case "list":
        return { tabs: await browser.tabs({ action: "list" }) };
      case "select":
        return { tabs: await browser.tabs({ action: "select", tab: args.tab! }) };
      case "new":
        return { tabs: await browser.tabs({ action: "new", url: args.url }) };
      case "close":
        return { tabs: await browser.tabs({ action: "close", tab: args.tab }) };
    }
  },
});

// ── Diagnostics & performance ───────────────────────────────────────────────

const getConsoleLogs = defineTool({
  name: "get-console-logs",
  description:
    "Return console messages and uncaught page errors captured since the session started, across every tab, each with a source `location` when known. Optionally filter by level (e.g. \"error\") and clear the buffer.",
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

/** Every tool the tool-server exposes. */
export const coreTools: AnyToolDefinition[] = [
  navigate,
  describe,
  find,
  waitFor,
  screenshot,
  setViewport,
  click,
  type,
  hover,
  scroll,
  drag,
  pressKey,
  selectOption,
  uploadFile,
  extractStyles,
  compareStylesTool,
  screenshotDiffTool,
  evaluate,
  cookies,
  storage,
  tabs,
  getConsoleLogs,
  getNetworkLog,
  profilePerformance,
];

/** Register all tools on a Registry. */
export function registerCoreTools(registry: Registry): void {
  registry.registerTools(coreTools);
}
