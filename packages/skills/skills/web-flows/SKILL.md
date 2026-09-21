---
name: web-flows
description: Record a path through a web app as a maheragent flow and replay it deterministically — by the agent or by `maheragent flow run` in CI. Use when the user wants a repeatable reproduction, a smoke test, a regression check per branch, or to keep a long path they just walked through with you.
---

# Flows

A **flow** is a YAML list of steps in `.maheragent/flows/<name>.yaml`. Steps target
elements by **stable handles** — visible text, role + name, a CSS selector — never
by Element Ref (Refs live for one page state). Record it once while the steps run
live; replay it any number of times. A failed step stops the flow and the rest is
reported as skipped.

## Recording

Recording is not retroactive: start **before** the first action of the path.

1. `flow-start-recording` `{ "name": "checkout", "description": "Cart to order confirmation" }`
2. For every step: `flow-add-step` `{ "step": { … } }`. The step runs live on the
   browser. It is recorded **only if it passes**, and the result carries the page
   view after it, so you never need a separate `describe` between steps.
3. `flow-finish-recording` `{}` writes the file. `{ "discard": true }` throws it away.

Pick handles from the page view you already have. Preference order:

| Handle | Example | Use when |
|---|---|---|
| role + name | `{ "role": "button", "name": "Place order" }` | the accessible name is unique for that role |
| label | `{ "label": "Email" }` | form fields (matches the accessible name) |
| text | `"Place order"` or `{ "text": "order" }` | the visible text is unique on the screen |
| selector | `{ "selector": "[data-testid=submit]" }` | nothing above is unique; a test id is best |

Never record coordinates. If nothing is unique, ask for a test id rather than
guessing a brittle selector.

## Steps

```yaml
description: Log in and reach the dashboard
steps:
  - set-viewport: { width: 1280, height: 800 }
  - navigate: http://localhost:3000/login
  - type: { into: { label: Email }, text: user@example.com }
  - type: { into: { label: Password }, text: "{{secret:APP_PASSWORD}}", submit: true }
  - wait: { text: Dashboard }                     # identity: only the destination has it
  - wait: { idle: true }                          # readiness: the DOM stopped changing
  - assert: { url: { contains: /dashboard } }
  - assert: { text: { in: { selector: .greeting }, contains: Welcome } }
  - click: { role: button, name: Settings }
  - assert: { hidden: Wrong password }
  - snapshot: settings                            # vs .maheragent/baselines/login/settings.png
  - echo: Settings reached
  - tool: { name: cookies, args: { action: get } } # any maheragent tool
  - run: shared/logout                            # another flow file, relative to this one
```

| Directive | Shape |
|---|---|
| `navigate` | URL |
| `click` / `hover` | target |
| `type` | `{ into: target, text, clear?, submit? }` — `{{secret:NAME}}` placeholders are resolved on the daemon and redacted in reports |
| `press-key` | key or chord (`Escape`, `Control+a`) |
| `select-option` | `{ in: target, value? \| label? \| index? }` |
| `scroll` | target, or `{ target?, dx?, dy? }` |
| `wait` | `{ text }`, `{ selector }`, `{ target, state: visible\|hidden }`, and/or `{ idle: true, stableMs? }`; `timeoutMs` default 10000 |
| `assert` | `{ visible \| hidden: target }`, `{ text: { in: target, contains \| equals \| matches } }`, `{ url \| title: { contains \| equals \| matches } }`; a 1 s grace, `timeoutMs` to extend |
| `snapshot` | name, or `{ name, target?, maxMismatch?, fullPage? }` |
| `set-viewport` | `{ width?, height?, colorScheme? }` |
| `echo` | message printed in the report |
| `tool` | `{ name, args }` — escape hatch to any tool |
| `run` | path of another flow (`.yaml` optional), relative to this file |

## Prove every screen change

Two checks after each navigation: an **identity** wait on something only the
destination shows, then an **idle** wait so later checks read a settled screen.
A negative check (`hidden`) passes on the wrong screen too — establish the same
handle as `visible` earlier in the flow before asserting it `hidden`.

## Snapshots

`snapshot: name` compares the viewport (or `target`) with
`.maheragent/baselines/<flow>/<name>.png`. The first run has no baseline: replay with
`updateBaselines: true` (CLI `--update-baselines`) to adopt the capture, review it,
commit it. A later mismatch fails the step with the ratio, the changed regions, and
a diff image path. Keep `maxMismatch` tiny (`0.001`) for anti-aliasing noise only.
Same viewport, same color scheme, same data every run — or the snapshot is noise.

## Replaying

- Agent: `flow-run` `{ "name": "login" }` — returns the report with one entry per
  step (`pass`, `fail`, `skip`, `error`, a `reason`, a `warning`). `{}` lists flows.
- Terminal / CI: `maheragent flow run login` prints the same report and exits `1`
  on failure; `--json` for machines, `--update-baselines` to adopt snapshots.
- A flow runs on the session's current browser: start from a `navigate` (or a
  `run` of a login flow) so it does not depend on what the previous flow left.
- A flow does not reset app data. If a step creates data, each replay creates it
  again — begin with a step that restores a known state, or say so in `description`.

## Repository hygiene

Commit `.maheragent/flows/` and `.maheragent/baselines/*/<name>.png`. Ignore
`.maheragent/secrets.env`, `*.current.png`, and `*.diff.png`.
