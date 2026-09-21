// First-run browser install: Playwright's npm package ships no browsers, so a
// fresh install must download the Chromium build its Playwright pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  BrowserInstallError,
  installArgs,
  installBrowser,
  isMissingBrowserError,
  playwrightVersion,
  withBrowserInstall,
} from "@ramisalem/tool-server";

const require = createRequire(import.meta.url);

// What Playwright throws when the build for its version is not downloaded.
const MISSING = new Error(
  "browserType.launch: Executable doesn't exist at /cache/chromium_headless_shell-1243/chrome-headless-shell\n" +
    "║ Looks like Playwright was just installed or updated.       ║\n" +
    "║ Please run the following command to download new browsers: ║",
);

test("recognizes Playwright's missing-browser error and nothing else", () => {
  assert.equal(isMissingBrowserError(MISSING), true);
  assert.equal(isMissingBrowserError("Please run the following command to download new browsers"), true);
  assert.equal(isMissingBrowserError(new Error("Target page, context or browser has been closed")), false);
  assert.equal(isMissingBrowserError(new Error("Host system is missing dependencies to run browsers")), false);
});

test("headless installs only the headless shell; progress is opt-in", () => {
  assert.deepEqual(installArgs({ headless: true, progress: false }), ["install", "--only-shell", "--no-progress", "chromium"]);
  assert.deepEqual(installArgs({ headless: false, progress: true }), ["install", "chromium"]);
});

test("a present browser launches without installing", async () => {
  let installs = 0;
  const browser = await withBrowserInstall(
    "present",
    async () => "browser",
    async () => void installs++,
  );
  assert.equal(browser, "browser");
  assert.equal(installs, 0);
});

test("a missing browser is downloaded once, then launched", async () => {
  let launches = 0;
  let installed = false;
  let installs = 0;
  const browser = await withBrowserInstall(
    "missing",
    async () => {
      launches++;
      if (!installed) throw MISSING;
      return "browser";
    },
    async () => {
      installs++;
      installed = true;
    },
  );
  assert.equal(browser, "browser");
  assert.deepEqual({ launches, installs }, { launches: 2, installs: 1 });
});

test("sessions launching at the same time share one download", async () => {
  let installed = false;
  let installs = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const launch = async () => {
    if (!installed) throw MISSING;
    return "browser";
  };
  const install = async () => {
    installs++;
    await gate;
    installed = true;
  };
  const both = Promise.all([
    withBrowserInstall("shared", launch, install),
    withBrowserInstall("shared", launch, install),
  ]);
  await new Promise((r) => setTimeout(r, 20));
  release();
  assert.deepEqual(await both, ["browser", "browser"]);
  assert.equal(installs, 1);
});

test("a failed download says how to retry, and the next launch tries again", async () => {
  let attempts = 0;
  const failing = () =>
    withBrowserInstall(
      "failing",
      async () => {
        throw MISSING;
      },
      async () => {
        attempts++;
        throw new Error("getaddrinfo ENOTFOUND cdn.playwright.dev");
      },
    );
  await assert.rejects(failing(), (err) => {
    assert.ok(err instanceof BrowserInstallError);
    assert.match(err.message, /ENOTFOUND cdn\.playwright\.dev/);
    assert.match(err.message, /maheragent browser install/);
    return true;
  });
  await assert.rejects(failing(), BrowserInstallError);
  assert.equal(attempts, 2, "a failure is not cached");
});

test("other launch failures pass through without a download", async () => {
  let installs = 0;
  const crash = new Error("Host system is missing dependencies to run browsers");
  await assert.rejects(
    withBrowserInstall(
      "other",
      async () => {
        throw crash;
      },
      async () => void installs++,
    ),
    (err) => err === crash,
  );
  assert.equal(installs, 0);
});

test("reports the Playwright the daemon launches with", () => {
  assert.equal(playwrightVersion(), require("playwright/package.json").version);
});

test("installBrowser runs Playwright's installer and is a no-op when the build is present", async () => {
  // The rest of this suite needs the headless shell, so it is already here:
  // the real installer must find it and return without downloading.
  const start = Date.now();
  await installBrowser({ headless: true });
  assert.ok(Date.now() - start < 15_000, `took ${Date.now() - start}ms`);
});
