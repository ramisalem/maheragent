---
name: web-performance
description: Profile a web page's performance with maheragent and propose grounded optimizations. Use when the user asks about page performance, Core Web Vitals (LCP/CLS/INP), load/render speed, or slow pages.
---

# Web performance

Measure first, then recommend — every suggestion must trace to a number from
`profile-performance`, not to general advice.

## The loop

1. **Navigate** to the page (`navigate`), then **`profile-performance`** `{}`.
   It returns Core Web Vitals + timing from the loaded document:
   - `lcp` (Largest Contentful Paint, ms), `cls` (Cumulative Layout Shift),
     `fcp` (First Contentful Paint, ms)
   - `totalBlockingTime` (ms, estimated from long tasks), `longTaskCount`
   - `ttfb`, `domContentLoaded`, `load` (ms)
   - `resourceCount`, `resourceBytes`, `resourcesByType` (script/css/img/fetch/…),
     `documentBytes`
2. **Capture a baseline** before any change so the improvement is measurable.
3. **Interpret against thresholds** (Core Web Vitals "good" targets):
   | Metric | Good | Needs work | Poor |
   |---|---|---|---|
   | LCP | ≤ 2500ms | ≤ 4000ms | > 4000ms |
   | CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |
   | TBT | ≤ 200ms | ≤ 600ms | > 600ms |
   | FCP | ≤ 1800ms | ≤ 3000ms | > 3000ms |
4. **Tie each recommendation to the data.** Examples:
   - High `lcp` + large `img` bytes → defer/lazy-load offscreen images, serve
     responsive sizes, preload the LCP image.
   - High `totalBlockingTime` / `longTaskCount` → split long tasks, defer
     non-critical JS, reduce hydration work.
   - `cls` > 0.1 → reserve space for images/ads/fonts; avoid layout-shifting
     late content.
   - Large `script` `resourceBytes` → code-split, tree-shake, drop unused deps.
5. **Re-profile after the change** and compare against the baseline. Report the
   delta, not just the new number.

## Notes

- Metrics reflect the **current loaded document** (buffered entries), so always
  `navigate` fresh before profiling for a clean measurement.
- `totalBlockingTime` is an estimate derived from long tasks (sum of each long
  task's time over 50ms) — directionally aligned with field TBT/INP, not a lab
  Lighthouse score. Treat it as a signal, not a certified audit number.
- For real-user field data (true INP, real LCP distribution), pair this with the
  app's RUM/analytics — this tool measures one synthetic load.
