// Playwright's npm package ships without browsers, and every Playwright release
// pins its own Chromium build. So `npm install -g maheragent` alone leaves
// nothing to launch, and the first tool call failed with Playwright's
// "Executable doesn't exist". The browser is now fetched with the installer of
// the very Playwright the daemon launches with — up front by `maheragent init`
// or `maheragent browser install`, and otherwise by the first launch that
// finds it missing.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium, type Browser } from "playwright";

const require = createRequire(import.meta.url);

/** Root of the Playwright package this module launches with. */
function playwrightRoot(): string {
  return dirname(require.resolve("playwright/package.json"));
}

/** Version of the Playwright the daemon launches with; its Chromium build follows from it. */
export function playwrightVersion(): string {
  const manifest = JSON.parse(readFileSync(join(playwrightRoot(), "package.json"), "utf8"));
  return (manifest as { version: string }).version;
}

/** True when a launch failed only because this Playwright's browser build is not downloaded. */
export function isMissingBrowserError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Executable doesn't exist|download new browsers/i.test(message);
}

/**
 * Arguments for Playwright's `install` command. A headless launch runs the
 * headless shell, so it needs only that, a fraction of the full download; a
 * headed launch (MAHERAGENT_HEADED) needs full Chromium, installed alongside.
 */
export function installArgs(opts: { headless: boolean; progress: boolean }): string[] {
  return [
    "install",
    ...(opts.headless ? ["--only-shell"] : []),
    ...(opts.progress ? [] : ["--no-progress"]),
    "chromium",
  ];
}

export interface InstallOptions {
  /** Install only what headless launches need (default true). */
  headless?: boolean;
  /**
   * Where the installer's output goes. "inherit" hands it the caller's
   * terminal (progress bars); a function receives it as it arrives. Omitted,
   * the install runs quietly and its output only appears in a failure.
   */
  output?: "inherit" | ((text: string) => void);
}

/** The last few non-empty lines of installer output, for an error message. */
function lastLines(text: string, count = 6): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join("\n");
}

/**
 * Download the Chromium build this Playwright needs. Playwright skips builds
 * that are already present, so this is cheap to call on every `init`.
 */
export function installBrowser(opts: InstallOptions = {}): Promise<void> {
  const inherit = opts.output === "inherit";
  const onOutput = typeof opts.output === "function" ? opts.output : undefined;
  const args = [
    join(playwrightRoot(), "cli.js"),
    ...installArgs({ headless: opts.headless ?? true, progress: inherit || onOutput !== undefined }),
  ];
  return new Promise((resolve, reject) => {
    // Piped unless a terminal asked for it: the daemon's own stdout and stderr
    // may belong to a process that exited long ago.
    const child = spawn(process.execPath, args, {
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000);
      onOutput?.(text);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(lastLines(tail) || `playwright install exited with code ${code}`));
    });
  });
}

/** Thrown when the browser was missing and downloading it failed. */
export class BrowserInstallError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    let version = "";
    try {
      version = ` ${playwrightVersion()}`;
    } catch {
      /* the message is still useful without it */
    }
    super(
      `Chromium for Playwright${version} is not installed, and downloading it failed:\n${detail}\nRun \`maheragent browser install\` to retry and watch the download. It honors HTTPS_PROXY and PLAYWRIGHT_BROWSERS_PATH.`,
    );
    this.name = "BrowserInstallError";
  }
}

/** One download per kind at a time, however many sessions are launching. */
const inflight = new Map<string, Promise<void>>();

/**
 * Run `launch`. If it fails only because the browser build is not downloaded,
 * run `install` and launch once more. Launches that hit the same gap while a
 * download runs share it. Any other launch failure passes through untouched.
 */
export async function withBrowserInstall<T>(
  key: string,
  launch: () => Promise<T>,
  install: () => Promise<void>,
): Promise<T> {
  try {
    return await launch();
  } catch (err) {
    if (!isMissingBrowserError(err)) throw err;
  }
  let pending = inflight.get(key);
  if (!pending) {
    pending = install().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  try {
    await pending;
  } catch (err) {
    throw new BrowserInstallError(err);
  }
  return launch();
}

/** Launch Chromium, downloading this Playwright's build first if it is missing. */
export function launchChromium(headless: boolean): Promise<Browser> {
  return withBrowserInstall(
    headless ? "headless" : "headed",
    () => chromium.launch({ headless }),
    () => installBrowser({ headless }),
  );
}
