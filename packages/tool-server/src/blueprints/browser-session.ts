// BrowserSession blueprint: the live, persistent browser the agent drives.
// URN: `BrowserSession:<sessionId>`. Carries cookies, navigation state, tabs,
// and viewport across Tool calls. Backed by Playwright (bundled Chromium).

import {
  chromium,
  type Browser,
  type BrowserContext,
  type FrameLocator,
  type Locator,
  type Page,
} from "playwright";
import { defineBlueprint } from "@ramisalem/registry";

export interface BrowserSessionInput {
  sessionId: string;
  /** Optional base URL so relative `navigate` paths resolve (e.g. the dev server). */
  baseUrl?: string;
}

/** Viewport-relative bounding box of an element, in CSS pixels. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One element the agent can see and act on. */
export interface DescribedElement {
  /** Stable Element Ref for this page state, e.g. `e3`. Target interactions by this. */
  ref: string;
  /** Accessibility role (button, link, textbox, heading, paragraph, image, ...). */
  role: string;
  /** Best-effort accessible name, or the element's own text for content elements. */
  name: string;
  /** Current value, for form controls. Password fields report `***`. */
  value?: string;
  /** Viewport-relative bounding box (for layout/position conformance). */
  box?: BoundingBox;
  /** Ref of the same-origin iframe this element lives in. Absent for the top document. */
  frame?: string;
  disabled?: true;
  checked?: boolean;
}

/** What the agent sees after perceiving: the page state plus a fresh element list. */
export interface PageView {
  url: string;
  title: string;
  elements: DescribedElement[];
  /** True when the element list hit the size cap — narrow it with `find`. */
  truncated?: boolean;
}

export interface PageState {
  url: string;
  title: string;
}

export interface Screenshot {
  format: "png";
  /** Base64-encoded PNG bytes (omitted when written to `path`). */
  base64?: string;
  /** Filesystem path the PNG was written to, if `path` was requested. */
  path?: string;
}

/** Curated computed styles used to ground a Conformance Check. CSS values as the browser resolves them. */
export type ComputedStyles = Record<string, string>;

/** What to click: a perceived element by Ref, or raw viewport coordinates (the fallback). */
export type ClickTarget =
  | {
      ref: string;
      /**
       * "native" (default) drives a real pointer sequence. "js" dispatches
       * `el.click()` on the resolved element instead — for elements a native
       * click focuses but never activates, which happens when a framework
       * re-renders the node between mousedown and mouseup (virtualized data
       * grids are the classic case): the browser composes no click event
       * because the two halves landed on different nodes.
       */
      mode?: "native" | "js";
    }
  | { x: number; y: number };

export interface TypeOptions {
  /** Replace the field's contents (default) vs. append to them. */
  clear?: boolean;
  /** Press Enter after typing. */
  submit?: boolean;
}

export interface ScrollOptions {
  /** Scroll this element into view; with dx/dy, scroll *inside* it. If omitted, scroll the page. */
  ref?: string;
  dx?: number;
  dy?: number;
}

export interface DescribeOptions {
  /** Also list content elements: paragraphs, list items, cells, labels, images. */
  content?: boolean;
  maxElements?: number;
}

export interface FindOptions {
  /** CSS selector (pierces open shadow roots and same-origin iframes). */
  selector?: string;
  /** Case-insensitive substring of the element's own text or accessible name. */
  text?: string;
  maxElements?: number;
}

/** A captured console message or uncaught page error. */
export interface ConsoleEntry {
  /** Playwright console type: "log" | "info" | "warning" | "error" | "debug" | … */
  type: string;
  text: string;
  /** Epoch milliseconds when captured. */
  time: number;
  /** Source location, when the browser reported one. */
  location?: string;
}

/** A captured network response or failed request. */
export interface NetworkEntry {
  method: string;
  url: string;
  /** HTTP status, when a response arrived. */
  status?: number;
  /** Failure text, for a request that never completed. */
  failure?: string;
  /**
   * Response body for error statuses, truncated to ERROR_BODY_CAP. Only
   * captured for status >= 400: a 500's body is the whole reason you are
   * reading the log, while capturing every 200 would cost far more than it
   * tells you. Absent when the body could not be read (redirects, no body).
   */
  errorBody?: string;
  /** Epoch milliseconds when captured. */
  time: number;
}

