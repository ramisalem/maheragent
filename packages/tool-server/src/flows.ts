// Flows: a recorded sequence of steps against the web app, kept as YAML in
// `.maheragent/flows/<name>.yaml`, replayed by the agent or by `maheragent flow
// run` in CI. Steps target elements by *stable* handles (text, role + name,
// CSS selector) rather than Element Refs, which only live for one page state.
//
//   steps:
//     - navigate: http://localhost:3000/login
//     - type: { into: { label: Email }, text: user@example.com }
//     - type: { into: { label: Password }, text: "{{secret:APP_PASSWORD}}", submit: true }
//     - wait: { text: Dashboard }
//     - assert: { url: { contains: /dashboard } }
//     - snapshot: dashboard
//
// A failed step stops the flow; later steps are reported as skipped.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type { BrowserSession, DescribedElement } from "./blueprints/browser-session.js";
import { screenshotDiff } from "./screenshot-diff.js";
import { resolveSecrets } from "./secrets.js";

// ── Schema ──────────────────────────────────────────────────────────────────

const targetObject = z
  .object({
    /** CSS selector. */
    selector: z.string().optional(),
    /** Case-insensitive substring of the element's own text. */
    text: z.string().optional(),
    /** Role as `describe` reports it (button, link, textbox, heading, …). */
    role: z.string().optional(),
    /** Accessible name as `describe` reports it (exact, case-insensitive). */
    name: z.string().optional(),
    /** Alias of `name`, reads better for form fields. */
    label: z.string().optional(),
  })
  .strict()
  .refine((t) => t.selector || t.text || t.role || t.name || t.label, {
    message: "a target needs `selector`, `text`, `role`, `name`, or `label`",
  });

/** A bare string is a text target. */
const targetSchema = z.union([z.string().min(1), targetObject]);
export type Target = z.infer<typeof targetSchema>;

const textCheck = z
  .object({
    contains: z.string().optional(),
    equals: z.string().optional(),
    matches: z.string().optional(),
  })
  .strict()
  .refine((c) => c.contains !== undefined || c.equals !== undefined || c.matches !== undefined, {
    message: "needs `contains`, `equals`, or `matches`",
  });

const DIRECTIVES = {
  navigate: z.string().url(),
  click: targetSchema,
  hover: targetSchema,
  type: z
    .object({
      into: targetSchema,
      text: z.string(),
      clear: z.boolean().optional(),
      submit: z.boolean().optional(),
    })
    .strict(),
  "press-key": z.string().min(1),
  "select-option": z
    .object({
      in: targetSchema,
      value: z.string().optional(),
      label: z.string().optional(),
      index: z.number().int().min(0).optional(),
    })
    .strict(),
  scroll: z.union([
    targetSchema,
    z.object({ target: targetSchema.optional(), dx: z.number().optional(), dy: z.number().optional() }).strict(),
  ]),
  wait: z
    .object({
      target: targetSchema.optional(),
      text: z.string().optional(),
      selector: z.string().optional(),
      state: z.enum(["visible", "hidden"]).optional(),
      idle: z.boolean().optional(),
      stableMs: z.number().int().optional(),
      timeoutMs: z.number().int().optional(),
    })
    .strict()
    .refine((w) => w.target || w.text || w.selector || w.idle, {
      message: "needs `target`, `text`, `selector`, or `idle: true`",
    }),
  assert: z
    .object({
      visible: targetSchema.optional(),
      hidden: targetSchema.optional(),
      text: z.object({ in: targetSchema }).merge(textCheck.innerType()).strict().optional(),
      url: textCheck.optional(),
      title: textCheck.optional(),
      timeoutMs: z.number().int().optional(),
    })
    .strict()
    .refine((a) => a.visible || a.hidden || a.text || a.url || a.title, {
      message: "needs `visible`, `hidden`, `text`, `url`, or `title`",
    }),
  snapshot: z.union([
    z.string().min(1),
    z
      .object({
        name: z.string().min(1),
        target: targetSchema.optional(),
        maxMismatch: z.number().min(0).max(1).optional(),
        fullPage: z.boolean().optional(),
      })
      .strict(),
  ]),
  "set-viewport": z
    .object({
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      colorScheme: z.enum(["light", "dark", "no-preference"]).optional(),
    })
    .strict(),
  echo: z.string(),
  tool: z.object({ name: z.string().min(1), args: z.record(z.unknown()).optional() }).strict(),
  run: z.string().min(1),
} as const;

