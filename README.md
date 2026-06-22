# maheragent

**An agentic toolkit that gives an AI assistant direct control of a web app over [MCP](https://modelcontextprotocol.io) — and checks the result against your Figma design.**

The agent navigates, perceives, and interacts with a real browser, then grounds
design-conformance judgments in the page's actual computed styles versus your
Figma variables. Connect it to Claude Code, Cursor, or any MCP-capable editor.

---

## Why

Most "AI builds your UI" loops are blind — the model writes code and hopes. maheragent
closes the loop: the agent **drives the running page** (accessibility-tree-first, so it
acts on real elements, not guesses), and the **`figma-conformance` skill** compares what
rendered against the design frame, grounded in measured styles rather than vibes.

## Architecture

A thin MCP adapter talks to a long-running local daemon that owns the browser:

```
 Editor (Claude Code / Cursor / …)
        │  MCP over stdio
        ▼
 @ramisalem/mcp ──────────►  spawns / reuses
        │  HTTP (loopback, bearer)        │
        ▼                                 ▼
 @ramisalem/tool-server (daemon)  ◄── discovery file (~/.maheragent)
        │  owns
        ▼
 Registry ──► BrowserSession (Playwright, bundled Chromium)
```

- The **daemon is separate from the editor process**, so the browser — and its cookies,
  auth, and navigation state — survives editor restarts ([ADR-0001](docs/adr/0001-layered-tool-server-architecture.md)).
- **Figma conformance is a skill, not a daemon tool** — it orchestrates the Figma MCP and
  maheragent so the daemon never holds a Figma token or an LLM key ([ADR-0002](docs/adr/0002-conformance-as-agent-judged-skill-over-two-mcps.md)).
- Perception is **accessibility-tree-first** with a screenshot + coordinate fallback ([ADR-0003](docs/adr/0003-accessibility-tree-first-perception.md)).

See [`CONTEXT.md`](CONTEXT.md) for the domain glossary.

## Install

```bash
npm install -g @ramisalem/maheragent     # pulls Chromium via Playwright on install
```

Then, **from the web app you want the agent to drive**:

```bash
cd /path/to/your-web-app
maheragent init                 # registers the MCP server + copies skills
# maheragent init --editor cursor   # → .cursor/mcp.json
# maheragent init --editor vscode   # → .vscode/mcp.json
```

Restart your editor (or reload its MCP servers). The `maheragent` server appears with all
its tools. Then just ask:

> "Use maheragent to open http://localhost:3000, describe the page, and check it against
> this Figma frame: …"

## Tools

| Category | Tool | What it does |
|----------|------|--------------|
| Perception | `navigate` | Go to a URL; returns `{ url, title }` |
| | `describe` | Interactable elements, each with a stable **Element Ref** |
| | `screenshot` | Base64 PNG of the page |
| Interaction | `click` | By Element Ref, or `x,y` coordinate fallback |
| | `type` | Type into a field (replace or append) |
| | `hover` / `scroll` / `press-key` | Pointer, scroll, and keyboard |
| Conformance | `extract-styles` | Computed styles for a Ref — the grounding evidence |
| Diagnostics | `get-console-logs` | Console messages + uncaught page errors |
| | `get-network-log` | Network responses + failed requests |

## Skills

Copied into your workspace by `maheragent init`:

- **`figma-conformance`** — render the page, pair elements to the Figma frame, ground each
  comparison in computed styles vs Figma variables, report Discrepancies, and (only on
  request) run a capped fix loop. Read-only by default.
- **`web-interact`** — the perceive → act-by-Ref → confirm loop.
- **`web-performance`** — *pending* a profiling tool; documents the intended flow.

## CLI

The same daemon the editor uses is drivable from a terminal:

```bash
maheragent server status|start|stop      # inspect / control the daemon
maheragent tools [<name>]                # list tools, or show one tool's schema
maheragent run <tool> [json-args]        # call a tool directly
maheragent flags                         # list feature flags
maheragent enable|disable <flag> [--project]
maheragent init|remove [--editor …]      # editor registration
maheragent mcp                           # run the MCP adapter (what the editor launches)
```

Example:

```bash
maheragent run navigate '{"url":"http://localhost:3000"}'
maheragent run describe '{}'
maheragent run extract-styles '{"ref":"e2"}'
```

## Feature flags

Tools can be gated behind flags. Project flags (`<cwd>/.maheragent/flags.json`) override
global (`~/.maheragent/flags.json`); the daemon reads them live.

## Development

npm workspaces + TypeScript project references. Node ≥ 20.

```bash
npm install
npm run build          # tsc --build across all packages
npm test               # node:test across every workspace
```

### Packages

| Package | Role |
|---------|------|
| `@ramisalem/registry` | URN-keyed service registry; Blueprint / Tool contracts |
| `@ramisalem/tool-server` | The daemon: registry + BrowserSession + tools + HTTP |
| `@ramisalem/mcp` | MCP adapter; spawns/finds the daemon and bridges tools |
| `@ramisalem/cli` | `server`, `tools`, `run`, `flags` commands |
| `@ramisalem/installer` | Editor MCP registration + skill copy |
| `@ramisalem/configuration-core` | Feature-flag storage |
| `@ramisalem/skills` | The bundled skills |
| `maheragent` | Umbrella bin that routes the subcommands |

## License

MIT
