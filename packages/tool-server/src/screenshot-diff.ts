// The screenshot-diff action: capture (or load) the current image, compare it
// with a baseline, write the diff, and name the elements each changed region
// overlaps. Shared by the `screenshot-diff` tool and the flow `snapshot` step.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { BrowserSession } from "./blueprints/browser-session.js";
import { diffPngs, type DiffRegion } from "./visual-diff.js";

export interface ScreenshotDiffArgs {
  /** Path of the baseline PNG. */
  baseline: string;
  /** Path of a saved PNG to compare; omit to capture the live page (or `ref`). */
  current?: string;
  ref?: string;
  fullPage?: boolean;
  threshold?: number;
  /** Fraction of differing pixels tolerated (default 0). */
  maxMismatch?: number;
  /** Adopt the current capture as the baseline when missing, or after a mismatch. */
  updateBaseline?: boolean;
  /** Where the current capture and diff go (default: beside the baseline). */
  outputDir?: string;
  /** Attach the diff PNG (base64) to a mismatching result (default true). */
  includeImage?: boolean;
}

interface Size {
  width: number;
  height: number;
}

interface Box extends Size {
  x: number;
  y: number;
}

export interface NamedRegion extends DiffRegion {
  /** The smallest elements overlapping this region (fresh Refs). */
  elements?: Array<{ ref: string; role: string; name: string }>;
}

export type ScreenshotDiffResult =
  | { matches: true; created: true; baseline: string; current: string }
  | { matches: false; error: "no_baseline"; message: string; current: string }
  | {
      matches: boolean;
      mismatchRatio: number;
      changedPixels: number;
      width: number;
      height: number;
      sizeMismatch?: { baseline: Size; current: Size };
      regions: NamedRegion[];
      baseline: string;
      current: string;
      diffPath: string;
      updated?: true;
      diff?: { format: "png"; base64: string; path: string };
    };

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export async function screenshotDiff(
  browser: BrowserSession,
  args: ScreenshotDiffArgs,
): Promise<ScreenshotDiffResult> {
  const outputDir = args.outputDir ?? dirname(args.baseline);
  mkdirSync(outputDir, { recursive: true });
  const stem = basename(args.baseline).replace(/\.png$/i, "");

  // Where the compared pixels sit in the viewport, for mapping regions to elements.
  let offset: Box | null = null;
  let currentPath = args.current;
  if (!currentPath) {
    if (args.ref) {
      offset = (await browser.evaluate(
        "(() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()",
        args.ref,
      )) as Box;
    } else if (!args.fullPage) {
      offset = { x: 0, y: 0, width: 0, height: 0 };
    }
    currentPath = join(outputDir, `${stem}.current.png`);
    await browser.screenshot({ fullPage: args.fullPage, ref: args.ref, path: currentPath });
  }
  const currentBytes = readFileSync(currentPath);

  if (!existsSync(args.baseline)) {
    if (args.updateBaseline) {
      mkdirSync(dirname(args.baseline), { recursive: true });
      copyFileSync(currentPath, args.baseline);
      return { matches: true, created: true, baseline: args.baseline, current: currentPath };
    }
    return {
      matches: false,
      error: "no_baseline",
      message: `No baseline at ${args.baseline}. Pass updateBaseline: true to adopt the current capture as the baseline.`,
      current: currentPath,
    };
  }

  const result = diffPngs(readFileSync(args.baseline), currentBytes, { threshold: args.threshold });
  const diffPath = join(outputDir, `${stem}.diff.png`);
  writeFileSync(diffPath, result.diffPng);
  const matches = result.mismatchRatio <= (args.maxMismatch ?? 0);

  // Name what changed: the smallest elements whose box overlaps each region.
  let regions: NamedRegion[] = result.regions;
  if (offset && result.regions.length > 0) {
    const view = await browser.describe({ content: true });
    regions = result.regions.map((region) => {
      const box: Box = {
        x: region.x + offset.x,
        y: region.y + offset.y,
        width: region.width,
        height: region.height,
      };
      const hits = view.elements
        .filter((e) => e.box && e.box.width > 0 && intersects(e.box, box))
        .sort((a, b) => a.box!.width * a.box!.height - b.box!.width * b.box!.height)
        .slice(0, 5)
        .map((e) => ({ ref: e.ref, role: e.role, name: e.name }));
      return { ...region, elements: hits };
    });
  }

  let updated = false;
  if (!matches && args.updateBaseline) {
    copyFileSync(currentPath, args.baseline);
    updated = true;
  }

  return {
    matches,
    mismatchRatio: result.mismatchRatio,
    changedPixels: result.changedPixels,
    width: result.width,
    height: result.height,
    ...(result.sizeMismatch ? { sizeMismatch: result.sizeMismatch } : {}),
    regions,
    baseline: args.baseline,
    current: currentPath,
    diffPath,
    ...(updated ? { updated: true as const } : {}),
    // The diff image rides along so the model can look at the change in context.
    ...(!matches && args.includeImage !== false
      ? { diff: { format: "png" as const, base64: result.diffPng.toString("base64"), path: diffPath } }
      : {}),
  };
}