export interface ConsoleLogQuery {
  /** Only return entries of this level (e.g. "error"); "warn" matches "warning". */
  level?: string;
  /** Empty the buffer after reading. */
  clear?: boolean;
}

export interface NetworkLogQuery {
  /**
   * Only return entries whose URL contains this substring (case-insensitive).
   * A page load is mostly static assets, so an unfiltered log is dominated by
   * noise — filter to the endpoint you actually care about.
   */
  urlPattern?: string;
  /**
   * Only return entries with status >= this, plus every failed request. Pass
   * 400 to get just the errors.
   */
  minStatus?: number;
  /** Empty the buffer after reading. */
  clear?: boolean;
}

/** Core Web Vitals + navigation/resource timing for the current page. */
export interface PerformanceReport {
  /** Time to first byte (ms). */
  ttfb?: number;
  /** First Contentful Paint (ms). */
  fcp?: number;
  /** Largest Contentful Paint (ms). */
  lcp?: number;
  /** Cumulative Layout Shift (unitless; good < 0.1). */
  cls: number;
  /** DOMContentLoaded, ms from navigation start. */
  domContentLoaded?: number;
  /** Load event end, ms from navigation start. */
  load?: number;
  /** Estimated Total Blocking Time from long tasks (ms; good < 200). */
  totalBlockingTime: number;
  /** Number of long tasks (>50ms). */
  longTaskCount: number;
  /** Total number of resources fetched. */
  resourceCount: number;
  /** Sum of resource transfer sizes (bytes). */
  resourceBytes: number;
  /** Resource counts keyed by initiator type (script, css, img, fetch, …). */
  resourcesByType: Record<string, number>;
  /** Document transfer size (bytes). */
  documentBytes?: number;
}

/**
 * Thrown when an Element Ref no longer resolves to anything on the page. Fails
 * fast instead of waiting out Playwright's actionability timeout, and tells
 * the agent what to do about it.
 */
export class StaleRefError extends Error {
  constructor(readonly ref: string) {
    super(
      `Element Ref "${ref}" is not on the page anymore — the page navigated or re-rendered since it was described. Call describe (or find) again and use a fresh Ref.`,
    );
    this.name = "StaleRefError";
  }
}

/** The live browser the agent drives. One per {@link BrowserSessionInput.sessionId}. */
export interface BrowserSession {
  navigate(url: string): Promise<PageState>;
  /** The elements on the current page, each tagged with a fresh Element Ref. */
  describe(opts?: DescribeOptions): Promise<PageView>;
  /** Tag and return the elements matching a selector and/or text, keeping existing Refs valid. */
  find(opts: FindOptions): Promise<PageView>;
  screenshot(opts?: { fullPage?: boolean; path?: string; ref?: string }): Promise<Screenshot>;
  click(target: ClickTarget): Promise<void>;
  type(ref: string, text: string, opts?: TypeOptions): Promise<void>;
  hover(ref: string): Promise<void>;
  scroll(opts?: ScrollOptions): Promise<void>;
  pressKey(key: string): Promise<void>;
  /**
   * Computed styles of the element behind `ref`, or null if the Ref is stale
   * (or `closest` matches no ancestor).
   *
   * `properties` adds to the curated set — pass anything a check asserts so it
   * is actually measured rather than coming back absent. `closest` retargets
   * to the nearest matching ancestor, for libraries that put the ARIA role on
   * a different node than the styles.
   */
  extractStyles(
    ref: string,
    opts?: { properties?: string[]; closest?: string },
  ): Promise<ComputedStyles | null>;
  /** Console messages + page errors captured since the session started (ring-buffered). */
  getConsoleLogs(query?: ConsoleLogQuery): Promise<ConsoleEntry[]>;
  /** Network responses + failed requests captured since the session started (ring-buffered). */
  getNetworkLog(query?: NetworkLogQuery): Promise<NetworkEntry[]>;
  /** Core Web Vitals + timing for the current page (buffered metrics; navigate first). */
  profilePerformance(opts?: { settleMs?: number }): Promise<PerformanceReport>;
  /** Close the browser. Called by the blueprint on eviction/shutdown. */
  close(): Promise<void>;
}

