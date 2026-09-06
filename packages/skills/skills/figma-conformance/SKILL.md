---
name: figma-conformance
description: Check that a rendered web page matches its Figma design — render the page at the frame's width, ground every claim in computed styles vs Figma variables, report Discrepancies, and optionally run a fix loop until it conforms. Use when the user asks whether the built UI matches the design, mentions Figma + a page/URL, or asks to make a page match its design.
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
  `get_variable_defs` for a frame. The installer registers the **Figma Dev Mode**
  server (`figma-dev-mode`) automatically; it only responds while the **Figma
  desktop app is running with Dev Mode MCP enabled**, so make sure that's open.
- **maheragent** — drives the page: `navigate`, `set-viewport`, `describe`, `find`,
  `screenshot`, `extract-styles`, `compare-styles`.

You also need: the running page's **URL**, and the **Figma frame link** for the
same page. If either is missing, ask for it — do not guess.

## Procedure

### 1. Establish the Design Source
Confirm the Figma frame link for the exact page under check. One frame ↔ one page.

### 2. Pull the design facts (Figma MCP)
- `get_screenshot` — the reference image of the frame.
- `get_variable_defs` — the design variables in play (color/spacing/type tokens),
  e.g. `color/primary = #1A73E8`, `space/4 = 16px`, `font/body = Inter 400 16/24`.
- `get_design_context` — structure, intent, **and the frame's width** (e.g. 1440
  desktop, 390 mobile), to help pair elements in step 4.

### 3. Render the Target at the frame's size (maheragent)
- `set-viewport` `{ "width": <frame width>, "height": <frame height> }` — a layout
  measured at the wrong breakpoint produces Discrepancies that are not real. Add
  `"colorScheme": "dark"` when checking a dark-mode frame.
- `navigate` `{ "url": "<page URL>" }` — returns the page view: `url`, `title`, and
  `elements` (interactables and headings, each with a stable **Element Ref** `e1`,
  `e2`, …, a role, a name, and a viewport `box`).
- `describe` `{ "content": true }` — adds paragraphs, list items, cells, labels, and
  images: the body copy and media a design specifies most precisely.
- `screenshot` `{}` — the rendered image, delivered as an image you can set beside
  the Figma screenshot. `{ "ref": "e12" }` crops to one element.
- `wait-for` `{ "idle": true }` first if the page is still loading data.

### 4. Pair elements
Pair each meaningful Figma element to a rendered element using the two screenshots
plus the element list (match by role, text/accessible name, and position). When
a design element has no Ref yet — a card container, a divider, a hero image — use
`find` `{ "selector": ".hero" }` or `{ "text": "Start free trial" }` to tag it.
State each pairing so it can be checked.

### 5. Ground each pairing
For every paired element, use **`compare-styles`** `{ "ref": "<ref>", "expected":
{ ...design values } }`. Pass the Figma values directly (hex colors, px sizes,
weight names like "Medium") — the tool normalizes units for you (hex↔rgb, px,
weight names↔numbers) and returns a deterministic per-property pass/fail report
with `conforms`, `matched`/`total`, and a `comparisons` list. This replaces
eyeballing the diff.

`compare-styles` measures **every** property you put in `expected`, so you are
never limited to a fixed list — assert whatever the design specifies.

`extract-styles` `{ "ref": "<ref>" }` is still available when you want the raw
computed values. By default it returns `color`, `backgroundColor`, `fontFamily`,
`fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `textAlign`, `padding`,
`margin`, `borderRadius`, `width`, `height`, `display`, plus the per-side border
values (`borderBottomWidth`, `borderBottomColor`, …). Add anything else with
`properties`, e.g. `{ "ref": "e9", "properties": ["gap", "outlineColor", "--brand"] }`
— names may be camelCase or CSS spelling, and custom properties work.

> **If a measurement looks impossible — a 0px border on an element that clearly
> has an underline, or a color you never set — the Ref is probably not the
> styled node.** Component libraries put the ARIA role on an inner element while
> the styles sit on a wrapper: MUI marks `role="tablist"` on
> `.MuiTabs-flexContainer` but applies `sx` to `.MuiTabs-root`. Re-run with
> `closest` to retarget: `{ "ref": "e9", "closest": ".MuiTabs-root", "expected": {…} }`.
> Both tools accept it, and a selector that matches no ancestor returns
> `stale_ref` rather than a wrong number. Do this **before** filing a
> Discrepancy — otherwise you report a design bug that does not exist.

For **layout/position** conformance (spacing, alignment, size), read each
element's `box` (`{ x, y, width, height }`, viewport pixels at the viewport you
set) and compare against the Figma node's bounds.

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
Summarize: conforms / N discrepancies, with the table, and the viewport you checked
at. **Default is report-only.** Do not edit source unless the user explicitly asked
you to fix it.

### 8. Conformance Loop (only when asked to fix)
When — and only when — the developer asks you to make it match:
1. Edit the code to address the highest-severity Discrepancies first.
2. Re-render: `navigate` to the page again (or reload) so the new build is live;
   `wait-for` `{ "idle": true }` if it hydrates.
3. Re-ground: `compare-styles` on the affected elements (fresh Refs — they are
   renumbered by each page view).
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
