// Flows: parsing, replay against a real page, failure semantics, snapshots,
// composition, and the live recorder.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createToolRegistry, parseFlow, FlowParseError } from "@ramisalem/tool-server";

const LOGIN = `<!doctype html><html><head><title>Login</title></head><body>
  <h1>Sign in</h1>
  <label for="email">Email</label><input id="email">
  <label for="pw">Password</label><input id="pw" type="password">
  <button id="go">Continue</button>
  <p id="err" style="display:none">Wrong password</p>
  <script>
    go.onclick = () => {
      if (pw.value === 'hunter2') { location.href = '/dashboard'; } else { err.style.display = 'block'; }
    };
  </script>
</body></html>`;
const DASHBOARD = `<!doctype html><html><head><title>Dashboard</title></head><body>
  <h1>Dashboard</h1><p class="greeting">Welcome, <strong>Rami</strong></p>
  <button id="theme" onclick="document.body.style.background = document.body.style.background ? '' : 'rgb(20,20,20)'">Toggle theme</button>
</body></html>`;

let server;
let base;
let root;
let registry;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(req.url.startsWith("/dashboard") ? DASHBOARD : LOGIN);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  root = mkdtempSync(join(tmpdir(), "maher-flows-"));
  mkdirSync(join(root, ".maheragent", "flows"), { recursive: true });
  process.env.MAHERAGENT_SECRET_PW = "hunter2";
  registry = createToolRegistry();
});

after(async () => {
  await registry.disposeAll();
  await new Promise((r) => server.close(r));
  delete process.env.MAHERAGENT_SECRET_PW;
  rmSync(root, { recursive: true, force: true });
});

const writeFlow = (name, yaml) => {
  const path = join(root, ".maheragent", "flows", `${name}.yaml`);
  writeFileSync(path, yaml);
  return path;
};

test("parse errors name the step and the mistake", () => {
  assert.throws(() => parseFlow({ steps: [{ clikc: "Save" }] }), /step 1: unknown directive `clikc`/);
  assert.throws(() => parseFlow({ steps: [{ click: "Save", hover: "x" }] }), /exactly one directive/);
  assert.throws(() => parseFlow({ steps: [{ type: { text: "x" } }] }), /step 1 \(type\) at `into`/);
  assert.throws(() => parseFlow({ steps: [{ assert: {} }] }), /needs `visible`/);
  assert.throws(() => parseFlow({ steps: [], extra: 1 }), /unknown top-level key `extra`/);
  assert.throws(() => parseFlow({ steps: [{ click: { nope: 1 } }] }), FlowParseError);
  const ok = parseFlow({ description: "d", steps: [{ click: "Save" }, { wait: { idle: true } }] });
  assert.equal(ok.steps.length, 2);
});

test("a flow replays end to end with secrets, waits, asserts, and a snapshot", async () => {
  const path = writeFlow(
    "login",
    `description: Log in and land on the dashboard
steps:
  - set-viewport: { width: 500, height: 400 }
  - navigate: ${base}/
  - assert: { title: { equals: Login } }
  - type: { into: { label: Email }, text: rami@example.com }
  - type: { into: { label: Password }, text: "{{secret:PW}}" }
  - click: { role: button, name: Continue }
  - wait: { text: Dashboard }
  - wait: { idle: true }
  - assert: { url: { contains: /dashboard } }
  - assert: { text: { in: { selector: .greeting }, contains: Welcome } }
  - assert: { hidden: Wrong password }
  - echo: reached the dashboard
  - snapshot: dashboard
  - tool: { name: cookies, args: { action: get } }
`,
  );
  const report = await registry.execute("flow-run", { path, updateBaselines: true });
  assert.equal(report.ok, true, JSON.stringify(report.steps.filter((s) => s.status !== "pass"), null, 2));
  assert.equal(report.passed, 14);
  const typed = report.steps.find((s) => s.kind === "type" && s.target.includes("Password"));
  assert.ok(typed.target.includes("{{secret:PW}}") && !typed.target.includes("hunter2"), "secret never printed");
  const snapshot = report.steps.find((s) => s.kind === "snapshot");
  assert.equal(snapshot.warning, "baseline created");
  assert.ok(existsSync(join(root, ".maheragent", "baselines", "login", "dashboard.png")));
  assert.ok(Array.isArray(report.steps.find((s) => s.kind === "tool").data.cookies));
});

