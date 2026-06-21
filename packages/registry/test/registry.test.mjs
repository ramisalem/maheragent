import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  Registry,
  defineBlueprint,
  defineTool,
  ref,
  UnknownToolError,
  ToolDisabledError,
  InvalidToolArgsError,
  DuplicateToolError,
} from "@ramisalem/registry";

function setup() {
  const counts = { created: 0, disposed: 0 };
  const Counter = defineBlueprint({
    kind: "Counter",
    urn: (i) => `Counter:${i.id}`,
    create: (i) => {
      counts.created++;
      return { id: i.id, value: 0 };
    },
    dispose: () => {
      counts.disposed++;
    },
  });
  const flags = { beta: false };
  const registry = new Registry({ isFlagEnabled: (f) => flags[f] ?? false });
  registry.registerTools([
    defineTool({
      name: "bump",
      description: "increment a counter",
      input: z.object({ id: z.string(), by: z.number().default(1) }),
      services: (a) => ({ counter: ref(Counter, { id: a.id }) }),
      execute: (a, { counter }) => (counter.value += a.by),
    }),
    defineTool({
      name: "beta",
      description: "gated",
      input: z.object({}),
      flag: "beta",
      execute: () => "ran",
    }),
  ]);
  return { registry, counts, flags };
}

test("injects services and runs the tool", async () => {
  const { registry } = setup();
  assert.equal(await registry.execute("bump", { id: "a", by: 2 }), 2);
});

test("reuses one service per URN; distinct URNs get distinct services", async () => {
  const { registry, counts } = setup();
  await registry.execute("bump", { id: "a", by: 2 });
  assert.equal(await registry.execute("bump", { id: "a" }), 3, "state persists for same URN");
  assert.equal(counts.created, 1, "create runs once per URN");
  assert.equal(await registry.execute("bump", { id: "b" }), 1);
  assert.equal(counts.created, 2);
  assert.deepEqual(registry.liveUrns().sort(), ["Counter:a", "Counter:b"]);
});

test("concurrent resolves of the same URN share one creation", async () => {
  const { registry, counts } = setup();
  await Promise.all([
    registry.execute("bump", { id: "c" }),
    registry.execute("bump", { id: "c" }),
  ]);
  assert.equal(counts.created, 1);
});

test("rejects unknown tools and invalid args", async () => {
  const { registry } = setup();
  await assert.rejects(registry.execute("nope", {}), UnknownToolError);
  await assert.rejects(registry.execute("bump", { id: 123 }), InvalidToolArgsError);
});

test("feature flags gate execution and listing", async () => {
  const { registry, flags } = setup();
  await assert.rejects(registry.execute("beta", {}), ToolDisabledError);
  assert.equal((await registry.listTools()).find((t) => t.name === "beta").enabled, false);
  flags.beta = true;
  assert.equal(await registry.execute("beta", {}), "ran");
  assert.equal((await registry.listTools()).find((t) => t.name === "beta").enabled, true);
});

test("rejects duplicate registration", () => {
  const { registry } = setup();
  assert.throws(
    () =>
      registry.registerTool(
        defineTool({ name: "bump", description: "x", input: z.object({}), execute: () => 0 }),
      ),
    DuplicateToolError,
  );
});

test("disposeAll disposes every live service once", async () => {
  const { registry, counts } = setup();
  await registry.execute("bump", { id: "a" });
  await registry.execute("bump", { id: "b" });
  await registry.disposeAll();
  assert.equal(counts.disposed, 2);
  assert.deepEqual(registry.liveUrns(), []);
});
