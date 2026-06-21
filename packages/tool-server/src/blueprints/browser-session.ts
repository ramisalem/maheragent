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
export interface DescribedElement {
  /** Stable Element Ref for this page state, e.g. `e3`. Target interactions by this. */
  ref: string;
  /** Accessibility role (button, link, textbox, heading, ...). */
  role: string;
  /** Best-effort accessible name. */
  name: string;
  /** Current value, for form controls. */
  value?: string;
}

export interface PageState {
  url: string;
  title: string;
}

export interface Screenshot {
  format: "png";
  /** Base64-encoded PNG bytes. */
  base64: string;
}

/** The live browser the agent drives. One per {@link BrowserSessionInput.sessionId}. */
export interface BrowserSession {
  navigate(url: string): Promise<PageState>;
  /** The interactable elements on the current page, each tagged with an Element Ref. */
  describe(): Promise<DescribedElement[]>;
  screenshot(opts?: { fullPage?: boolean }): Promise<Screenshot>;
  /** Close the browser. Called by the blueprint on eviction/shutdown. */
  close(): Promise<void>;
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
    out.push(item);
  });

  return out;
}

function createSession(
  browser: Browser,
  context: BrowserContext,
  page: Page,
): BrowserSession {
  return {
    async navigate(url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return { url: page.url(), title: await page.title() };
    },
    async describe() {
      return page.evaluate(describeInPage);
    },
    async screenshot(opts) {
      const buffer = await page.screenshot({ fullPage: opts?.fullPage ?? false });
      return { format: "png", base64: buffer.toString("base64") };
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
