// Tool registrations. Each Tool is a named, agent-callable operation with a typed
// input schema; it declares the Services it needs and the Registry resolves them.
//
// v1 tools (TODO):
//   perception:    describe, screenshot
//   interaction:   navigate, click, type, scroll, press-key, hover
//   diagnostics:   console-logs, network-logs
//   performance:   profile (Lighthouse / CDP trace)
//   conformance:   extract-styles   (read-only grounding tool; the verdict lives in the skill)

export const TODO_tools = true;
