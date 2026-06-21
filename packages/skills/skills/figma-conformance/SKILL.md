---
name: figma-conformance
description: Check that a rendered page matches its Figma design, and optionally fix the code until it does.
---

# Figma conformance

This skill needs two MCP servers connected: the **Figma MCP** and **Maher Agent**.

1. **Establish the Design Source.** Ask for (or confirm) the Figma frame link for the page you're checking. Conformance is page/frame-level.
2. **Render the Target.** Navigate to the page, then capture `screenshot` and `extract-styles` (computed color/spacing/type/radius) from Maher Agent.
3. **Pull the design.** From the Figma MCP, fetch `get_screenshot` and `get_variable_defs` for that frame.
4. **Judge, grounded.** Compare the two screenshots visually, but anchor every claim in the extracted styles vs the Figma variables. Report a structured list of **Discrepancies** (what diverged, the actual vs expected value, where).
5. **Fix only on request.** If — and only if — the developer asked you to fix it, run the **Conformance Loop**: edit the code, re-render, re-check, and repeat until the page conforms. Otherwise stop at the report.

Default is report-only. Never auto-edit source unless explicitly asked.
