# Monorepo package layout aligned to the architecture seams

We use an npm-workspaces monorepo whose package boundaries follow the architecture layers (ADR-0001), so each layer is independently buildable. Cross-cutting concerns are isolated into small, dependency-light packages — `@ramisalem/registry` (URN resolution), `@ramisalem/configuration-core` (feature flags), `@ramisalem/update-core` (self-update), and `@ramisalem/telemetry`. The web-specific risk concentrates in `@ramisalem/tool-server`, which carries the Playwright `BrowserSession` blueprint and the perception / interaction / diagnostics / performance / `extract-styles` tools. The remaining packages — `mcp` (adapter), `cli`, `installer`, `skills`, and a thin published `maheragent` dispatcher — wrap and ship that core.

## Consequences

- `tool-server` is the only package carrying web-specific risk; the cross-cutting packages stay platform-neutral and independently testable.
- The published `maheragent` package is a thin dispatcher, keeping the heavy logic in versioned workspace packages.
