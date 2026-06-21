// Feature flags. Global (~/.maheragent/flags.json) overridden by project (<project>/.maheragent/flags.json).

export type FlagName = string;

// TODO: read/merge global + project flag files; expose isFlagEnabled.
export function isFlagEnabled(_name: FlagName): boolean {
  return false;
}