const REF_PATTERN = /^e\d+$/;
const REF_ATTR = "data-maher-ref";

/** Build the locator selector for an Element Ref, rejecting anything malformed. */
function refSelector(ref: string): string {
  if (!REF_PATTERN.test(ref)) {
    throw new Error(`Invalid Element Ref: ${JSON.stringify(ref)} (expected e.g. "e3")`);
  }
  return `[${REF_ATTR}="${ref}"]`;
}

interface WalkArgs {
  mode: "describe" | "find";
  content: boolean;
  selector?: string;
  text?: string;
  maxElements: number;
}

interface WalkResult {
  elements: DescribedElement[];
  truncated: boolean;
}

/**
 * Runs *in the page*. One walker serves both `describe` and `find`.
 *
 * describe: strips every stale Ref, then tags each visible interactable (and,
 * with `content`, each text-bearing or media element) with a fresh Ref.
 * find:     tags only the elements matching `selector` / `text`, reusing Refs
 *           already on the page and continuing the numbering, so earlier Refs
 *           stay valid.
 *
 * Both pierce open shadow roots and same-origin iframes — web components and
 * Storybook-style previews are otherwise invisible — and report each iframe's
 * elements with `frame` set to the iframe's own Ref so the session can build
 * a frame-aware locator. Boxes are offset into top-viewport coordinates.
 *
 * Must be self-contained: it is serialized into the browser, so it closes over
 * nothing outside itself. Cross-frame `instanceof` checks are avoided on
 * purpose — an iframe's elements belong to that frame's constructors.
 */
