// Read/write helpers for the config-file formats editors use: JSON, JSONC
// (comment-preserving), TOML, and YAML. Each editor adapter dispatches to the
// helper matching its file format; keeping that knowledge here lets the
// adapters stay about *where* config lives, not *how* to parse it.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  applyEdits as applyJsoncEdits,
  modify as modifyJsonc,
  parse as parseJsonc,
  type JSONPath,
} from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { Document, parseDocument } from "yaml";

export type { JSONPath };

// ── JSON ──────────────────────────────────────────────────────────────────────

export function readJson(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

// ── JSONC (comment-preserving edits, for Zed / opencode) ───────────────────────

const JSONC_FORMATTING = { tabSize: 2, insertSpaces: true } as const;

export function readJsonc(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  let raw = fs.readFileSync(filePath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  if (raw.trim() === "") return {};
  const parsed = parseJsonc(raw, [], { allowTrailingComma: true }) as
    | Record<string, unknown>
    | undefined;
  return parsed ?? {};
}

/**
 * Apply one path-targeted edit to a JSONC file in place, preserving comments,
 * trailing commas, and key order outside the touched path. Pass `undefined`
 * to delete; empty ancestors are pruned and a file that collapses to `{}` is
 * removed along with an emptied parent dir.
 */
export function editJsoncFile(filePath: string, jsonPath: JSONPath, value: unknown): void {
  const exists = fs.existsSync(filePath);
  let text = exists ? fs.readFileSync(filePath, "utf8") : "{}";
  const hadBom = text.charCodeAt(0) === 0xfeff;
  if (hadBom) text = text.slice(1);
  if (text.trim() === "") text = "{}";

  const set = (src: string, p: JSONPath, v: unknown): string =>
    applyJsoncEdits(src, modifyJsonc(src, p, v, { formattingOptions: JSONC_FORMATTING }));

  text = set(text, jsonPath, value);

  if (value === undefined) {
    for (let i = jsonPath.length - 1; i > 0; i--) {
      const parent = jsonPath.slice(0, i);
      const at = getAtPath(parseJsonc(text, [], { allowTrailingComma: true }), parent);
      if (!isEmptyObject(at)) break;
      text = set(text, parent, undefined);
    }
  }

  if (isEmptyObject(parseJsonc(text, [], { allowTrailingComma: true }))) {
    fs.rmSync(filePath, { force: true });
    removeDirIfEmpty(path.dirname(filePath));
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, (hadBom ? "﻿" : "") + text);
}

// ── TOML (Codex) ───────────────────────────────────────────────────────────────

export function readToml(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return parseToml(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeToml(filePath: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, stringifyToml(data) + "\n");
}

// ── YAML (Hermes; Document API so comments survive round-trips) ────────────────

export function readYaml(filePath: string): Document {
  if (!fs.existsSync(filePath)) return new Document({});
  const doc = parseDocument(fs.readFileSync(filePath, "utf8"));
  if (doc.errors.length > 0) {
    throw new Error(`Failed to parse YAML at ${filePath}: ${doc.errors.map((e) => e.message).join("; ")}`);
  }
  return doc;
}

export function writeYaml(filePath: string, doc: Document): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, doc.toString({ lineWidth: 0 }));
}

// ── Shared ─────────────────────────────────────────────────────────────────────

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Recursively copy a directory; returns false if the source is absent. */
export function copyDir(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

export function removeDirIfEmpty(dirPath: string): void {
  try {
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {
    /* non-fatal */
  }
}

function isEmptyObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  );
}

function getAtPath(value: unknown, jsonPath: JSONPath): unknown {
  let cur: unknown = value;
  for (const key of jsonPath) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[key as string | number];
  }
  return cur;
}

/** Prune empty objects/arrays recursively; returns undefined if nothing remains. */
export function pruneEmpty(value: unknown): unknown | undefined {
  if (Array.isArray(value)) return value.length > 0 ? value : undefined;
  if (value && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = pruneEmpty(v);
      if (next !== undefined) cleaned[k] = next;
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Write JSON, or delete the file (and an emptied parent dir) if it pruned to nothing. */
export function writeJsonOrRemove(filePath: string, data: Record<string, unknown>): void {
  const cleaned = pruneEmpty(data);
  if (!isRecord(cleaned)) {
    fs.rmSync(filePath, { force: true });
    removeDirIfEmpty(path.dirname(filePath));
    return;
  }
  writeJson(filePath, cleaned);
}

/** TOML variant of {@link writeJsonOrRemove}. */
export function writeTomlOrRemove(filePath: string, data: Record<string, unknown>): void {
  const cleaned = pruneEmpty(data);
  if (!isRecord(cleaned)) {
    fs.rmSync(filePath, { force: true });
    removeDirIfEmpty(path.dirname(filePath));
    return;
  }
  writeToml(filePath, cleaned as Record<string, unknown>);
}
