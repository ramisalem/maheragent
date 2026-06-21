# Maher Agent

An agentic toolkit that gives your AI assistant direct control over your **web** app — navigating, interacting, inspecting, and verifying it against its **Figma** design — over MCP, without leaving your editor.

## Capabilities

- **Drive the browser** — navigate, click, type, scroll, and inspect a running web app the way a user would.
- **See the page** — a structured accessibility-tree view (`describe`) plus screenshots, with coordinate fallback.
- **Figma conformance** — check that a rendered page matches its Figma frame, grounded by real computed styles vs design variables, and optionally fix the code until it conforms.
- **Diagnostics & performance** — read console and network logs, and profile performance.

## Architecture

```
Agent (editor over MCP)
  -> @ramisalem/mcp          MCP <-> tool-server adapter
  -> @ramisalem/tool-server  long-running daemon: registry + BrowserSession (Playwright) + tools
  -> @ramisalem/registry     URN-keyed resolution of a tool's service dependencies
```

See `CONTEXT.md` for the glossary and `docs/adr/` for the architecture decisions.

## Packages

| Package | Role |
| --- | --- |
| `@ramisalem/registry` | URN-keyed registry: resolves a tool's services and runs it |
| `@ramisalem/configuration-core` | Feature flags (global + project) |
| `@ramisalem/update-core` | Self-update logic |
| `@ramisalem/telemetry` | Anonymous, opt-out telemetry |
| `@ramisalem/tool-server` | Daemon: BrowserSession blueprint + perception/interaction/diagnostics/performance tools |
| `@ramisalem/mcp` | MCP adapter |
| `@ramisalem/cli` | CLI subcommands |
| `@ramisalem/installer` | Workspace install + editor MCP registration |
| `@ramisalem/skills` | Skills installed into the workspace |
| `maheragent` | Published thin CLI dispatcher |
