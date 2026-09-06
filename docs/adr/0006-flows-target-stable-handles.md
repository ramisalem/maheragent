# Flows target stable handles and are replayed by the daemon, not by the agent

A recorded path through the app is only useful if it replays without the agent, so a **Flow** is a plain YAML file (`.maheragent/flows/<name>.yaml`) that the tool-server executes itself — from the `flow-run` Tool or from `maheragent flow run`, which exits non-zero for CI. Steps name elements by **stable handles** — visible text, role + accessible name, a label, or a CSS selector — resolved at replay time through the same `find`/`describe` machinery the agent uses. Element Refs are deliberately not allowed in a Flow: they are renumbered with every Page View and would break on the first re-render.

Recording is live: `flow-add-step` runs each step on the browser and keeps it only if it passed, so a finished Flow has been executed once already. Checks are explicit steps (`wait`, `assert`, `snapshot`); a failed step stops the Flow and the rest is reported as skipped, so a report reads top to bottom as "what happened".

We rejected recording pointer events (coordinates or DOM paths) because they break on layout and markup changes, and we rejected making the agent replay Flows step by step because the point of a Flow is to run where no agent is.

## Consequences

- Handles must be unique on the screen; the skill tells the agent to prefer role + name and to ask for a test id rather than record a brittle selector.
- Snapshot baselines live under `.maheragent/baselines/<flow>/` and are adopted only on request (`updateBaselines`), so a visual regression is a failing step, never a silently rewritten baseline.
- `tool` and `run` steps keep the format extensible (any Tool, any composed Flow) without growing the directive set for every case.
