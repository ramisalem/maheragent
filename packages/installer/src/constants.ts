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