export type DirectiveKind = keyof typeof DIRECTIVES;
export type Step = { [K in DirectiveKind]: { [P in K]: z.infer<(typeof DIRECTIVES)[K]> } }[DirectiveKind];

export interface Flow {
  description?: string;
  steps: Step[];
}

export class FlowParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowParseError";
  }
}

/** Validate one step object (`{ click: … }`), naming the step and the mistake. */
export function parseStep(raw: unknown, index: number): Step {
  const where = `step ${index + 1}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new FlowParseError(`${where}: expected a mapping with one directive, e.g. \`- click: Save\``);
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1) {
    throw new FlowParseError(
      `${where}: a step holds exactly one directive, got ${keys.length ? keys.map((k) => `\`${k}\``).join(", ") : "none"}`,
    );
  }
  const kind = keys[0] as DirectiveKind;
  const schema = DIRECTIVES[kind];
  if (!schema) {
    throw new FlowParseError(
      `${where}: unknown directive \`${kind}\`; use one of ${Object.keys(DIRECTIVES).join(", ")}`,
    );
  }
  const parsed = schema.safeParse((raw as Record<string, unknown>)[kind]);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.length ? ` at \`${issue.path.join(".")}\`` : "";
    throw new FlowParseError(`${where} (${kind})${path}: ${issue.message}`);
  }
  return { [kind]: parsed.data } as Step;
}

/** Parse a flow document (already YAML-decoded). */
export function parseFlow(doc: unknown): Flow {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new FlowParseError("a flow file is a mapping with a `steps` list");
  }
  const { steps, description, ...rest } = doc as Record<string, unknown>;
  const unknown = Object.keys(rest);
  if (unknown.length) throw new FlowParseError(`unknown top-level key \`${unknown[0]}\` (allowed: steps, description)`);
  if (!Array.isArray(steps)) throw new FlowParseError("`steps` must be a list");
  if (description !== undefined && typeof description !== "string") {
    throw new FlowParseError("`description` must be a string");
  }
  return {
    ...(description ? { description } : {}),
    steps: steps.map((s, i) => parseStep(s, i)),
  };
}

export function readFlowFile(path: string): Flow {
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    throw new FlowParseError(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseFlow(doc);
}

export function writeFlowFile(path: string, flow: Flow): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(flow, { lineWidth: 0 }));
}

// ── Locations ───────────────────────────────────────────────────────────────

/** `<root>/.maheragent/flows` — where named flows live. */
export function flowsDir(root: string = process.cwd()): string {
  return join(root, ".maheragent", "flows");
}

/** Resolve a flow by name (in the flows dir) or by explicit path. */
export function resolveFlowPath(nameOrPath: string, root: string = process.cwd()): string {
  if (nameOrPath.endsWith(".yaml") || nameOrPath.endsWith(".yml") || nameOrPath.includes("/")) {
    return isAbsolute(nameOrPath) ? nameOrPath : resolve(root, nameOrPath);
  }
  return join(flowsDir(root), `${nameOrPath}.yaml`);
}

export function listFlows(root: string = process.cwd()): string[] {
  const dir = flowsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => f.replace(/\.ya?ml$/, ""))
    .sort();
}

/** Baselines live beside the flows dir: `<…>/.maheragent/baselines/<flow>/<name>.png`. */
export function baselineDir(flowPath: string): string {
  const stem = basename(flowPath).replace(/\.ya?ml$/, "");
  const dir = dirname(flowPath);
  return basename(dir) === "flows" ? join(dirname(dir), "baselines", stem) : join(dir, "baselines", stem);
}

// ── Execution ───────────────────────────────────────────────────────────────

export type StepStatus = "pass" | "fail" | "skip" | "error";

