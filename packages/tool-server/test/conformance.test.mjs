import { test } from "node:test";
import assert from "node:assert/strict";
import { compareStyles } from "@ramisalem/tool-server";

test("hex expected matches rgb computed (normalized)", () => {
  const r = compareStyles({ color: "#006580" }, { color: "rgb(0, 101, 128)" });
  assert.equal(r.conforms, true);
  assert.equal(r.comparisons[0].match, true);
});

test("color within tolerance matches; beyond it fails", () => {
  assert.equal(compareStyles({ color: "#1a73e8" }, { color: "rgb(27, 116, 233)" }).conforms, true);
  assert.equal(compareStyles({ color: "#1a73e8" }, { color: "rgb(33, 118, 240)" }).conforms, false);
});

test("font-weight name normalizes to number", () => {
  assert.equal(compareStyles({ fontWeight: "Medium" }, { fontWeight: "500" }).conforms, true);
  assert.equal(compareStyles({ fontWeight: "Bold" }, { fontWeight: "700" }).conforms, true);
  assert.equal(compareStyles({ fontWeight: "Medium" }, { fontWeight: "700" }).conforms, false);
});

test("pixel length compares numerically with tolerance", () => {
  assert.equal(compareStyles({ fontSize: "33.46px" }, { fontSize: "33.46px" }).conforms, true);
  assert.equal(compareStyles({ fontSize: "20" }, { fontSize: "20px" }).conforms, true);
  assert.equal(compareStyles({ fontSize: "20px" }, { fontSize: "17.55px" }).conforms, false);
});

test("font-family matches if the primary family is in the stack", () => {
  const r = compareStyles(
    { fontFamily: "IBM Plex Sans Arabic" },
    { fontFamily: '"IBM Plex Sans Arabic", "IBM Plex Sans Arabic Fallback", system-ui, arial' },
  );
  assert.equal(r.conforms, true);
});

test("padding shorthand expands against four computed values", () => {
  assert.equal(
    compareStyles({ padding: "16px" }, { padding: "16px 16px 16px 16px" }).conforms,
    true,
  );
  assert.equal(
    compareStyles({ padding: "16px" }, { padding: "16px 8px 16px 16px" }).conforms,
    false,
  );
});

test("reports per-property results and a matched count", () => {
  const r = compareStyles(
    { color: "#ffffff", fontSize: "33.46px", fontWeight: "Bold" },
    { color: "rgb(255,255,255)", fontSize: "30px", fontWeight: "700" },
  );
  assert.equal(r.total, 3);
  assert.equal(r.matched, 2); // color + weight match; size off
  assert.equal(r.conforms, false);
  const size = r.comparisons.find((c) => c.property === "fontSize");
  assert.match(size.note, /Δ/);
});

test("a missing computed property is a non-match, not a crash", () => {
  const r = compareStyles({ borderRadius: "8px" }, {});
  assert.equal(r.conforms, false);
  assert.equal(r.comparisons[0].actual, null);
});
