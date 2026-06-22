---
name: figma-conformance
description: Check that a rendered web page matches its Figma design — render the page, ground every claim in computed styles vs Figma variables, report Discrepancies, and optionally run a fix loop until it conforms. Use when the user asks whether the built UI matches the design, mentions Figma + a page/URL, or asks to make a page match its design.
---

# Figma conformance

Decide whether a **Target** (a rendered web page) matches its **Design Source** (a
Figma frame), and — only when asked — fix the code until it does. The verdict is
*your* visual judgment, but every claim must be **grounded** in objective evidence:
the page's computed styles versus the frame's design variables. Conformance is
**page/frame-level**, not component-level.

## Preconditions

Two MCP servers must be connected — confirm both before starting:

- **Figma MCP** — provides the design: `get_design_context`, `get_screenshot`,
  `get_variable_defs` for a frame.
- **maheragent** — drives the page: `navigate`, `describe`, `screenshot`,
  `extract-styles`.

You also need: the running page's **URL**, and the **Figma frame link** for the
same page. If either is missing, ask for it — do not guess.

## Procedure

### 1. Establish the Design Source
Confirm the Figma frame link for the exact page under check. One frame ↔ one page.

### 2. Pull the design facts (Figma MCP)
- `get_screenshot` — the reference image of the frame.
- `get_variable_defs` — the design variables in play (color/spacing/type tokens),
  e.g. `color/primary = #1A73E8`, `space/4 = 16px`, `font/body = Inter 400 16/24`.
- `get_design_context` — structure and intent, to help pair elements in step 4.

### 3. Render the Target (maheragent)
- `navigate` `{ "url": "<page URL>" }` — load the page.
- `screenshot` `{}` — the rendered image, to set beside the Figma screenshot.
- `describe` `{}` — enumerate interactable elements, each with a stable **Element
  Ref** (`e1`, `e2`, …), role, and name.

### 4. Pair elements
With no component mapping in v1, pair each meaningful Figma element to a rendered
element using the two screenshots plus `describe` output (match by role, text/
accessible name, and position). State each pairing so it can be checked.

### 5. Ground each pairing
For every paired element, use **`compare-styles`** `{ "ref": "<ref>", "expected":
{ ...design values } }`. Pass the Figma values directly (hex colors, px sizes,
weight names like "Medium") — the tool normalizes units for you (hex↔rgb, px,
weight names↔numbers) and returns a deterministic per-property pass/fail report
with `conforms`, `matched`/`total`, and a `comparisons` list. This replaces
eyeballing the diff.

`extract-styles` `{ "ref": "<ref>" }` is still available when you want the raw
computed values; it returns: `color`, `backgroundColor`, `fontFamily`,
`fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `textAlign`, `padding`,
`margin`, `borderRadius`, `borderTopWidth`, `borderColor`, `width`, `height`,
`display`.

For **layout/position** conformance (spacing, alignment, size), read each
element's `box` (`{ x, y, width, height }`) from `describe` and compare against
the Figma node's bounds.

### 6. Judge → Discrepancies
Produce a structured **Discrepancy** list. For each one:

| Element (ref · name) | Property | Expected (design) | Actual (computed) | Severity |
|---|---|---|---|---|
| `e2` · "Continue" button | backgroundColor | `color/primary` `#1A73E8` | `rgb(33, 118, 240)` | high |

Severity: **high** = wrong token / clearly off (color, size, spacing); **low** =
sub-pixel or rounding-level. If a difference is visible in the screenshots but you
could not measure it via a style property, label it **visual-only (unverified)** —
never present an ungrounded guess as a fact.

### 7. Report — and stop here by default
Summarize: conforms / N discrepancies, with the table. **Default is report-only.**
Do not edit source unless the user explicitly asked you to fix it.

### 8. Conformance Loop (only when asked to fix)
When — and only when — the developer asks you to make it match:
1. Edit the code to address the highest-severity Discrepancies first.
2. Re-render: `navigate` to the page again (or reload) so the new build is live.
3. Re-ground: `extract-styles` on the affected elements.
4. Re-check against the design variables.
5. Repeat until the page conforms or a pass yields no improvement. **Cap at ~5
   iterations**; if not converging, report what remains and why. Never commit or
   push unless explicitly told to.

## Grounding rules (normalization)

The design speaks in tokens; the browser speaks in resolved values. Convert before
you compare, or you will report false discrepancies:

- **Color** — Figma `#1A73E8` ↔ computed `rgb(26, 115, 232)`. Convert hex→rgb (or
  back) and compare numerically; allow ±1 per channel for rounding. Watch alpha
  (`rgba`).
- **Length** — Figma `16` / `16px` ↔ computed `16px`. Compare as numbers. `rem`
  resolves against root font-size.
- **Font weight** — Figma "Medium" ↔ computed `500`; "Regular" ↔ `400`; "Bold" ↔
  `700`.
- **Line height** — Figma `24` (absolute) ↔ computed `24px`; a unitless CSS value
  multiplies font-size.
- **Shorthands** — computed `padding`/`margin` come back as up to four values
  (top right bottom left); map to the design's per-side spacing tokens.

A Discrepancy is real only after normalization still shows a gap.

## Guardrails

- **Read-only oracle by default.** Editing source is hard to reverse — get explicit
  permission first (ADR-0002).
- **maheragent stays design-source-agnostic.** It never holds a Figma token; all
  design facts come through the Figma MCP. Don't try to make the daemon fetch Figma.
- **Page/frame-level only** in v1. Component-library mapping / Code Connect is a
  later enhancement.