export interface StepReport {
  index: number;
  kind: string;
  /** Human-readable target or argument, for the report line. */
  target?: string;
  status: StepStatus;
  reason?: string;
  /** Passed, but with a caveat worth reading (e.g. idle never settled). */
  warning?: string;
  durationMs: number;
  /** Nesting depth for steps inside a `run:`. */
  depth?: number;
  /** Extra data a step produced (snapshot paths, tool results). */
  data?: unknown;
}

export interface FlowReport {
  flow: string;
  path: string;
  ok: boolean;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  steps: StepReport[];
}

export interface RunOptions {
  /** Adopt current captures as baselines for `snapshot` steps. */
  updateBaselines?: boolean;
  /** Run any tool by name (the `tool` directive). */
  runTool?: (name: string, args: unknown) => Promise<unknown>;
  /** Called after each step, for streaming progress. */
  onStep?: (report: StepReport) => void;
}

interface Resolved {
  ref: string;
  label: string;
  element?: DescribedElement;
}

const describeTarget = (t: Target): string => {
  if (typeof t === "string") return `text "${t}"`;
  const parts: string[] = [];
  if (t.selector) parts.push(`selector ${t.selector}`);
  if (t.text) parts.push(`text "${t.text}"`);
  if (t.role) parts.push(`role ${t.role}`);
  if (t.name ?? t.label) parts.push(`name "${t.name ?? t.label}"`);
  return parts.join(", ");
};

/** Find the element a target names, or null. Never throws for "not found". */
async function locate(browser: BrowserSession, target: Target): Promise<Resolved | null> {
  const t = typeof target === "string" ? { text: target } : target;
  const wanted = (t.name ?? t.label)?.toLowerCase();
  const role = t.role?.toLowerCase();
  let candidates: DescribedElement[];
  if (t.selector || t.text) {
    candidates = (await browser.find({ selector: t.selector, text: t.text })).elements;
  } else {
    candidates = (await browser.describe({ content: true })).elements;
  }
  if (role) candidates = candidates.filter((e) => e.role.toLowerCase() === role);
  if (wanted !== undefined) {
    const exact = candidates.filter((e) => e.name.toLowerCase() === wanted);
    candidates = exact.length ? exact : candidates.filter((e) => e.name.toLowerCase().includes(wanted));
  }
  if (candidates.length === 0) return null;
  // Prefer an exact text match, then the most specific (smallest) element.
  const needle = t.text?.toLowerCase();
  const exactText = needle ? candidates.filter((e) => e.name.toLowerCase() === needle) : [];
  const pool = exactText.length ? exactText : candidates;
  const best = pool.reduce((a, b) => {
    const area = (e: DescribedElement): number => (e.box ? e.box.width * e.box.height : Infinity);
    return area(b) < area(a) ? b : a;
  });
  return { ref: best.ref, label: describeTarget(target), element: best };
}

async function resolveOrThrow(browser: BrowserSession, target: Target): Promise<Resolved> {
  const found = await locate(browser, target);
  if (!found) throw new Error(`no visible element matches ${describeTarget(target)}`);
  return found;
}

const checkText = (actual: string, check: { contains?: string; equals?: string; matches?: string }): string | null => {
  if (check.contains !== undefined && !actual.toLowerCase().includes(check.contains.toLowerCase())) {
    return `expected to contain "${check.contains}", got "${actual.slice(0, 120)}"`;
  }
  if (check.equals !== undefined && actual.trim().toLowerCase() !== check.equals.trim().toLowerCase()) {
    return `expected "${check.equals}", got "${actual.slice(0, 120)}"`;
  }
  if (check.matches !== undefined && !new RegExp(check.matches).test(actual)) {
    return `expected to match /${check.matches}/, got "${actual.slice(0, 120)}"`;
  }
  return null;
};

/** Retry `probe` until it returns null (success) or the grace period ends. */
async function withGrace(probe: () => Promise<string | null>, graceMs: number): Promise<string | null> {
  const start = Date.now();
  let last: string | null = null;
  do {
    last = await probe();
    if (last === null) return null;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() - start < graceMs);
  return last;
}

export interface StepContext {
  browser: BrowserSession;
  flowPath: string;
  options: RunOptions;
  depth: number;
}

