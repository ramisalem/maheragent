---
name: visual-regression
description: Catch unintended visual changes on a web page with maheragent — capture a baseline, make the change, compare with screenshot-diff, and read which elements changed. Use when the user asks for a visual regression check, a before/after comparison, "make sure nothing else moved", or a pixel-level check of layout, spacing, color, typography, or image rendering.
---

# Visual regression

`screenshot-diff` compares the page (or one element) against a baseline PNG and
tells you **where** it changed and **which elements** sit in each changed region.
It is supporting evidence for a change you made on purpose, and the way to prove
nothing else moved. It is not a substitute for `describe`, `compare-styles`, logs,
or the network record — combine it with them.

## When to use it

- After a change to layout, spacing, color, typography, icons, or images.
- When a change could cause clipping, overflow, or reflow elsewhere on the screen.
- Before/after an interaction (open a menu, toggle a theme) to check what it repainted.

Poor fit: dynamic content (clocks, ads, random data), unpausable animation, or a
question better answered structurally (state, navigation, accessibility names).

## The loop

1. **Fix the conditions.** `set-viewport` to the width you will always compare at.
   Same viewport, same color scheme, same data — or the diff is noise.
2. **Bring the page to the known-good state** and let it settle:
   `wait-for` `{ "idle": true }`.
3. **Capture the baseline** once:
   `screenshot-diff` `{ "baseline": "<project>/.maheragent/baselines/<name>.png", "updateBaseline": true }`
   — returns `created: true`. Commit baselines you want to keep.
4. **Make the change** (edit code and reload, or perform the interaction).
5. **Compare:** `screenshot-diff` `{ "baseline": "<same path>" }`.
   - `matches: true` — pixel-identical (or within `maxMismatch`).
   - `matches: false` — read `mismatchRatio`, then `regions`: each has a box and
     the `elements` it overlaps (`ref`, `role`, `name`), smallest first. The diff
     image arrives inline with changes in red; `diffPath` is on disk.
6. **Report** what changed *by element*: "the Continue button (e7) changed color;
   the header below it shifted 8px" — and whether each change was intended.
   An unexpected region is the finding.

## Reading the result

- `regions[].elements` come from a fresh `describe` with `content: true`, so
  these Refs are current; earlier Refs are stale after this call.
- `sizeMismatch` means the two captures differ in size (viewport changed, page
  grew). The overlap was compared and the rest counted as changed — fix the
  conditions rather than reasoning about the ratio.
- `maxMismatch` (fraction of pixels) absorbs anti-aliasing noise; keep it tiny
  (`0.001`). `threshold` (per-pixel color sensitivity, default `0.1`) is rarely
  worth changing.
- `{ "ref": "e12" }` compares one element only — use it for a component check
  when the rest of the page is expected to change.
- `updateBaseline: true` on a mismatch replaces the baseline (`updated: true`).
  Only do this when the user confirmed the new look is right.
- `includeImage: false` skips the inline diff image when you only need numbers.

## Example

```
set-viewport   { "width": 1280, "height": 800 }
navigate       { "url": "http://localhost:3000/pricing" }
wait-for       { "idle": true }
screenshot-diff { "baseline": ".maheragent/baselines/pricing.png", "updateBaseline": true }
… change the card padding token, reload …
screenshot-diff { "baseline": ".maheragent/baselines/pricing.png" }
→ matches: false, regions: [ { x: 96, y: 412, width: 1088, height: 36,
     elements: [ { ref: "e31", role: "paragraph", name: "Billed annually" }, … ] } ]
```

The padding change moved the footnote paragraph, nothing else. Report exactly that.
