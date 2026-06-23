// Locate the bundled skills and copy them into each editor's native skills
// directory (so the agent discovers them) — and remove them on uninstall.

import * as fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyDir, removeDirIfEmpty } from "./format.js";
import type { SkillTarget } from "./adapters.js";

const require = createRequire(import.meta.url);

/**
 * Absolute path to the bundled skills directory. Resolves the skills package in
 * a workspace/dev install; in the bundled single-package distribution it falls
 * back to the `skills/` directory shipped beside this file.
 */
export function skillsSource(): string {
  try {
    return join(dirname(require.resolve("@ramisalem/skills/package.json")), "skills");
  } catch {
    return fileURLToPath(new URL("./skills", import.meta.url));
  }
}

export interface SkillCopyResult {
  editor: string;
  dir: string;
  ok: boolean;
  error?: string;
}

/** Copy the bundled skills into every target directory. */
export function copySkillsToTargets(targets: readonly SkillTarget[]): SkillCopyResult[] {
  const src = skillsSource();
  return targets.map((t) => {
    try {
      copyDir(src, t.dir);
      return { editor: t.editor, dir: t.dir, ok: true };
    } catch (err) {
      return { editor: t.editor, dir: t.dir, ok: false, error: String(err) };
    }
  });
}

/** Remove the skills we copied, pruning the dir if it ends up empty. */
export function removeSkillsFromTargets(targets: readonly SkillTarget[]): void {
  for (const t of targets) {
    fs.rmSync(t.dir, { recursive: true, force: true });
    removeDirIfEmpty(dirname(t.dir));
  }
}
