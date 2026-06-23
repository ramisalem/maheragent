// BrowserSession blueprint: the live, persistent browser the agent drives.
// URN: `BrowserSession:<sessionId>`. Carries cookies, navigation state, and
// viewport across Tool calls. Backed by Playwright (bundled Chromium).

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { defineBlueprint } from "@ramisalem/registry";

export interface BrowserSessionInput {
  sessionId: string;
  /** Optional base URL so relative `navigate` paths resolve (e.g. the dev server). */
  baseUrl?: string;
}

/** One interactable element the agent can see and act on. */
/** Viewport-relative bounding box of an element, in CSS pixels. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DescribedElement {
  /** Stable Element Ref for this page state, e.g. `e3`. Target interactions by this. */
  ref: string;
  /** Accessibility role (button, link, textbox, heading, ...). */
  role: string;
  /** Best-effort accessible name. */
  name: string;
  /** Current value, for form controls. */
  value?: string;
  /** Viewport-relative bounding box (for layout/position conformance). */
  box?: BoundingBox;
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
export type ClickTarget = { ref: string } | { x: number; y: number };

export interface TypeOptions {
  /** Replace the field's contents (default) vs. append to them. */
  clear?: boolean;
}

export interface ScrollOptions {
  /** Scroll this element into view; if omitted, scroll the page by (dx, dy). */
  ref?: string;
  dx?: number;
  dy?: number;
}

/** A captured console message or uncaught page error. */
export interface ConsoleEntry {
  /** Playwright console type: "log" | "info" | "warning" | "error" | "debug" | … */
  type: string;
  text: string;
  /** Epoch milliseconds when captured. */
  time: number;
}

/** A captured network response or failed request. */
export interface NetworkEntry {
  method: string;
  url: string;
  /** HTTP status, when a response arrived. */
  status?: number;
  /** Failure text, for a request that never completed. */
  failure?: string;
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

/** The live browser the agent drives. One per {@link BrowserSessionInput.sessionId}. */
export interface BrowserSession {
  navigate(url: string): Promise<PageState>;
  /** The interactable elements on the current page, each tagged with an Element Ref. */
  describe(): Promise<DescribedElement[]>;
  screenshot(opts?: { fullPage?: boolean; path?: string }): Promise<Screenshot>;
  click(target: ClickTarget): Promise<void>;
  type(ref: string, text: string, opts?: TypeOptions): Promise<void>;
  hover(ref: string): Promise<void>;
  scroll(opts?: ScrollOptions): Promise<void>;
  pressKey(key: string): Promise<void>;
  /** Computed styles of the element behind `ref`, or null if the Ref is stale. */
  extractStyles(ref: string): Promise<ComputedStyles | null>;
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

/** Build the locator selector for an Element Ref, rejecting anything malformed. */
function refSelector(ref: string): string {
  if (!REF_PATTERN.test(ref)) {
    throw new Error(`Invalid Element Ref: ${JSON.stringify(ref)} (expected e.g. "e3")`);
  }
  return `[data-maher-ref="${ref}"]`;
}

/**
 * Runs *in the page*. Walks candidate interactable / landmark elements, tags each
 * with a `data-maher-ref` attribute (so later interaction can resolve it), and
 * returns a compact list of {ref, role, name, value?}. Must be self-contained —
 * it is serialized into the browser, so it closes over nothing outside itself.
 */
function describeInPage(): DescribedElement[] {
  const SELECTOR = [
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
  ].join(", ");

  const roleFor = (el: Element): string => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }
    const map: Record<string, string> = {
      a: "link",
      button: "button",
      select: "combobox",
      textarea: "textbox",
      summary: "button",
      h1: "heading",
      h2: "heading",
      h3: "heading",
      h4: "heading",
      h5: "heading",
      h6: "heading",
    };
    return map[tag] || tag;
  };

  const nameFor = (el: Element): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const target = document.getElementById(labelledby);
      if (target?.textContent) return target.textContent.trim();
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.textContent) return label.textContent.trim();
    }
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
    const alt = el.getAttribute("alt");
    if (alt) return alt.trim();
    const title = el.getAttribute("title");
    if (title) return title.trim();
    const text = (el as HTMLElement).innerText || el.textContent || "";
    return text.trim().replace(/\s+/g, " ").slice(0, 120);
  };

  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0"
    );
  };

  const seen = new Set<Element>();
  const out: DescribedElement[] = [];
  let counter = 0;

  document.querySelectorAll(SELECTOR).forEach((el) => {
    if (seen.has(el) || !isVisible(el)) return;
    seen.add(el);
    const ref = `e${++counter}`;
    el.setAttribute("data-maher-ref", ref);
    const item: DescribedElement = { ref, role: roleFor(el), name: nameFor(el) };
    const value = (el as HTMLInputElement).value;
    if (typeof value === "string" && value) item.value = value.slice(0, 120);
    const rect = el.getBoundingClientRect();
    item.box = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    out.push(item);
  });

  return out;
}

