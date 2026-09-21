import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createToolRegistry,
  hasSecretPlaceholder,
  listSecrets,
  resolveSecrets,
} from "@ramisalem/tool-server";

let cwd;
let home;

before(() => {
  cwd = mkdtempSync(join(tmpdir(), "maher-secrets-cwd-"));
  home = mkdtempSync(join(tmpdir(), "maher-secrets-home-"));
  process.env.MAHERAGENT_HOME = home;
  mkdirSync(join(cwd, ".maheragent"));
  writeFileSync(join(cwd, ".maheragent", "secrets.env"), "# project secrets\nPW=from-project\nexport QUOTED='q v'\n");
  writeFileSync(join(cwd, ".env"), "PW=bare-app-value\nMAHERAGENT_SECRET_TOKEN=tok\n");
  writeFileSync(join(home, "secrets.env"), "PW=from-home\nGLOBAL=g\n");
});

after(() => {
  delete process.env.MAHERAGENT_HOME;
  delete process.env.MAHERAGENT_SECRET_PW;
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("placeholders resolve from the first source that defines the name", () => {
  const { text, used } = resolveSecrets("pw={{secret:PW}} t={{ secret:TOKEN }} g={{secret:GLOBAL}}", { cwd });
  assert.equal(text, "pw=from-project t=tok g=g");
  assert.deepEqual(used, ["PW", "TOKEN", "GLOBAL"]);
  assert.equal(resolveSecrets("{{secret:QUOTED}}", { cwd }).text, "q v");
});

test("an environment variable outranks every file, and the listing marks the shadowed copies", () => {
  process.env.MAHERAGENT_SECRET_PW = "from-env";
  assert.equal(resolveSecrets("{{secret:PW}}", { cwd }).text, "from-env");
  const listing = listSecrets({ cwd });
  const pw = listing.filter((s) => s.name === "PW");
  assert.equal(pw[0].source, "env");
  assert.ok(pw.slice(1).every((s) => s.shadowed), "file copies are shadowed");
  assert.ok(listing.every((s) => !("value" in s)), "never lists values");
  delete process.env.MAHERAGENT_SECRET_PW;
});

test("a bare key in .env belongs to the app, not to the agent", () => {
  // PW=bare-app-value in .env must not be picked up; the project file wins.
  assert.equal(resolveSecrets("{{secret:PW}}", { cwd }).text, "from-project");
  assert.ok(!listSecrets({ cwd }).some((s) => s.source === join(cwd, ".env") && s.name === "PW"));
});

test("an unknown name is an error, not a literal typed into the field", () => {
  assert.throws(() => resolveSecrets("{{secret:NOPE}}", { cwd }), /Unknown secret "NOPE"/);
  assert.equal(hasSecretPlaceholder("plain text"), false);
  assert.deepEqual(resolveSecrets("plain text", { cwd }), { text: "plain text", used: [] });
});

test("the type tool substitutes the value and withholds the post-action view", async () => {
  const file = join(cwd, "login.html");
  writeFileSync(
    file,
    `<!doctype html><html><head><title>Login</title></head><body>
      <input id="pw" type="password" aria-label="Password"><input id="user" aria-label="User">
    </body></html>`,
  );
  process.env.MAHERAGENT_SECRET_PW = "hunter2";
  const registry = createToolRegistry();
  try {
    await registry.execute("navigate", { url: pathToFileURL(file).href, observe: false });
    const { elements } = await registry.execute("describe", {});
    const pw = elements.find((e) => e.name === "Password");
    const result = await registry.execute("type", { ref: pw.ref, text: "{{secret:PW}}" });
    assert.deepEqual(result, { ok: true, secrets: ["PW"], observed: false });
    assert.ok(!JSON.stringify(result).includes("hunter2"), "plaintext never comes back");
    const typed = await registry.execute("evaluate", { expression: "document.getElementById('pw').value" });
    assert.equal(typed.value, "hunter2");
    assert.equal((await registry.execute("describe", {})).elements.find((e) => e.name === "Password").value, "***");
  } finally {
    await registry.disposeAll();
  }
});
