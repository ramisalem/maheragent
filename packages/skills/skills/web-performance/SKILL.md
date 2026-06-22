---
name: web-performance
description: Interpret web-app performance and propose grounded optimizations. NOTE — the dedicated profiling tool is not yet wired into maheragent; this skill documents the intended flow and what you can and cannot do today. Use when the user asks about page performance, Core Web Vitals, or load/render speed.
---

# Web performance

> **Status: pending.** maheragent does not yet expose a profiling tool
> (Lighthouse / CDP traces are a planned addition). Until it does, **do not call a
> `performance`/`profile` tool — it does not exist.** Be explicit with the user
> about this limit instead of fabricating metrics.

## What you can do today

- `navigate` to the page and `describe` / `screenshot` to confirm it renders and is
  interactive. This is functional verification, **not** a performance measurement.
- Reason about likely performance issues from the **source code** (bundle size,
  blocking resources, image dimensions, render-blocking CSS/JS, waterfalls) and
  propose changes — but label these as code-review hypotheses, not measured
  findings.
- If the user already has real numbers (a Lighthouse run, DevTools trace, RUM/Core
  Web Vitals from their analytics), interpret those and tie recommendations to them.

## What you must not do

- Do not report LCP / CLS / INP / TBT values as if measured — there is no tool that
  produces them here yet.
- Do not claim a change improved performance without a before/after measurement from
  a real source.

## Intended flow (once a profiling tool lands)

1. Capture a **baseline** before any change, so improvement is measurable.
2. Summarize the key signals — Core Web Vitals (LCP, CLS, INP), long tasks, heavy
   network/render work.
3. Propose concrete optimizations tied to what the profile actually showed.
4. Re-profile after the change and compare against the baseline.