function walkPage(args: WalkArgs): WalkResult {
  const ATTR = "data-maher-ref";
  const INTERACTIVE = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "[role]",
    "[tabindex]",
    "h1, h2, h3, h4, h5, h6",
    '[contenteditable="true"]',
    "summary",
    "iframe",
  ].join(", ");
  const CONTENT_TAGS = new Set([
    "p", "li", "td", "th", "dt", "dd", "label", "figcaption", "blockquote", "pre",
    "code", "small", "strong", "em", "b", "i", "caption", "legend", "span", "div",
    "img", "svg", "video", "picture",
  ]);
  const MEDIA_ROLE: Record<string, string> = { img: "image", svg: "image", picture: "image", video: "video" };
  const CONTENT_ROLE: Record<string, string> = {
    p: "paragraph", li: "listitem", td: "cell", th: "cell", label: "label",
    pre: "code", code: "code", blockquote: "blockquote",
  };
  const SKIP = new Set(["script", "style", "template", "noscript", "head", "meta", "link", "title"]);

  const top = window as unknown as { __maherRefSeq?: number };
  let seq = args.mode === "describe" ? 0 : (top.__maherRefSeq ?? 0);
  const out: DescribedElement[] = [];
  const seen = new Set<Element>();
  let truncated = false;

  const tagOf = (el: Element): string => el.tagName.toLowerCase();
  const winOf = (el: Element): Window => el.ownerDocument.defaultView ?? window;
  const rootOf = (el: Element): Document | ShadowRoot => el.getRootNode() as Document | ShadowRoot;
  const attr = (el: Element, name: string): string | null => el.getAttribute(name);
  const isPassword = (el: Element): boolean =>
    tagOf(el) === "input" && ((el as HTMLInputElement).type || "").toLowerCase() === "password";

  const ownText = (el: Element): string => {
    let s = "";
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) s += n.nodeValue ?? "";
    });
    return s.replace(/\s+/g, " ").trim();
  };

  const roleFor = (el: Element): string => {
    const explicit = attr(el, "role");
    if (explicit) return explicit;
    const tag = tagOf(el);
    if (tag === "input") {
      const type = (attr(el, "type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }
    const map: Record<string, string> = {
      a: "link", button: "button", select: "combobox", textarea: "textbox", summary: "button",
      iframe: "iframe", h1: "heading", h2: "heading", h3: "heading", h4: "heading",
      h5: "heading", h6: "heading",
    };
    return map[tag] || tag;
  };

  const nameFor = (el: Element): string => {
    const aria = attr(el, "aria-label");
    if (aria) return aria.trim().slice(0, 200);
    const labelledby = attr(el, "aria-labelledby");
    if (labelledby) {
      const parts: string[] = [];
      for (const id of labelledby.split(/\s+/)) {
        const target = rootOf(el).getElementById(id);
        if (target?.textContent) parts.push(target.textContent.trim());
      }
      if (parts.length) return parts.join(" ").slice(0, 200);
    }
    if (el.id) {
      const label = rootOf(el).querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.textContent) return label.textContent.trim().slice(0, 200);
    }
    const tag = tagOf(el);
    if (tag === "iframe") {
      return (attr(el, "title") || attr(el, "name") || attr(el, "src") || "").trim().slice(0, 200);
    }
    for (const a of ["placeholder", "alt", "title"]) {
      const v = attr(el, a);
      if (v) return v.trim().slice(0, 200);
    }
    const text = (el as HTMLElement).innerText || el.textContent || "";
    return text.trim().replace(/\s+/g, " ").slice(0, 120);
  };

  /** Text `find` matches against: the element's own text, else its labelling attributes or value. */
  const findText = (el: Element): string => {
    const own = ownText(el);
    if (own) return own;
    for (const a of ["aria-label", "placeholder", "alt", "title"]) {
      const v = attr(el, a);
      if (v) return v;
    }
    const tag = tagOf(el);
    if ((tag === "input" || tag === "textarea") && !isPassword(el)) {
      return (el as HTMLInputElement).value || "";
    }
    return "";
  };

  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = winOf(el).getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  };

  const checkedOf = (el: Element): boolean | undefined => {
    const tag = tagOf(el);
    if (tag === "input") {
      const type = (attr(el, "type") || "").toLowerCase();
      if (type === "checkbox" || type === "radio") return (el as HTMLInputElement).checked;
    }
    const aria = attr(el, "aria-checked");
    if (aria === "true") return true;
    if (aria === "false") return false;
    return undefined;
  };

  const emit = (
    el: Element,
    frameRef: string | null,
    offset: { x: number; y: number },
    role: string,
    name: string,
  ): string | null => {
    if (seen.has(el)) return attr(el, ATTR);
    if (out.length >= args.maxElements) {
      truncated = true;
      return null;
    }
    seen.add(el);
    let ref = args.mode === "find" ? attr(el, ATTR) : null;
    if (!ref) {
      ref = `e${++seq}`;
      el.setAttribute(ATTR, ref);
    }
    const item: DescribedElement = { ref, role, name };
    if (frameRef) item.frame = frameRef;
    const tag = tagOf(el);
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const value = (el as HTMLInputElement).value;
      // A password never leaves the page as text: the agent only learns that
      // the field is filled.
      if (typeof value === "string" && value) item.value = isPassword(el) ? "***" : value.slice(0, 120);
    }
    if (el.hasAttribute("disabled") || attr(el, "aria-disabled") === "true") item.disabled = true;
    const checked = checkedOf(el);
    if (checked !== undefined) item.checked = checked;
    const rect = el.getBoundingClientRect();
    item.box = {
      x: Math.round(rect.x + offset.x),
      y: Math.round(rect.y + offset.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    out.push(item);
    return ref;
  };

  const needle = args.text?.toLowerCase();
  const matchesFind = (el: Element): boolean => {
    if (args.selector && !el.matches(args.selector)) return false;
    if (needle !== undefined && !findText(el).toLowerCase().includes(needle)) return false;
    return true;
  };

  interface Hit {
    el: Element;
    frameRef: string | null;
    offset: { x: number; y: number };
  }
  const hits: Hit[] = [];

  const walkRoot = (root: Document | ShadowRoot, frameRef: string | null, offset: { x: number; y: number }): void => {
    if (args.mode === "describe") {
      root.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
    }
    const all = Array.from(root.querySelectorAll("*"));
    for (const el of all) {
      if (truncated) return;
      const tag = tagOf(el);
      if (SKIP.has(tag)) continue;

      if (args.mode === "describe") {
        if (el.matches(INTERACTIVE)) {
          if (isVisible(el)) emit(el, frameRef, offset, roleFor(el), nameFor(el));
        } else if (args.content && CONTENT_TAGS.has(tag) && isVisible(el)) {
          if (MEDIA_ROLE[tag]) {
            emit(el, frameRef, offset, MEDIA_ROLE[tag], nameFor(el));
          } else {
            const text = ownText(el);
            if (text) emit(el, frameRef, offset, CONTENT_ROLE[tag] || "text", text.slice(0, 120));
          }
        }
      } else if (matchesFind(el) && isVisible(el)) {
        hits.push({ el, frameRef, offset });
      }

      // A shadow host with display:contents has no box of its own, so only a
      // display:none host hides its shadow tree.
      const shadow = el.shadowRoot;
      if (shadow && winOf(el).getComputedStyle(el).display !== "none") {
        walkRoot(shadow, frameRef, offset);
      }

      if (tag === "iframe" && isVisible(el)) {
        try {
          const doc = (el as HTMLIFrameElement).contentDocument;
          if (doc?.documentElement) {
            // The iframe itself needs a Ref so its elements can be located
            // through it; in find mode that means listing it too.
            const ref = attr(el, ATTR) ?? emit(el, frameRef, offset, "iframe", nameFor(el));
            if (ref) {
              const rect = el.getBoundingClientRect();
              walkRoot(doc, ref, { x: offset.x + rect.x, y: offset.y + rect.y });
            }
          }
        } catch {
          /* cross-origin iframe — unreachable by design */
        }
      }
    }
  };

  walkRoot(document, null, { x: 0, y: 0 });

  if (args.mode === "find") {
    // A text search matches every ancestor whose own text contains the needle
    // as well; keep the deepest so the Ref lands on the element that renders it.
    const chosen =
      needle !== undefined
        ? hits.filter((h) => !hits.some((o) => o.el !== h.el && h.el.contains(o.el)))
        : hits;
    for (const h of chosen) {
      if (truncated) break;
      const tag = tagOf(h.el);
      const role = h.el.matches(INTERACTIVE) ? roleFor(h.el) : MEDIA_ROLE[tag] || CONTENT_ROLE[tag] || "text";
      const name = h.el.matches(INTERACTIVE) ? nameFor(h.el) : ownText(h.el).slice(0, 120) || nameFor(h.el);
      emit(h.el, h.frameRef, h.offset, role, name);
    }
  }

  top.__maherRefSeq = seq;
  return { elements: out, truncated };
}

/**
 * Runs *in the page* against a resolved element. Returns a curated set of
 * computed styles plus any extra properties the caller asked for.
 *
 * `extra` exists because the curated set can never cover every design token a
 * Conformance Check might assert. Without it, asking for a property outside the
 * list came back `undefined`, which compare-styles reported as a *mismatch* —
 * a false negative that looks identical to a genuine design regression.
 *
 * Names may be camelCase (`borderBottomColor`) or the CSS spelling
 * (`border-bottom-color`); custom properties (`--brand`) work too.
 *
 * `closest` measures the nearest ancestor matching a CSS selector instead of
 * the element itself. Component libraries routinely put the ARIA role on an
 * inner node while the styles live on the wrapper — MUI marks `role="tablist"`
 * on `.MuiTabs-flexContainer` but applies `sx` to `.MuiTabs-root` — so
 * measuring the Ref alone silently reads an unstyled element and reports 0px
 * borders.
 */
function extractStylesFromElement(
  found: Element,
  args: { extra: string[]; closest?: string },
): ComputedStyles | null {
  const { extra, closest } = args;
  const el = closest ? found.closest(closest) : found;
  if (!el) return null;
  const style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  const keys = [
    "color",
    "backgroundColor",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "padding",
    "margin",
    "borderRadius",
    "width",
    "height",
    "display",
    // Per-side border values: underlines and dividers (tab bars, table rules,
    // focus rings) are set with `border-bottom`, and the `borderColor` /
    // `borderTopWidth` shorthands read the *unset* edges on those elements.
    "borderWidth",
    "borderStyle",
    "borderColor",
    "borderTopWidth",
    "borderTopColor",
    "borderBottomWidth",
    "borderBottomColor",
    "borderBottomStyle",
    "borderLeftWidth",
    "borderLeftColor",
    "borderRightWidth",
    "borderRightColor",
  ];

  const toCamel = (name: string): string =>
    name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

  const out: ComputedStyles = {};
  const indexable = style as unknown as Record<string, string>;
  const read = (name: string): string | undefined => {
    // Custom properties are only reachable through getPropertyValue.
    if (name.startsWith("--")) {
      const custom = style.getPropertyValue(name).trim();
      return custom === "" ? undefined : custom;
    }
    const camel = toCamel(name);
    const direct = indexable[camel];
    if (direct != null && direct !== "") return direct;
    const viaCss = style.getPropertyValue(name).trim();
    return viaCss === "" ? undefined : viaCss;
  };

  for (const key of keys) {
    const value = read(key);
    if (value !== undefined) out[key] = value;
  }
  // Requested keys are echoed under the exact name the caller used, so
  // compare-styles can look them up without re-normalizing.
  for (const key of extra) {
    const value = read(key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Runs *in the page*. Collects Core Web Vitals from buffered performance
 * entries (LCP, CLS, long tasks) plus navigation/paint/resource timing, after a
 * short settle so observers can replay history. Self-contained — serialized
 * into the browser. `settleMs` is passed in because closures don't cross.
 */
function profilePerformanceInPage(settleMs: number): Promise<PerformanceReport> {
  return new Promise((resolve) => {
    const perf = { lcp: 0, cls: 0, longTasks: [] as number[] };
    const observe = (type: string, cb: (entries: PerformanceEntry[]) => void): void => {
      try {
        new PerformanceObserver((list) => cb(list.getEntries())).observe({ type, buffered: true });
      } catch {
        /* entry type unsupported in this browser */
      }
    };
    observe("largest-contentful-paint", (es) => {
      if (es.length) perf.lcp = es[es.length - 1].startTime;
    });
    observe("layout-shift", (es) => {
      for (const e of es as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!e.hadRecentInput) perf.cls += e.value;
      }
    });
    observe("longtask", (es) => {
      for (const e of es) perf.longTasks.push(e.duration);
    });

    setTimeout(() => {
      const nav = performance.getEntriesByType("navigation")[0] as
        | (PerformanceEntry & {
            responseStart: number;
            domContentLoadedEventEnd: number;
            loadEventEnd: number;
            transferSize: number;
          })
        | undefined;
      const fcp = (performance.getEntriesByType("paint") as PerformanceEntry[]).find(
        (p) => p.name === "first-contentful-paint",
      )?.startTime;
      const resources = performance.getEntriesByType("resource") as Array<
        PerformanceEntry & { initiatorType: string; transferSize: number }
      >;
      const byType: Record<string, number> = {};
      let bytes = 0;
      for (const r of resources) {
        const t = r.initiatorType || "other";
        byType[t] = (byType[t] || 0) + 1;
        bytes += r.transferSize || 0;
      }
      const tbt = perf.longTasks.reduce((sum, d) => sum + Math.max(0, d - 50), 0);
      const round = (n: number | undefined): number | undefined =>
        typeof n === "number" ? Math.round(n) : undefined;

      resolve({
        ttfb: round(nav?.responseStart),
        fcp: round(fcp),
        lcp: perf.lcp ? Math.round(perf.lcp) : undefined,
        cls: Math.round(perf.cls * 1000) / 1000,
        domContentLoaded: round(nav?.domContentLoadedEventEnd),
        load: round(nav?.loadEventEnd),
        totalBlockingTime: Math.round(tbt),
        longTaskCount: perf.longTasks.length,
        resourceCount: resources.length,
        resourceBytes: bytes,
        resourcesByType: byType,
        documentBytes: nav?.transferSize,
      });
    }, settleMs);
  });
}

const DEFAULT_MAX_ELEMENTS = 2000;

function createSession(browser: Browser, context: BrowserContext, first: Page): BrowserSession {
  // Diagnostics: capture console + network into bounded ring buffers shared by
  // every tab. Listeners are attached the moment a page appears, so they cover
  // the whole session.
  const LOG_CAP = 500;
  const ERROR_BODY_CAP = 2000;
  const consoleLog: ConsoleEntry[] = [];
  const networkLog: NetworkEntry[] = [];
  const push = <T>(buf: T[], entry: T): void => {
    buf.push(entry);
    if (buf.length > LOG_CAP) buf.shift();
  };

  function attachDiagnostics(page: Page): void {
    page.on("console", (msg) => {
      const loc = msg.location();
      push(consoleLog, {
        type: msg.type(),
        text: msg.text(),
        time: Date.now(),
        ...(loc.url ? { location: `${loc.url}:${loc.lineNumber + 1}` } : {}),
      });
    });
    page.on("pageerror", (err) =>
      push(consoleLog, { type: "error", text: err.message, time: Date.now() }),
    );
    page.on("response", (res) => {
      const entry: NetworkEntry = {
        method: res.request().method(),
        url: res.url(),
        status: res.status(),
        time: Date.now(),
      };
      push(networkLog, entry);
      // Reading the body is async, so the entry is buffered first and its body
      // filled in when it arrives. The buffer holds the object by reference, so
      // a later read sees the body; if the entry was already evicted the write
      // is harmless. Never let a rejection reach the listener — a body that
      // cannot be read is normal (redirects, empty responses).
      if (res.status() >= 400) {
        void res
          .text()
          .then((body) => {
            if (body) entry.errorBody = body.slice(0, ERROR_BODY_CAP);
          })
          .catch(() => undefined);
      }
    });
    page.on("requestfailed", (req) =>
      push(networkLog, {
        method: req.method(),
        url: req.url(),
        failure: req.failure()?.errorText ?? "failed",
        time: Date.now(),
      }),
    );
  }

  const active: Page = first;
  attachDiagnostics(active);

  // ── Refs ──────────────────────────────────────────────────────────────────
  // Ref -> chain of iframe Refs (outermost first) it lives under. Rebuilt by
  // describe, extended by find. Empty chain = top document.
  const refFrames = new Map<string, string[]>();

  function ingest(elements: DescribedElement[], mode: WalkArgs["mode"]): void {
    if (mode === "describe") refFrames.clear();
    for (const el of elements) {
      const chain = el.frame ? [...(refFrames.get(el.frame) ?? []), el.frame] : [];
      refFrames.set(el.ref, chain);
    }
  }

  function locatorFor(ref: string): Locator {
    const selector = refSelector(ref);
    let scope: Page | FrameLocator = active;
    for (const frameRef of refFrames.get(ref) ?? []) scope = scope.frameLocator(refSelector(frameRef));
    return scope.locator(selector);
  }

  /** Locator for a Ref that is known to still be on the page — or a fast StaleRefError. */
  async function resolve(ref: string): Promise<Locator> {
    const locator = locatorFor(ref);
    let count = 0;
    try {
      count = await locator.count();
    } catch {
      count = 0; // the iframe chain itself is gone
    }
    if (count === 0) throw new StaleRefError(ref);
    return locator;
  }

  async function walk(args: WalkArgs): Promise<PageView> {
    const result = await active.evaluate(walkPage, args);
    ingest(result.elements, args.mode);
    const view: PageView = {
      url: active.url(),
      title: await active.title(),
      elements: result.elements,
    };
    if (result.truncated) view.truncated = true;
    return view;
  }

  return {
    async navigate(url) {
      await active.goto(url, { waitUntil: "domcontentloaded" });
      return { url: active.url(), title: await active.title() };
    },
    describe(opts) {
      return walk({
        mode: "describe",
        content: opts?.content ?? false,
        maxElements: opts?.maxElements ?? DEFAULT_MAX_ELEMENTS,
      });
    },
    find(opts) {
      if (!opts.selector && opts.text === undefined) {
        throw new Error("find needs a `selector`, a `text`, or both.");
      }
      return walk({
        mode: "find",
        content: false,
        selector: opts.selector,
        text: opts.text,
        maxElements: opts.maxElements ?? DEFAULT_MAX_ELEMENTS,
      });
    },
    async screenshot(opts) {
      const shotOptions = opts?.path ? { path: opts.path } : {};
      const buffer = opts?.ref
        ? await (await resolve(opts.ref)).screenshot(shotOptions)
        : await active.screenshot({ fullPage: opts?.fullPage ?? false, ...shotOptions });
      // When written to disk, return the path instead of the bytes — far cheaper
      // for the agent than a base64 blob it then has to decode to view.
      return opts?.path
        ? { format: "png", path: opts.path }
        : { format: "png", base64: buffer.toString("base64") };
    },
    async click(target) {
      if ("ref" in target) {
        const locator = await resolve(target.ref);
        if (target.mode === "js") {
          // Programmatic activation on the current node — immune to the
          // mousedown/mouseup re-render race described on ClickTarget.
          await locator.evaluate((el) => (el as HTMLElement).click());
        } else {
          await locator.click();
        }
      } else {
        await active.mouse.click(target.x, target.y);
      }
    },
    async type(ref, text, opts) {
      const locator = await resolve(ref);
      if (opts?.clear ?? true) {
        await locator.fill(text);
      } else {
        await locator.click();
        await locator.pressSequentially(text);
      }
      if (opts?.submit) await locator.press("Enter");
    },
    async hover(ref) {
      await (await resolve(ref)).hover();
    },
    async scroll(opts) {
      const dx = opts?.dx ?? 0;
      const dy = opts?.dy ?? 0;
      if (opts?.ref) {
        const locator = await resolve(opts.ref);
        if (dx || dy) {
          // Scroll *inside* the element: lists, panes, and code blocks own
          // their scroll position, which the page wheel never reaches.
          await locator.evaluate((el, delta) => el.scrollBy(delta.dx, delta.dy), { dx, dy });
        } else {
          await locator.scrollIntoViewIfNeeded();
        }
      } else {
        await active.mouse.wheel(dx, dy);
      }
    },
    async pressKey(key) {
      await active.keyboard.press(key);
    },
    async extractStyles(ref, opts) {
      // A stale Ref is a null measurement here (compare-styles turns it into a
      // structured `stale_ref` result) rather than a thrown error.
      const locator = locatorFor(ref);
      let count = 0;
      try {
        count = await locator.count();
      } catch {
        count = 0;
      }
      if (count === 0) return null;
      return locator.evaluate(extractStylesFromElement, {
        extra: opts?.properties ?? [],
        closest: opts?.closest,
      });
    },
    async getConsoleLogs(query) {
      const level = query?.level === "warn" ? "warning" : query?.level;
      const out = level ? consoleLog.filter((e) => e.type === level) : [...consoleLog];
      if (query?.clear) consoleLog.length = 0;
      return out;
    },
    async getNetworkLog(query) {
      const needle = query?.urlPattern?.toLowerCase();
      const minStatus = query?.minStatus;
      const out = networkLog.filter((e) => {
        if (needle && !e.url.toLowerCase().includes(needle)) return false;
        // A failed request has no status but is always an error, so it must
        // survive a minStatus filter rather than be dropped for lacking one.
        if (minStatus !== undefined && e.failure === undefined) {
          if (e.status === undefined || e.status < minStatus) return false;
        }
        return true;
      });
      if (query?.clear) networkLog.length = 0;
      return out;
    },
    async profilePerformance(opts) {
      return active.evaluate(profilePerformanceInPage, opts?.settleMs ?? 300);
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

/**
 * Actionability timeout for clicks, fills, and waits. Playwright's 30 s default
 * is tuned for CI retries; an agent needs to hear about a covered or disabled
 * element long before that.
 */
const ACTION_TIMEOUT_MS = 10_000;

export const browserSessionBlueprint = defineBlueprint<
  BrowserSessionInput,
  BrowserSession
>({
  kind: "BrowserSession",
  urn: (input) => `BrowserSession:${input.sessionId}`,
  async create({ baseUrl }) {
    // MAHERAGENT_HEADED=1 shows the browser window so a developer can watch
    // the agent work.
    const headless = !process.env.MAHERAGENT_HEADED;
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext(baseUrl ? { baseURL: baseUrl } : {});
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    const page = await context.newPage();
    return createSession(browser, context, page);
  },
  dispose: (session) => session.close(),
});