test("a failed step stops the flow and skips the rest; a snapshot fails on a real change", async () => {
  const path = writeFlow(
    "login-bad",
    `steps:
  - navigate: ${base}/
  - type: { into: { label: Password }, text: wrong }
  - click: Continue
  - assert: { visible: Wrong password }
  - assert: { hidden: Wrong password, timeoutMs: 300 }
  - echo: never reached
`,
  );
  const report = await registry.execute("flow-run", { path });
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.steps.map((s) => s.status),
    ["pass", "pass", "pass", "pass", "fail", "skip"],
  );
  assert.match(report.steps[4].reason, /still visible/);

  // Snapshot regression: change the dashboard, then replay the login flow's snapshot.
  const visual = writeFlow(
    "visual",
    `steps:
  - set-viewport: { width: 500, height: 400 }
  - navigate: ${base}/dashboard
  - click: Toggle theme
  - snapshot: dashboard
`,
  );
  // Reuse the login flow's baseline by pointing this flow's baseline dir at it.
  mkdirSync(join(root, ".maheragent", "baselines", "visual"), { recursive: true });
  writeFileSync(
    join(root, ".maheragent", "baselines", "visual", "dashboard.png"),
    readFileSync(join(root, ".maheragent", "baselines", "login", "dashboard.png")),
  );
  const changed = await registry.execute("flow-run", { path: visual });
  assert.equal(changed.ok, false);
  const snap = changed.steps.find((s) => s.kind === "snapshot");
  assert.equal(snap.status, "fail");
  assert.match(snap.reason, /% of pixels differ/);
  assert.ok(existsSync(snap.data.diff));
});

test("run composes flows and a missing target reads as a failure with the target named", async () => {
  writeFlow("shared-login", `steps:\n  - navigate: ${base}/\n  - type: { into: { label: Password }, text: hunter2 }\n  - click: Continue\n  - wait: { text: Dashboard }\n`);
  const path = writeFlow(
    "composed",
    `steps:
  - run: shared-login
  - assert: { visible: { role: heading, name: Dashboard } }
  - click: { text: Does not exist }
`,
  );
  const report = await registry.execute("flow-run", { path });
  assert.equal(report.ok, false);
  const nested = report.steps.filter((s) => s.depth === 1);
  assert.equal(nested.length, 4, "nested steps are reported with depth");
  assert.equal(report.steps[0].kind, "run");
  assert.equal(report.steps[0].status, "pass");
  const last = report.steps[report.steps.length - 1];
  assert.equal(last.status, "fail");
  assert.match(last.reason, /no visible element matches text "Does not exist"/);
});

test("flow-run without a name lists flows, and an unknown flow is a structured error", async () => {
  const { flows } = await registry.execute("flow-run", { root });
  assert.ok(flows.includes("login") && flows.includes("composed"));
  const missing = await registry.execute("flow-run", { name: "nope", root });
  assert.equal(missing.error, "no_such_flow");
});

test("the recorder keeps only steps that passed and writes valid YAML", async () => {
  const started = await registry.execute("flow-start-recording", { name: "recorded", description: "Recorded live", root });
  assert.equal(started.ok, true);
  assert.equal(started.path, join(root, ".maheragent", "flows", "recorded.yaml"));

  const nav = await registry.execute("flow-add-step", { step: { navigate: `${base}/` } });
  assert.equal(nav.recorded, true);
  assert.ok(Array.isArray(nav.elements), "comes with the page view");

  const bad = await registry.execute("flow-add-step", { step: { click: "No such button" } });
  assert.equal(bad.recorded, false);
  assert.equal(bad.step.status, "fail");

  const invalid = await registry.execute("flow-add-step", { step: { frobnicate: 1 } });
  assert.equal(invalid.error, "invalid_step");

  await registry.execute("flow-add-step", { step: { type: { into: { label: "Password" }, text: "{{secret:PW}}" } } });
  await registry.execute("flow-add-step", { step: { click: { role: "button", name: "Continue" } } });
  const waited = await registry.execute("flow-add-step", { step: { wait: { text: "Dashboard" } } });
  assert.equal(waited.stepCount, 4);

  const finished = await registry.execute("flow-finish-recording", {});
  assert.deepEqual({ name: finished.name, steps: finished.steps }, { name: "recorded", steps: 4 });
  const doc = parseYaml(readFileSync(finished.path, "utf8"));
  assert.equal(doc.description, "Recorded live");
  assert.deepEqual(doc.steps[1], { type: { into: { label: "Password" }, text: "{{secret:PW}}" } });

  const replay = await registry.execute("flow-run", { name: "recorded", root });
  assert.equal(replay.ok, true, JSON.stringify(replay.steps, null, 2));
});
