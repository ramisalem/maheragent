# Maher Agent

Maher Agent is an agentic toolkit that gives an AI assistant direct control over a **web** application — navigating, interacting, inspecting, and verifying it against its **Figma** design — over MCP, without the developer leaving their editor.

## Language

### Core architecture

**Tool**:
A single named, agent-callable operation (e.g. `navigate`, `click`, `screenshot`, `check-conformance`). Has a typed input schema and may be gated by a Feature Flag.
_Avoid_: command, action, function

**Registry**:
The stateless resolver that, for a given Tool call, instantiates the Services that Tool depends on (keyed by URN) and runs it. Holds no business logic itself.
_Avoid_: container, manager

**Blueprint**:
A factory plus lifecycle definition for one kind of Service. The Registry uses a Blueprint to create and reuse Service instances.
_Avoid_: provider, builder

**Service**:
A long-lived stateful object the Registry keeps alive across Tool calls (e.g. a Browser Session). Produced by a Blueprint, identified by a URN.

**URN**:
The stable identity of a Service instance (e.g. `BrowserSession:<sessionId>`). How the Registry caches and reuses a live Service.

**Tool-server**:
The long-running local daemon that owns the Registry and every live Service (including the browser). Outlives any single editor connection so the browser and its state persist across reconnects, and can be shared with the CLI.
_Avoid_: backend, server (unqualified)

### Web target

**Browser Session**:
The live, persistent browser the agent drives. Keyed by URN; carries cookies, navigation state, tabs, and viewport across Tool calls. Every Tool acts on the Session's active Tab.
_Avoid_: page (a narrower sub-part of a Session), instance

**Tab**:
One page inside a Browser Session, identified as `t1`, `t2`, …. Popups and `target=_blank` links open new Tabs, which the next Page View announces; the agent switches Tabs explicitly.
_Avoid_: window, target

**Target**:
The web app under inspection: primarily the developer's running local dev server, with any arbitrary URL as a superset.
_Avoid_: site, app under test, SUT

**Describe**:
The Tool that returns the agent's structured view of a screen — the interactable elements (and, on request, content elements: paragraphs, cells, labels, images) from the page's semantics, each annotated with role, name, box, and a stable Element Ref. Pierces open shadow roots and same-origin iframes. The agent's primary way of "seeing" a page, paired with a screenshot for visual grounding.
_Avoid_: snapshot, dump, a11y dump

**Find**:
The Tool that tags elements matching a CSS selector or a text substring with Element Refs, without renumbering the Refs already on the page. How the agent reaches an element Describe does not list.
_Avoid_: query, search

**Element Ref**:
The stable handle for one perceived element returned by Describe or Find, valid until the next Page View renumbers it. Interaction Tools target an Element Ref; coordinate-based targeting is the fallback when no usable Ref exists. A Ref that no longer resolves is *stale* and fails fast.
_Avoid_: selector, locator, handle (unqualified)

**Page View**:
What the agent sees after perceiving or acting: the Tab's `url` and `title` plus a fresh element list (and any Tabs opened meanwhile). Every interaction Tool returns one, so the next action needs no separate Describe.
_Avoid_: snapshot, state dump

**Secret Placeholder**:
A `{{secret:NAME}}` token inside typed text. The Tool-server substitutes the value from its own environment or a secrets file, so the plaintext never enters the agent's context or transcript.
_Avoid_: variable, env var (unqualified)

### Figma conformance

**Design Source**:
The design a piece of built UI is supposed to match — the source of truth a Target is checked against. Supplied per check as a frame-level reference; the concept is design-tool-agnostic, with Figma as the first (and currently only) provider.
_Avoid_: mock, spec, reference (unqualified)

**Conformance Check**:
A single read-only judgment of whether — and where — a rendered Target diverges from its Design Source. The verdict is the agent's visual judgment, grounded by extracted Target styles compared against the Design Source's variables. It never edits anything.
_Avoid_: visual test, diff, snapshot test

**Discrepancy**:
One reported divergence between a Target and its Design Source (e.g. "heading weight 400, design says 600"). The Conformance Check returns a structured list of these.
_Avoid_: failure, error, mismatch

**Grounding**:
The act of attaching objective evidence — Target computed styles (color, spacing, type, radius) versus Design Source variables — to a Conformance Check so the agent's visual judgment is anchored in fact rather than impression.

**Conformance Loop**:
The opt-in workflow of render → Conformance Check → fix the code → re-render → re-check, repeated until the Target conforms. Lives in a skill, never in a Tool, and runs only when the developer explicitly asks to fix (default is report-only).
_Avoid_: auto-fix, self-heal

### Flows

**Flow**:
A recorded sequence of steps against a Target, stored as YAML under `.maheragent/flows/` and replayed by the agent or by the CLI. Steps name elements by stable handles (text, role + name, selector), never by Element Ref. A failed step stops the replay; later steps are skipped.
_Avoid_: script, test (unqualified), macro

**Snapshot**:
A Flow step that compares the current capture with a baseline PNG kept under `.maheragent/baselines/<flow>/`. Baselines are adopted explicitly (`updateBaselines`), never silently.
_Avoid_: golden, reference image

**Recording**:
The act of building a Flow one step at a time while each step runs live on the Browser Session; only steps that pass are kept. Not retroactive.
_Avoid_: capture, macro recording

### Skills

**Skill**:
A curated markdown guide installed into the developer's workspace that teaches the agent how to use a cluster of Tools to accomplish a goal. The unit of orchestration; where loops and judgment live (Tools stay oracles). Ships five: `web-interact`, `figma-conformance` (the Conformance Loop), `web-performance`, `visual-regression`, and `web-flows`.
_Avoid_: playbook, guide, prompt
