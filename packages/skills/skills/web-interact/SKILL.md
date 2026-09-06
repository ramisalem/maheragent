---
name: web-interact
description: Drive a web app over the maheragent MCP — perceive the page as a list of elements with stable Element Refs, act by Ref, and read the page that comes back after every action. Use when the user wants the agent to operate, click through, fill, log in to, or inspect a running web app in the browser.
---

# Web interaction

The maheragent daemon owns a **Browser Session** that persists across calls — it
carries cookies, auth, tabs, and navigation state — so a multi-step task stays on
the same page in the same session. **Perceive before you act, and read what each
action returns before acting again.**

## The loop

1. **Navigate.** `navigate` `{ "url": "<url>" }`.
2. **Perceive.** Every result carries a **Page View**: `{ url, title, elements }`.
   Each element is `{ ref, role, name, value?, box, frame?, disabled?, checked? }`.
   The **Element Ref** (`e1`, `e2`, …) is the handle you target.
3. **Act by Ref** — and read the Page View that comes back:
   - `click` `{ "ref": "e2" }`
   - `type` `{ "ref": "e3", "text": "hello" }` — replaces the field; `"clear": false`
     appends, `"submit": true` presses Enter afterwards.
   - `select-option` `{ "ref": "e5", "label": "Two" }` — native `<select>` only;
     custom dropdowns are plain elements, click them.
   - `hover`, `press-key` `{ "key": "Escape" }`, `drag` `{ "ref": "e7", "toRef": "e9" }`,
     `upload-file` `{ "ref": "e4", "paths": ["/abs/file.png"] }`
   - `scroll` `{ "ref": "e9" }` brings an element into view; `{ "ref": "e9", "dy": 400 }`
     scrolls *inside* it (lists, panes); `{ "dy": 600 }` scrolls the page.
4. **Confirm from the result.** The action's own Page View shows the new `url`,
   `title`, and elements — a navigation, a revealed form, an error banner. You
   rarely need a separate `describe`; call it only to refresh Refs after something
   changed without an action of yours, or `screenshot` `{}` for a visual check
   (it arrives as an image you can look at).

Refs are renumbered by every `describe` and by the Page View after each action.
Use Refs from the **latest** view. A Ref that is gone fails immediately with
`stale_ref` — take a fresh view, don't retry.

## Waiting

Never poll with `describe` or `screenshot` in a loop. Use **`wait-for`**:

- `{ "text": "Order confirmed" }` — until visible text appears (default `state: visible`;
  also `hidden`, `attached`, `detached`; `ref` or CSS `selector` work too).
- `{ "idle": true }` — until the DOM stops changing (spinners done, list rendered).
  It reports `settled: false` instead of failing when the page keeps moving.
- Element waits fail after `timeoutMs` (default 10 s); raise it for slow backends.

## Reaching elements `describe` does not list

`describe` lists interactables, headings, and (with `"content": true`) paragraphs,
list items, cells, labels, and images. For anything else — a `.hero` card, a
`<p>`, an image — use **`find`**:

- `find` `{ "selector": ".pricing .card" }` or `{ "text": "Welcome back" }` (or both).
- It tags the matches with new Refs and keeps existing Refs valid.

Both `describe` and `find` pierce open shadow roots and same-origin iframes; an
element inside an iframe carries `frame: "<the iframe's ref>"` and is targetable
like any other. Cross-origin iframes are unreachable by design.

## Tabs, popups, credentials, state

- **Popups / target=_blank.** The action's Page View lists `openedTabs: ["t2"]`.
  Every tool acts on the active tab, so `tabs` `{ "action": "select", "tab": "t2" }`
  to follow it; `{ "action": "list" }`, `"new"`, `"close"` as needed.
- **Credentials.** Never paste a secret into `type`. Write `{{secret:NAME}}` —
  the daemon substitutes `MAHERAGENT_SECRET_NAME` (env) or `NAME=` from
  `.maheragent/secrets.env`; the plaintext never enters your context. `maheragent
  secrets` lists the names available. Password fields always report `"***"`.
- **Seed or inspect state** without clicking through it: `cookies` (get/set/delete/clear,
  HttpOnly included), `storage` (localStorage / sessionStorage), and `evaluate`
  `{ "expression": "window.__STORE__.getState().user" }` — with `ref`, `el` is the
  element: `{ "ref": "e9", "expression": "el.scrollHeight" }`.
- **Viewport.** `set-viewport` `{ "width": 390, "height": 844 }` for a mobile layout,
  `{ "colorScheme": "dark" }` for dark mode.

## Accessibility tree first, coordinates as fallback (ADR-0003)

Prefer Refs — they come from the page's semantics, so they survive restyling and
layout shifts. Fall back to coordinate clicking only when no usable Ref exists
(a `<canvas>`, custom-drawn UI): `click` `{ "x": 320, "y": 210 }` in viewport pixels
(element `box` values are in the same space). `click` takes **either** a `ref` **or**
`x`+`y`, never both.

If a click focuses an element but nothing happens (a virtualized grid re-rendering
between mousedown and mouseup), retry with `"mode": "js"`.

## Notes

- Pass `"observe": false` to any action when you will not read its Page View (a
  burst of keystrokes, filling ten fields) — it saves the settle-and-describe.
- One Browser Session per task; `session: "<name>"` starts another isolated browser.
  Close it with `sessions` `{ "action": "close", "session": "<name>" }` when done.
- `get-console-logs` and `get-network-log` `{ "minStatus": 400 }` explain why a
  page misbehaved; each error entry carries the response body.
