# Figma conformance is an agent-judged skill orchestrating two MCP servers, not a daemon tool

The differentiating capability — checking that built web UI matches its Figma design — is defined as the agent's **LLM visual judgment**, grounded by objective evidence (Target computed styles vs Figma variables), rather than a pixel-diff gate or a pure token comparison. Because the verdict is an LLM judgment, it must be produced by the agent, so the capability lives in a **skill** that orchestrates two MCP servers the agent holds at once — the official Figma MCP (`get_screenshot`, `get_variable_defs`, `get_design_context`) and Maher Agent (its `screenshot` plus a read-only `extract-styles` grounding tool). The Maher Agent daemon therefore stays **design-source-agnostic** and never holds a Figma token or an LLM key.

## Consequences

- The Design Source is supplied per check as a page/frame-level Figma link (no mapping infrastructure required for v1; a mapping file and Code Connect are later enhancements). Confirmed appropriate for the team's apps, which are page/frame-shaped rather than component-library-shaped.
- The Conformance Check is a read-only oracle returning a structured Discrepancy list; the render→check→fix→re-check **Conformance Loop** lives in the skill and runs only when the developer explicitly asks to fix. Default is report-only, because auto-editing source is hard to reverse.
- Adding another design-source provider later means writing another skill, not touching the daemon.
