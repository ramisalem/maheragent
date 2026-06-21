// The long-running local daemon. Owns the Registry and every live Service
// (including the BrowserSession). Outlives any single editor connection.
//
// Boot sequence (TODO):
//   1. construct the Registry
//   2. register blueprints (BrowserSession, ...)
//   3. register tools (perception, interaction, diagnostics, performance, extract-styles)
//   4. listen on a local port with a bearer token; expose GET /tools + POST /tools/<name>

export async function startToolServer(): Promise<void> {
  // TODO
}
