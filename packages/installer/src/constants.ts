// Naming the installer writes into editor configs. Change these together if the
// MCP server key or the published binary name ever changes.

/** Key the server is registered under in every editor config. */
export const MCP_SERVER_KEY = "maheragent";
/** Binary editors launch: `maheragent mcp`. Portable — no absolute path. */
export const MCP_BINARY_NAME = "maheragent";
/** Claude Code permission rule that auto-approves this server's tools. */
export const PERMISSION_RULE = "mcp__maheragent";
/** Cursor allowlist glob that auto-approves this server's tools. */
export const CURSOR_ALLOWLIST_PATTERN = "maheragent:*";

// ── Figma Dev Mode MCP ──────────────────────────────────────────────────────
// Registered alongside maheragent so the figma-conformance skill works out of
// the box (it needs both servers connected). The Figma Dev Mode server is a
// *local URL* server that runs inside the Figma desktop app — we bridge it to
// stdio with `mcp-remote` so every editor format can register it uniformly
// (Zed/Codex/Hermes can't express a URL server natively).

/** Key the Figma server is registered under, next to `maheragent`. */
export const FIGMA_SERVER_KEY = "figma-dev-mode";
/** Local endpoint the Figma desktop app exposes when Dev Mode MCP is enabled. */
export const FIGMA_MCP_URL = "http://127.0.0.1:3845/sse";
