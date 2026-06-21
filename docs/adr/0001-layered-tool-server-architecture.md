# Layered tool-server / registry / blueprint architecture with a browser bridge

The agent reaches the web app through four layers: an MCP adapter → a long-running **tool-server** daemon → a URN-keyed **registry** → **blueprints** that drive the browser. We chose a separate daemon (rather than owning the browser inside the MCP process) because a browser must stay alive across many tool calls and editor reconnects, and a daemon lets the CLI share the same live browser and keeps remote routing possible. The browser itself is driven in-process via Playwright, exposed as a `BrowserSession` blueprint identified by `BrowserSession:<sessionId>`.

## Consequences

- We accept the daemon/registry scaffolding cost up front in exchange for a persistent, shareable browser and a clean separation between transport (MCP), orchestration (registry), and capability (blueprints/tools).
