import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { diffPngs } from "@ramisalem/tool-server";

/** A solid image with optional rectangles painted over it. */
function image(width, height, rects = []) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  for (const { x, y, w, h, rgb } of rects) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const i = (yy * width + xx) * 4;
        png.data[i] = rgb[0];
        png.data[i + 1] = rgb[1];
        png.data[i + 2] = rgb[2];
        png.data[i + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}

test("identical images match with no regions", () => {
  const a = image(200, 100);
  const result = diffPngs(a, a);
  assert.equal(result.changedPixels, 0);
  assert.equal(result.mismatchRatio, 0);
  assert.deepEqual(result.regions, []);
  assert.deepEqual([...result.diffPng.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "diff is a PNG");
});

test("a changed block is reported as one tight region with its pixel count", () => {
  const base = image(200, 100);
  const changed = image(200, 100, [{ x: 100, y: 40, w: 30, h: 20, rgb: [200, 0, 0] }]);
  const result = diffPngs(base, changed);
  assert.equal(result.changedPixels, 600);
  assert.equal(result.mismatchRatio, 0.03);
  assert.equal(result.regions.length, 1);
  assert.deepEqual(result.regions[0], { x: 100, y: 40, width: 30, height: 20, pixels: 600 });
});

test("separate changes become separate regions, largest first", () => {
  const base = image(300, 200);
  const changed = image(300, 200, [
    { x: 10, y: 10, w: 10, h: 10, rgb: [0, 0, 200] },
    { x: 200, y: 120, w: 60, h: 40, rgb: [0, 200, 0] },
  ]);
  const { regions } = diffPngs(base, changed);
  assert.equal(regions.length, 2);
  assert.deepEqual([regions[0].width, regions[0].height], [60, 40]);
  assert.deepEqual([regions[1].width, regions[1].height], [10, 10]);
});

test("different sizes are compared on the overlap and the rest counts as changed", () => {
  const base = image(100, 100);
  const taller = image(100, 150);
  const result = diffPngs(base, taller);
  assert.deepEqual(result.sizeMismatch, {
    baseline: { width: 100, height: 100 },
    current: { width: 100, height: 150 },
  });
  assert.equal(result.changedPixels, 100 * 50, "the extra rows are a change");
  assert.equal(result.width, 100);
  assert.equal(result.height, 100);
});

test("threshold controls sensitivity to faint color drift", () => {
  const base = image(50, 50, [{ x: 0, y: 0, w: 50, h: 50, rgb: [100, 100, 100] }]);
  const faint = image(50, 50, [{ x: 0, y: 0, w: 50, h: 50, rgb: [104, 104, 104] }]);
  assert.equal(diffPngs(base, faint, { threshold: 0.1 }).changedPixels, 0);
  assert.ok(diffPngs(base, faint, { threshold: 0 }).changedPixels > 0);
});
