// Visual regression: compare two PNG screenshots pixel by pixel and say *where*
// they differ, not just how much. Pure and browser-free, so the comparison is
// unit-tested in isolation; the `screenshot-diff` tool only supplies the bytes.

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Differing pixels inside this region. */
  pixels: number;
}

export interface DiffOptions {
  /** Per-pixel color distance (0..1) below which pixels count as equal. Default 0.1. */
  threshold?: number;
  /** Grid cell size used to cluster changed pixels into regions. Default 16. */
  cellSize?: number;
  /** Most regions to report, largest first. Default 20. */
  maxRegions?: number;
}

export interface DiffResult {
  /** Fraction of the compared area that differs (0..1), non-overlap included. */
  mismatchRatio: number;
  changedPixels: number;
  width: number;
  height: number;
  /** Set when the two images have different dimensions; they were compared on their overlap. */
  sizeMismatch?: { baseline: { width: number; height: number }; current: { width: number; height: number } };
  /** Bounding boxes of changed areas, largest first. */
  regions: DiffRegion[];
  /** The diff image: the current image dimmed, changed pixels in red. */
  diffPng: Buffer;
}

/** Union-find over grid cells, used to cluster changed cells into regions. */
function clusterRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  cellSize: number,
): DiffRegion[] {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cellPixels = new Uint32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) cellPixels[Math.floor(y / cellSize) * cols + Math.floor(x / cellSize)]++;
    }
  }
  const parent = new Int32Array(cols * rows).fill(-1);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < cellPixels.length; i++) if (cellPixels[i]) parent[i] = i;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!cellPixels[i]) continue;
      // 8-connectivity so a diagonal edge of change stays one region.
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const j = nr * cols + nc;
        if (cellPixels[j]) union(i, j);
      }
    }
  }
  const boxes = new Map<number, { minC: number; minR: number; maxC: number; maxR: number; pixels: number }>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!cellPixels[i]) continue;
      const root = find(i);
      const box = boxes.get(root) ?? { minC: c, minR: r, maxC: c, maxR: r, pixels: 0 };
      box.minC = Math.min(box.minC, c);
      box.minR = Math.min(box.minR, r);
      box.maxC = Math.max(box.maxC, c);
      box.maxR = Math.max(box.maxR, r);
      box.pixels += cellPixels[i];
      boxes.set(root, box);
    }
  }
  // Tighten each box to the exact changed pixels inside its cells.
  const regions: DiffRegion[] = [];
  for (const box of boxes.values()) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const x0 = box.minC * cellSize;
    const y0 = box.minR * cellSize;
    const x1 = Math.min(width, (box.maxC + 1) * cellSize);
    const y1 = Math.min(height, (box.maxR + 1) * cellSize);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!mask[y * width + x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) continue;
    regions.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels: box.pixels });
  }
  return regions.sort((a, b) => b.width * b.height - a.width * a.height);
}

/** Compare two PNG buffers. Throws if either is not a PNG. */
export function diffPngs(baseline: Buffer, current: Buffer, options: DiffOptions = {}): DiffResult {
  const threshold = options.threshold ?? 0.1;
  const cellSize = options.cellSize ?? 16;
  const maxRegions = options.maxRegions ?? 20;

  const a = PNG.sync.read(baseline);
  const b = PNG.sync.read(current);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const sizeMismatch = a.width !== b.width || a.height !== b.height;

  // pixelmatch needs equally sized inputs: crop both to the overlap.
  const crop = (img: PNG): Buffer => {
    if (img.width === width && img.height === height) return img.data;
    const out = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      img.data.copy(out, y * width * 4, y * img.width * 4, y * img.width * 4 + width * 4);
    }
    return out;
  };
  const dataA = crop(a);
  const dataB = crop(b);

  // A mask (changed pixels only) drives region detection; the visual diff is
  // rendered separately so the agent can see the change in context.
  const maskImage = new PNG({ width, height });
  const changedInOverlap = pixelmatch(dataA, dataB, maskImage.data, width, height, {
    threshold,
    includeAA: false,
    diffMask: true,
  });
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) mask[i] = maskImage.data[i * 4 + 3] ? 1 : 0;

  const visual = new PNG({ width, height });
  pixelmatch(dataA, dataB, visual.data, width, height, { threshold, includeAA: false, alpha: 0.4 });

  const fullWidth = Math.max(a.width, b.width);
  const fullHeight = Math.max(a.height, b.height);
  const nonOverlap = fullWidth * fullHeight - width * height;
  const changedPixels = changedInOverlap + nonOverlap;
  const total = fullWidth * fullHeight;

  const result: DiffResult = {
    mismatchRatio: total === 0 ? 0 : Math.round((changedPixels / total) * 10000) / 10000,
    changedPixels,
    width,
    height,
    regions: clusterRegions(mask, width, height, cellSize).slice(0, maxRegions),
    diffPng: PNG.sync.write(visual),
  };
  if (sizeMismatch) {
    result.sizeMismatch = {
      baseline: { width: a.width, height: a.height },
      current: { width: b.width, height: b.height },
    };
  }
  return result;
}