/** Runs *in the page*. Returns a curated set of computed styles for an Element Ref. */
function extractStylesInPage(ref: string): ComputedStyles | null {
  const el = document.querySelector(`[data-maher-ref="${ref}"]`);
  if (!el) return null;
  const style = getComputedStyle(el);
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
    "borderTopWidth",
    "borderColor",
    "width",
    "height",
    "display",
  ];
  const out: ComputedStyles = {};
  const indexable = style as unknown as Record<string, string>;
  for (const key of keys) out[key] = indexable[key];
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

function createSession(
  browser: Browser,
  context: BrowserContext,
  page: Page,
): BrowserSession {
  // Diagnostics: capture console + network into bounded ring buffers. Listeners
  // are attached once, before any navigation, so they cover the whole session.
  const LOG_CAP = 500;
  const consoleLog: ConsoleEntry[] = [];
  const networkLog: NetworkEntry[] = [];
  const push = <T>(buf: T[], entry: T): void => {
    buf.push(entry);
    if (buf.length > LOG_CAP) buf.shift();
  };

  page.on("console", (msg) =>
    push(consoleLog, { type: msg.type(), text: msg.text(), time: Date.now() }),
  );
  page.on("pageerror", (err) =>
    push(consoleLog, { type: "error", text: err.message, time: Date.now() }),
  );
  page.on("response", (res) =>
    push(networkLog, {
      method: res.request().method(),
      url: res.url(),
      status: res.status(),
      time: Date.now(),
    }),
  );
  page.on("requestfailed", (req) =>
    push(networkLog, {
      method: req.method(),
      url: req.url(),
      failure: req.failure()?.errorText ?? "failed",
      time: Date.now(),
    }),
  );

  return {
    async navigate(url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return { url: page.url(), title: await page.title() };
    },
    async describe() {
      return page.evaluate(describeInPage);
    },
    async screenshot(opts) {
      const buffer = await page.screenshot({
        fullPage: opts?.fullPage ?? false,
        ...(opts?.path ? { path: opts.path } : {}),
      });
      // When written to disk, return the path instead of the bytes — far cheaper
      // for the agent than a base64 blob it then has to decode to view.
      return opts?.path
        ? { format: "png", path: opts.path }
        : { format: "png", base64: buffer.toString("base64") };
    },
    async click(target) {
      if ("ref" in target) {
        await page.locator(refSelector(target.ref)).click();
      } else {
        await page.mouse.click(target.x, target.y);
      }
    },
    async type(ref, text, opts) {
      const locator = page.locator(refSelector(ref));
      if (opts?.clear ?? true) {
        await locator.fill(text);
      } else {
        await locator.click();
        await locator.pressSequentially(text);
      }
    },
    async hover(ref) {
      await page.locator(refSelector(ref)).hover();
    },
    async scroll(opts) {
      if (opts?.ref) {
        await page.locator(refSelector(opts.ref)).scrollIntoViewIfNeeded();
      } else {
        await page.mouse.wheel(opts?.dx ?? 0, opts?.dy ?? 0);
      }
    },
    async pressKey(key) {
      await page.keyboard.press(key);
    },
    async extractStyles(ref) {
      return page.evaluate(extractStylesInPage, ref);
    },
    async getConsoleLogs(query) {
      const level = query?.level === "warn" ? "warning" : query?.level;
      const out = level ? consoleLog.filter((e) => e.type === level) : [...consoleLog];
      if (query?.clear) consoleLog.length = 0;
      return out;
    },
    async getNetworkLog(query) {
      const out = [...networkLog];
      if (query?.clear) networkLog.length = 0;
      return out;
    },
    async profilePerformance(opts) {
      return page.evaluate(profilePerformanceInPage, opts?.settleMs ?? 300);
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

export const browserSessionBlueprint = defineBlueprint<
  BrowserSessionInput,
  BrowserSession
>({
  kind: "BrowserSession",
  urn: (input) => `BrowserSession:${input.sessionId}`,
  async create({ baseUrl }) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(baseUrl ? { baseURL: baseUrl } : {});
    const page = await context.newPage();
    return createSession(browser, context, page);
  },
  dispose: (session) => session.close(),
});
