// Workspace install. Routes `maheragent init|update|remove` to the orchestrators,
// and re-exports the adapter/skill surface for programmatic use and tests.

import { init } from "./init.js";
import { uninstall } from "./uninstall.js";

export * from "./adapters.js";
export * from "./format.js";
export {
  MCP_SERVER_KEY,
  MCP_BINARY_NAME,
  PERMISSION_RULE,
  CURSOR_ALLOWLIST_PATTERN,
} from "./constants.js";
export { skillsSource, copySkillsToTargets, removeSkillsFromTargets } from "./skills.js";
export { init } from "./init.js";
export { uninstall } from "./uninstall.js";

/** Entrypoint for `maheragent init|install|update|remove|uninstall`. */
export async function runInstaller(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command === "remove" || command === "uninstall") {
    return uninstall(argv);
  }
  // init / install / update all (re)write the configuration.
  return init(argv);
}
