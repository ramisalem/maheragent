---
name: web-interact
description: Drive the browser to navigate and interact with the web app under inspection.
---

# Web interaction

To act on a page, first *see* it:

1. Call `describe` to get the interactable elements — each has a role, a name, and a stable **Element Ref**.
2. Target interactions (`click`, `type`, `scroll`, `hover`, `press-key`) by **Element Ref**.
3. Only fall back to screenshot + coordinates when no usable Ref exists (canvas, custom-drawn UI).
4. After navigation or any state-changing interaction, take a `screenshot` to confirm the result before continuing.

Keep one Browser Session per task; it carries cookies and navigation state across calls.
