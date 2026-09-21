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
npm install -g maheragent
```

Then, **from the web app you want the agent to drive**:

```bash
cd /path/to/your-web-app
maheragent init                 # registers the MCP server, copies skills, downloads Chromium
# maheragent init --editor cursor   # → .cursor/mcp.json
# maheragent init --editor vscode   # → .vscode/mcp.json
```

Playwright's npm package ships without browsers, so `init` downloads the Chromium build
that maheragent's Playwright pins (headless shell, once). With `--no-browser`, the
daemon downloads it on its first launch instead; `maheragent browser install` does it
on demand, for CI images or before going offline.

Restart your editor (or reload its MCP servers). The `maheragent` server appears with all
its tools. Then just ask:

> "Use maheragent to open http://localhost:3000, describe the page, and check it against
> this Figma frame: …"

## Tools

| Category | Tool | What it does |
|----------|------|--------------|
| Perception | `navigate` | Go to a URL; returns the **page view** — `url`, `title`, and the element list |
| | `describe` | Elements with a stable **Element Ref**, role, name, and box; `content: true` adds paragraphs, cells, labels, images |
| | `find` | Tag elements by CSS selector or text (for anything `describe` skips), keeping existing Refs valid |
| | `wait-for` | Wait for an element state, or for the DOM to go idle — instead of polling |
| | `screenshot` | PNG of the page or of one element, delivered as an image the model can see |
| | `set-viewport` | Resize to a Figma frame's width; emulate dark mode / reduced motion |
| Interaction | `click` | By Element Ref (or `x,y` fallback); `mode: "js"` for re-render races |
| | `type` | Fill a field; `{{secret:NAME}}` keeps credentials out of the agent's context |
| | `hover` / `scroll` / `drag` / `press-key` | Pointer, scroll (page or inside an element), drag-and-drop, keyboard |
| | `select-option` / `upload-file` | Native selects and file inputs |
| Conformance | `extract-styles` | Computed styles for a Ref — the grounding evidence |
| | `compare-styles` | Expected design values vs computed, normalized (hex↔rgb, px, weight names) |
| | `screenshot-diff` | Visual regression against a baseline PNG: mismatch ratio, changed regions and the elements they overlap, diff image |
| State | `evaluate` | Run a JS expression in the page (or against an element) |
| | `cookies` / `storage` | Read and write cookies (HttpOnly too), localStorage, sessionStorage |
| | `tabs` | List, select, open, close tabs; popups are announced as `openedTabs` |
| | `sessions` | List or close Browser Sessions |
| Flows | `flow-run` | Replay a recorded flow (or list them); one report entry per step |
| | `flow-start-recording` / `flow-add-step` / `flow-finish-recording` | Record a flow while each step runs live |
| Diagnostics | `get-console-logs` | Console messages + uncaught page errors, with source locations |
| | `get-network-log` | Network responses + failed requests; error bodies included |
| Performance | `profile-performance` | Core Web Vitals (LCP, CLS, FCP), estimated TBT, timing, resources |

Every interaction returns the page **after** the action (`url`, `title`, fresh
`elements`), so the next step needs no separate `describe`. Pass `observe: false`
to skip it, or enable the `disable-auto-describe` flag to turn it off globally.
`describe` and `find` pierce open shadow roots and same-origin iframes. A Ref that
is no longer on the page fails immediately with `stale_ref`.

## Skills

Copied into your workspace by `maheragent init`:

- **`figma-conformance`** — render the page, pair elements to the Figma frame, ground each
  comparison in computed styles vs Figma variables, report Discrepancies, and (only on
  request) run a capped fix loop. Read-only by default.
- **`web-interact`** — the perceive → act-by-Ref → confirm loop.
- **`visual-regression`** — baseline → change → `screenshot-diff`, reading the changed
  regions and the elements they overlap.
- **`web-flows`** — record a path as `.maheragent/flows/<name>.yaml` with stable targets,
  waits, asserts, and snapshots; replay it from the agent or from CI.
- **`web-performance`** — measure Core Web Vitals, tie every recommendation to a
  number, re-measure after the change.

## CLI

The same daemon the editor uses is drivable from a terminal:

```bash
maheragent server status|start|stop      # inspect / control the daemon
maheragent tools [<name>]                # list tools, or show one tool's schema
maheragent run <tool> [json-args]        # call a tool directly
maheragent flags                         # list feature flags
maheragent enable|disable <flag> [--project]
maheragent secrets                       # names {{secret:NAME}} can resolve (never values)
maheragent flow list                     # flows in .maheragent/flows/
maheragent flow run <name|path> [--update-baselines] [--json]   # exit 1 on failure
maheragent browser install [--headed]    # download the Chromium build the daemon launches
maheragent init|remove [--editor …] [--no-browser]   # editor registration; init also fetches Chromium
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

| Flag | Effect |
|------|--------|
| `disable-auto-describe` | Stop appending the element list to every action's result |

## Secrets

Type a credential without it ever entering the agent's context:

```json
{ "ref": "e4", "text": "{{secret:APP_PASSWORD}}" }
```

The daemon resolves the name from, in order: `MAHERAGENT_SECRET_APP_PASSWORD` in
its environment; `<project>/.maheragent/secrets.env` (every key — gitignore it);
`<project>/.env.local` / `.env` (only `MAHERAGENT_SECRET_*` keys); `~/.maheragent/secrets.env`.
`maheragent secrets` lists the names and sources. Password fields always report `***`.

## Flows

Record a path once — `flow-start-recording`, `flow-add-step` per step (each runs
live and is kept only if it passes), `flow-finish-recording` — and replay it from the
agent (`flow-run`) or from a terminal or CI job:

```yaml
# .maheragent/flows/login.yaml
steps:
  - navigate: http://localhost:3000/login
  - type: { into: { label: Email }, text: user@example.com }
  - type: { into: { label: Password }, text: "{{secret:APP_PASSWORD}}", submit: true }
  - wait: { text: Dashboard }
  - assert: { url: { contains: /dashboard } }
  - snapshot: dashboard        # vs .maheragent/baselines/login/dashboard.png
```

```bash
maheragent flow run login                     # prints one line per step, exits 1 on failure
maheragent flow run login --update-baselines  # adopt the current snapshots
```

Steps target elements by text, role + name, label, or CSS selector — never by
Element Ref — so a recording survives re-renders. `wait`, `assert`, `snapshot`,
`tool`, and `run` (compose another flow) cover checks, visual baselines, and reuse.

## Watching the browser

The daemon runs Chromium headless. Start it with `MAHERAGENT_HEADED=1` to watch the
agent work in a real window. That needs full Chromium, which the first headed launch
downloads (or run `maheragent browser install --headed` beforehand).

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
