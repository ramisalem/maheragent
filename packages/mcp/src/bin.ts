#!/usr/bin/env node
// Entrypoint the editor launches as an MCP server (stdio transport).

import { startMcp } from "./index.js";

startMcp().catch((err) => {
  process.stderr.write(`maheragent MCP adapter failed: ${String(err)}\n`);
  process.exit(1);
});
