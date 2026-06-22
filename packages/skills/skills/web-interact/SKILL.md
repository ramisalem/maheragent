---
name: web-interact
description: Drive a web app over the maheragent MCP — perceive the page via the accessibility tree, then navigate and interact by stable Element Ref. Use when the user wants the agent to operate, click through, fill, or inspect a running web app in the browser.
---

# Web interaction

The maheragent daemon owns one **Browser Session** that persists across calls — it
carries cookies, auth, and navigation state — so a multi-step task stays on the
same page in the same session. Always **perceive before you act**.

## The loop

1. **Navigate.** `navigate` `{ "url": "<url>" }` → returns `{ url, title }`.
2. **Perceive.** `describe` `{}` → an array of elements, each
   `{ ref, role, name, value? }`. The **Element Ref** (`e1`, `e2`, …) is the handle
   you target. Refs are valid for the current page state; after a navigation or a
   state change, call `describe` again to get fresh Refs.
3. **Act by Ref** (preferred — robust to layout shifts):
   - `click` `{ "ref": "e2" }`
   - `type` `{ "ref": "e3", "text": "hello" }` — replaces the field by default; add
     `"clear": false` to append.
   - `hover` `{ "ref": "e4" }`
   - `scroll` `{ "ref": "e9" }` — bring an element into view, or `{ "y": 600 }` to
     scroll the page by a delta.
   - `press-key` `{ "key": "Enter" }` — also `"Escape"`, `"Tab"`, `"ArrowDown"`, …
4. **Confirm.** After navigation or any state-changing action, call `describe`
   again (or `screenshot` `{}` for a visual check) before continuing.

## Accessibility tree first, coordinates as fallback (ADR-0003)

Prefer Refs from `describe` — they come from the accessibility tree, so they
survive restyling and minor layout changes. Fall back to coordinate clicking only
when no usable Ref exists (e.g. a `<canvas>` or custom-drawn UI):

- `click` `{ "x": 320, "y": 210 }` — raw viewport coordinates.

`click` takes **either** a `ref` **or** `x`+`y`, never both. Reach for coordinates
only after `describe` shows the target isn't reachable as an element.

## Notes

- One Browser Session per task; don't expect a fresh page between calls — navigate
  explicitly when you need one.
- `screenshot` returns a base64 PNG — use it to verify results or to feed visual
  judgment (e.g. the `figma-conformance` skill), not as a substitute for `describe`
  when a Ref would do.