/** Run one step. Returns the report fields except index/duration. */
export async function executeStep(
  step: Step,
  ctx: StepContext,
): Promise<Pick<StepReport, "kind" | "target" | "status" | "reason" | "warning" | "data">> {
  const { browser } = ctx;
  const kind = Object.keys(step)[0] as DirectiveKind;
  const arg = (step as Record<string, unknown>)[kind] as never;
  try {
    switch (kind) {
      case "navigate": {
        const url = arg as string;
        await browser.navigate(url);
        return { kind, target: url, status: "pass" };
      }
      case "click": {
        const { ref, label } = await resolveOrThrow(browser, arg as Target);
        await browser.click({ ref });
        return { kind, target: label, status: "pass" };
      }
      case "hover": {
        const { ref, label } = await resolveOrThrow(browser, arg as Target);
        await browser.hover(ref);
        return { kind, target: label, status: "pass" };
      }
      case "type": {
        const a = arg as z.infer<(typeof DIRECTIVES)["type"]>;
        const { ref, label } = await resolveOrThrow(browser, a.into);
        const { text, used } = resolveSecrets(a.text);
        await browser.type(ref, text, { clear: a.clear, submit: a.submit });
        return {
          kind,
          target: `${label} ← ${used.length ? `{{secret:${used.join(",")}}}` : JSON.stringify(a.text)}`,
          status: "pass",
        };
      }
      case "press-key": {
        await browser.pressKey(arg as string);
        return { kind, target: arg as string, status: "pass" };
      }
      case "select-option": {
        const a = arg as z.infer<(typeof DIRECTIVES)["select-option"]>;
        const { ref, label } = await resolveOrThrow(browser, a.in);
        const selected = await browser.selectOption(ref, a);
        return { kind, target: label, status: "pass", data: { selected } };
      }
      case "scroll": {
        const a = arg as z.infer<(typeof DIRECTIVES)["scroll"]>;
        const spec = typeof a === "string" || "selector" in a || "text" in a || "role" in a || "name" in a || "label" in a
          ? { target: a as Target }
          : (a as { target?: Target; dx?: number; dy?: number });
        const found = spec.target ? await resolveOrThrow(browser, spec.target) : undefined;
        await browser.scroll({ ref: found?.ref, dx: spec.dx, dy: spec.dy });
        return { kind, target: found?.label ?? `by ${spec.dx ?? 0},${spec.dy ?? 0}`, status: "pass" };
      }
      case "wait": {
        const a = arg as z.infer<(typeof DIRECTIVES)["wait"]>;
        const timeoutMs = a.timeoutMs ?? 10_000;
        let target = a.target ? describeTarget(a.target) : a.text ? `text "${a.text}"` : a.selector ?? "idle";
        if (a.target) {
          const t = typeof a.target === "string" ? { text: a.target } : a.target;
          const wantHidden = a.state === "hidden";
          const reason = await withGrace(async () => {
            const found = await locate(browser, t);
            if (wantHidden) return found ? `${target} is still visible` : null;
            return found ? null : `${target} did not appear`;
          }, timeoutMs);
          if (reason) throw new Error(`timed out after ${timeoutMs}ms: ${reason}`);
        } else if (a.text || a.selector) {
          await browser.waitFor({ text: a.text, selector: a.selector, state: a.state, timeoutMs });
        }
        let warning: string | undefined;
        if (a.idle) {
          const settled = await browser.settle({ stableMs: a.stableMs ?? 300, timeoutMs });
          if (!settled.settled) warning = `the page kept changing for ${settled.waitedMs}ms; treat later checks with care`;
          if (target === "idle") target = `idle (${settled.waitedMs}ms)`;
        }
        return { kind, target, status: "pass", ...(warning ? { warning } : {}) };
      }
      case "assert": {
        const a = arg as z.infer<(typeof DIRECTIVES)["assert"]>;
        const grace = a.timeoutMs ?? 1000;
        const targets: string[] = [];
        const reason = await withGrace(async () => {
          if (a.visible) {
            targets.length = 0;
            targets.push(`visible ${describeTarget(a.visible)}`);
            if (!(await locate(browser, a.visible))) return `${describeTarget(a.visible)} is not visible`;
          }
          if (a.hidden) {
            targets.push(`hidden ${describeTarget(a.hidden)}`);
            if (await locate(browser, a.hidden)) return `${describeTarget(a.hidden)} is still visible`;
          }
          if (a.text) {
            const { in: where, ...check } = a.text;
            targets.push(`text of ${describeTarget(where)}`);
            const found = await locate(browser, where);
            if (!found) return `${describeTarget(where)} is not visible`;
            const actual = String((await browser.evaluate("el.innerText ?? el.textContent ?? ''", found.ref)) ?? "");
            const bad = checkText(actual, check);
            if (bad) return bad;
          }
          if (a.url) {
            targets.push("url");
            const bad = checkText(String(await browser.evaluate("location.href")), a.url);
            if (bad) return `url: ${bad}`;
          }
          if (a.title) {
            targets.push("title");
            const bad = checkText(String(await browser.evaluate("document.title")), a.title);
            if (bad) return `title: ${bad}`;
          }
          return null;
        }, grace);
        const target = [...new Set(targets)].join("; ");
        return reason ? { kind, target, status: "fail", reason } : { kind, target, status: "pass" };
      }
      case "snapshot": {
        const a = arg as z.infer<(typeof DIRECTIVES)["snapshot"]>;
        const spec = typeof a === "string" ? { name: a } : a;
        const found = spec.target ? await resolveOrThrow(browser, spec.target) : undefined;
        const baseline = join(baselineDir(ctx.flowPath), `${spec.name}.png`);
        const result = await screenshotDiff(browser, {
          baseline,
          ref: found?.ref,
          fullPage: spec.fullPage,
          maxMismatch: spec.maxMismatch,
          updateBaseline: ctx.options.updateBaselines,
          includeImage: false,
        });
        const target = found ? `${spec.name} (${found.label})` : spec.name;
        if ("error" in result) {
          return { kind, target, status: "fail", reason: result.message, data: { current: result.current } };
        }
        if ("created" in result) {
          return { kind, target, status: "pass", warning: "baseline created", data: { baseline } };
        }
        const data = { baseline, current: result.current, diff: result.diffPath, mismatchRatio: result.mismatchRatio, regions: result.regions };
        if (result.updated) return { kind, target, status: "pass", warning: "baseline updated", data };
        return result.matches
          ? { kind, target, status: "pass", data }
          : {
              kind,
              target,
              status: "fail",
              reason: `${(result.mismatchRatio * 100).toFixed(2)}% of pixels differ from the baseline (${result.regions.length} region${result.regions.length === 1 ? "" : "s"}); see ${result.diffPath}`,
              data,
            };
      }
      case "set-viewport": {
        const a = arg as z.infer<(typeof DIRECTIVES)["set-viewport"]>;
        const state = await browser.setViewport(a);
        return { kind, target: `${state.width}x${state.height}${a.colorScheme ? ` ${a.colorScheme}` : ""}`, status: "pass" };
      }
      case "echo":
        return { kind, target: arg as string, status: "pass" };
      case "tool": {
        const a = arg as z.infer<(typeof DIRECTIVES)["tool"]>;
        if (!ctx.options.runTool) return { kind, target: a.name, status: "error", reason: "the `tool` directive is unavailable here" };
        const data = await ctx.options.runTool(a.name, a.args ?? {});
        return { kind, target: a.name, status: "pass", data };
      }
      case "run":
        // Handled by runFlow (needs to nest reports); reaching here is a bug.
        return { kind, target: arg as string, status: "error", reason: "run steps are executed by the runner" };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { kind, status: "fail", reason: message };
  }
}

const MAX_RUN_DEPTH = 5;

/** Replay a flow file. Never throws for a failing step — the report says what happened. */
export async function runFlow(
  browser: BrowserSession,
  flowPath: string,
  options: RunOptions = {},
): Promise<FlowReport> {
  const name = basename(flowPath).replace(/\.ya?ml$/, "");
  const report: FlowReport = { flow: name, path: flowPath, ok: true, passed: 0, failed: 0, skipped: 0, errored: 0, steps: [] };
  let flow: Flow;
  try {
    flow = readFlowFile(flowPath);
  } catch (err) {
    report.ok = false;
    report.errored = 1;
    const step: StepReport = { index: 0, kind: "parse", status: "error", reason: err instanceof Error ? err.message : String(err), durationMs: 0 };
    report.steps.push(step);
    options.onStep?.(step);
    return report;
  }
  await runSteps(flow.steps, { browser, flowPath, options, depth: 0 }, report);
  report.ok = report.failed === 0 && report.errored === 0;
  return report;
}

async function runSteps(steps: Step[], ctx: StepContext, report: FlowReport): Promise<boolean> {
  let stopped = false;
  for (const step of steps) {
    const index = report.steps.length;
    const kind = Object.keys(step)[0] as DirectiveKind;
    if (stopped) {
      const skipped: StepReport = { index, kind, status: "skip", durationMs: 0, ...(ctx.depth ? { depth: ctx.depth } : {}) };
      report.steps.push(skipped);
      report.skipped++;
      ctx.options.onStep?.(skipped);
      continue;
    }
    const start = Date.now();
    if (kind === "run") {
      const relative = (step as { run: string }).run;
      const target = relative.endsWith(".yaml") || relative.endsWith(".yml") ? relative : `${relative}.yaml`;
      const nested = resolve(dirname(ctx.flowPath), target);
      const header: StepReport = { index, kind, target: relative, status: "pass", durationMs: 0, ...(ctx.depth ? { depth: ctx.depth } : {}) };
      if (ctx.depth >= MAX_RUN_DEPTH) {
        header.status = "error";
        header.reason = `run nesting deeper than ${MAX_RUN_DEPTH}`;
      } else if (!existsSync(nested)) {
        header.status = "error";
        header.reason = `no flow file at ${nested}`;
      }
      report.steps.push(header);
      ctx.options.onStep?.(header);
      if (header.status === "error") {
        report.errored++;
        stopped = true;
        continue;
      }
      let child: Flow;
      try {
        child = readFlowFile(nested);
      } catch (err) {
        header.status = "error";
        header.reason = err instanceof Error ? err.message : String(err);
        report.errored++;
        stopped = true;
        continue;
      }
      const ok = await runSteps(child.steps, { ...ctx, flowPath: nested, depth: ctx.depth + 1 }, report);
      header.durationMs = Date.now() - start;
      if (!ok) {
        header.status = "fail";
        header.reason = "a nested step failed";
        stopped = true;
      } else {
        report.passed++;
      }
      continue;
    }
    const outcome = await executeStep(step, ctx);
    const entry: StepReport = { index, ...outcome, durationMs: Date.now() - start, ...(ctx.depth ? { depth: ctx.depth } : {}) };
    report.steps.push(entry);
    ctx.options.onStep?.(entry);
    if (entry.status === "pass") report.passed++;
    else if (entry.status === "fail") {
      report.failed++;
      stopped = true;
    } else if (entry.status === "error") {
      report.errored++;
      stopped = true;
    }
  }
  return !stopped;
}

// ── Recording ───────────────────────────────────────────────────────────────

export interface Recording {
  name: string;
  path: string;
  description?: string;
  steps: Step[];
  startedAt: number;
}

/** One open recording per Browser Session. */
const recordings = new Map<string, Recording>();

export function startRecording(session: string, name: string, description: string | undefined, root: string = process.cwd()): Recording {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
    throw new Error(`flow name "${name}" must be letters, digits, dashes, or underscores`);
  }
  const recording: Recording = { name, path: join(flowsDir(root), `${name}.yaml`), description, steps: [], startedAt: Date.now() };
  recordings.set(session, recording);
  return recording;
}

export function currentRecording(session: string): Recording | undefined {
  return recordings.get(session);
}

export function finishRecording(session: string): Recording {
  const recording = recordings.get(session);
  if (!recording) throw new Error("no recording is open for this session; call flow-start-recording first");
  recordings.delete(session);
  const flow: Flow = { ...(recording.description ? { description: recording.description } : {}), steps: recording.steps };
  writeFlowFile(recording.path, flow);
  return recording;
}

export function discardRecording(session: string): boolean {
  return recordings.delete(session);
}
