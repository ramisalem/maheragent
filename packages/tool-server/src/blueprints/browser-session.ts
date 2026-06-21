// BrowserSession blueprint: the live, persistent browser the agent drives.
// URN: `BrowserSession:<sessionId>`. Carries cookies, navigation state, viewport
// across Tool calls. Backed by Playwright.

import type { Blueprint } from "@ramisalem/registry";

export interface BrowserSessionInput {
  sessionId: string;
  // e.g. baseUrl for the local dev server / target URL
  baseUrl?: string;
}

export interface BrowserSession {
  // TODO: navigate(url), describe() -> elements w/ Element Refs, click(ref),
  //       type(ref, text), screenshot(), extractStyles(ref?), consoleLogs(), networkLogs()
}

export const browserSessionBlueprint: Blueprint<BrowserSessionInput, BrowserSession> = {
  urn: (input) => `BrowserSession:${input.sessionId}`,
  create: (_input) => {
    // TODO: launch a Playwright browser context, return the BrowserSession API.
    throw new Error("not implemented");
  },
};
