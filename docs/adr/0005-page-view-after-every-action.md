# Every interaction returns the page after the action

An agent driving a page pays a round-trip for every tool call, and the naive loop — act, then `describe`, then act — spends half of them on re-reading the screen. We now make every interaction Tool (`click`, `type`, `scroll`, `press-key`, `navigate`, `wait-for`, …) wait briefly for the DOM to settle and return a **Page View**: the tab's `url` and `title`, a fresh element list with renumbered Element Refs, and any tabs the action opened. `describe` remains for the first look at a screen and for the content-element view; `observe: false` or the `disable-auto-describe` flag opts out for bursts of input. Screenshots reach the model as MCP image blocks, never as base64 text, so the visual half of a check is actually visible.

We rejected returning only `{ ok: true }` (the previous behaviour) because the agent then acts on a stale view or spends a call to refresh it, and we rejected an automatic screenshot after every action because a full-page PNG per click costs far more context than the element list and is rarely needed to decide the next step.

## Consequences

- Refs are only valid for the latest Page View; a Ref that no longer resolves fails fast with `stale_ref` instead of waiting out an actionability timeout.
- The settle wait bounds latency (150 ms of quiet, 1.5 s cap) rather than guaranteeing a finished render; `wait-for` exists for the cases that need a real condition.
- Secrets typed via `{{secret:NAME}}` suppress the Page View for that call so the resolved value never rides back into the transcript.
