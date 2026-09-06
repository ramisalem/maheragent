// Flow tools: replay a saved flow, and record one step by step while the
// steps run live. These need the Registry (to resolve the Browser Session and
// to run arbitrary tools from a `tool` step), so they are built with it.

import { existsSync } from "node:fs";
import { z } from "zod";
import { defineTool, ref, type AnyToolDefinition, type Registry } from "@ramisalem/registry";
import { browserSessionBlueprint, type BrowserSession } from "../blueprints/browser-session.js";
import {
  currentRecording,
  discardRecording,
  executeStep,
  finishRecording,
  FlowParseError,
  listFlows,
  parseStep,
  resolveFlowPath,
  runFlow,
  startRecording,
  type StepReport,
} from "../flows.js";

const sessionArg = z.string().optional();
/** Project root holding `.maheragent/flows`; defaults to the daemon's working directory. */
const rootArg = z.string().optional();

const STEP_HELP =
  'A step is a one-key mapping: `{"navigate": "<url>"}`, `{"click": "Save"}` (a bare string is a text target), `{"click": {"role": "button", "name": "Save"}}`, `{"type": {"into": {"label": "Email"}, "text": "a@b.co", "submit": true}}`, `{"hover": …}`, `{"press-key": "Escape"}`, `{"select-option": {"in": …, "label": "Two"}}`, `{"scroll": {"target": …, "dy": 400}}`, `{"wait": {"text": "Dashboard"}}` / `{"wait": {"idle": true}}`, `{"assert": {"visible": …}}` / `{"assert": {"url": {"contains": "/dashboard"}}}` / `{"assert": {"text": {"in": …, "equals": "Saved"}}}`, `{"snapshot": "home"}`, `{"set-viewport": {"width": 390, "height": 844}}`, `{"echo": "note"}`, `{"tool": {"name": "cookies", "args": {…}}}`, `{"run": "login"}`. Targets are stable handles — text, role + name/label, or a CSS selector — never Element Refs.';

export function flowTools(registry: Registry): AnyToolDefinition[] {
  const browserFor = (session?: string): Promise<BrowserSession> =>
    registry.resolveService(ref(browserSessionBlueprint, { sessionId: session ?? "default" }));
  const runTool = (name: string, args: unknown): Promise<unknown> => registry.execute(name, args);

  const flowRun = defineTool({
    name: "flow-run",
    description:
      "Replay a saved flow by `name` (from <root>/.maheragent/flows/) or by `path`, step by step on the session's browser. A failed step stops the flow; later steps are reported as skipped. `updateBaselines: true` adopts the current capture for every `snapshot` step. With no name, lists the flows available. `root` defaults to the daemon's working directory — pass the project root when they differ.",
    input: z.object({
      name: z.string().optional(),
      path: z.string().optional(),
      updateBaselines: z.boolean().optional(),
      root: rootArg,
      session: sessionArg,
    }),
    execute: async (args) => {
      const root = args.root ?? process.cwd();
      const which = args.path ?? args.name;
      if (!which) return { root, flows: listFlows(root) };
      const path = resolveFlowPath(which, root);
      if (!existsSync(path)) {
        return { ok: false, error: "no_such_flow", message: `No flow at ${path}.`, flows: listFlows(root) };
      }
      const browser = await browserFor(args.session);
      return runFlow(browser, path, { updateBaselines: args.updateBaselines, runTool });
    },
  });

  const flowStart = defineTool({
    name: "flow-start-recording",
    description:
      "Open a new flow recording named `name` (letters, digits, dashes). Then call flow-add-step for each step — each runs live and is kept only if it passes — and flow-finish-recording to write .maheragent/flows/<name>.yaml. Recording is not retroactive: start before the first action of the path you want to keep.",
    input: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      root: rootArg,
      session: sessionArg,
    }),
    execute: async (args) => {
      const session = args.session ?? "default";
      const existing = currentRecording(session);
      if (existing) {
        discardRecording(session);
      }
      const recording = startRecording(session, args.name, args.description, args.root ?? process.cwd());
      return {
        ok: true,
        name: recording.name,
        path: recording.path,
        ...(existing ? { discarded: existing.name } : {}),
        stepHelp: STEP_HELP,
      };
    },
  });

  const flowAddStep = defineTool({
    name: "flow-add-step",
    description: `Run one step live and, if it passes, append it to the open recording. Returns the step's result plus the page view after it. ${STEP_HELP}`,
    input: z.object({ step: z.record(z.unknown()), session: sessionArg }),
    execute: async (args) => {
      const session = args.session ?? "default";
      const recording = currentRecording(session);
      if (!recording) {
        return { ok: false, error: "no_recording", message: "No recording is open; call flow-start-recording first." };
      }
      let step;
      try {
        step = parseStep(args.step, recording.steps.length);
      } catch (err) {
        if (err instanceof FlowParseError) return { ok: false, error: "invalid_step", message: err.message };
        throw err;
      }
      const browser = await browserFor(session);
      const start = Date.now();
      const outcome = await executeStep(step, {
        browser,
        flowPath: recording.path,
        options: { runTool, updateBaselines: true },
        depth: 0,
      });
      const report: StepReport = { index: recording.steps.length, ...outcome, durationMs: Date.now() - start };
      if (report.status === "pass") recording.steps.push(step);
      const view = await browser.observe();
      return {
        ok: report.status === "pass",
        recorded: report.status === "pass",
        step: report,
        stepCount: recording.steps.length,
        ...view,
      };
    },
  });

  const flowFinish = defineTool({
    name: "flow-finish-recording",
    description:
      "Write the open recording to .maheragent/flows/<name>.yaml and close it. Pass `discard: true` to throw the recording away instead.",
    input: z.object({ discard: z.boolean().optional(), session: sessionArg }),
    execute: async (args) => {
      const session = args.session ?? "default";
      if (args.discard) {
        const had = discardRecording(session);
        return { ok: true, discarded: had };
      }
      const recording = finishRecording(session);
      return { ok: true, name: recording.name, path: recording.path, steps: recording.steps.length };
    },
  });

  return [flowRun, flowStart, flowAddStep, flowFinish];
}
