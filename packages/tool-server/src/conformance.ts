// Deterministic style conformance. Compares expected design values (e.g. Figma
// variables) against computed CSS, doing the unit normalization the
// figma-conformance skill would otherwise have to do by hand and by eye:
// hex<->rgb colors, pixel lengths, and font-weight names<->numbers. Pure and
// browser-free, so the matching logic is unit-tested in isolation rather than
// trusted to the agent.

export interface StyleComparison {
  property: string;
  expected: string;
  actual: string | null;
  match: boolean;
  /** How it was normalized, or why it failed. */
  note?: string;
}

export interface ConformanceResult {
  conforms: boolean;
  matched: number;
  total: number;
  comparisons: StyleComparison[];
}

export interface CompareOptions {
  /** Max per-channel RGB difference treated as a match (default 2). */
  colorTolerance?: number;
  /** Max pixel difference treated as a match (default 0.5). */
  lengthTolerance?: number;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

const COLOR_PROPS = new Set([
  "color",
  "backgroundColor",
  "borderColor",
  "fill",
  "stroke",
  "outlineColor",
]);
const LENGTH_PROPS = new Set([
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "borderRadius",
  "borderTopWidth",
  "borderWidth",
  "width",
  "height",
  "gap",
]);
const MULTI_LENGTH_PROPS = new Set(["padding", "margin"]);

function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(s);
  if (rgb) {
    const parts = rgb[1]
      .split(/[,/]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 3) return null;
    const [r, g, b] = [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
    const a = parts[3] != null ? parseFloat(parts[3]) : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a: Number.isNaN(a) ? 1 : a };
  }
  return null;
}

function parseLength(input: string): number | null {
  const m = /^(-?\d*\.?\d+)(px)?$/.exec(input.trim().toLowerCase());
  return m ? parseFloat(m[1]) : null;
}

function toWeight(input: string): number | null {
  const named = WEIGHTS[input.trim().toLowerCase()];
  if (named != null) return named;
  return parseLength(input);
}

function tokens(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

function compareOne(
  property: string,
  expected: string,
  actualRaw: string | undefined,
  opts: Required<CompareOptions>,
): StyleComparison {
  const actual = actualRaw ?? null;
  const base = { property, expected, actual };
  if (actual == null) return { ...base, match: false, note: "no computed value" };

  // Font family: pass if the expected primary family appears in the stack.
  if (property === "fontFamily") {
    const fam = expected.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
    const ok = actual.toLowerCase().includes(fam);
    return { ...base, match: ok, note: ok ? undefined : `"${fam}" not in stack` };
  }

  // Font weight: normalize names (Medium=500, Bold=700, …) to numbers.
  if (property === "fontWeight") {
    const e = toWeight(expected);
    const a = toWeight(actual);
    const ok = e != null && e === a;
    return { ...base, match: ok, note: ok ? `${e}` : `${expected}→${e ?? "?"} vs ${actual}→${a ?? "?"}` };
  }

  // Color: hex or rgb(a) → numeric RGBA with per-channel tolerance.
  if (COLOR_PROPS.has(property)) {
    const e = parseColor(expected);
    const a = parseColor(actual);
    if (e && a) {
      const ok =
        Math.abs(e.r - a.r) <= opts.colorTolerance &&
        Math.abs(e.g - a.g) <= opts.colorTolerance &&
        Math.abs(e.b - a.b) <= opts.colorTolerance &&
        Math.abs(e.a - a.a) <= 0.02;
      return {
        ...base,
        match: ok,
        note: ok ? `rgb(${a.r}, ${a.g}, ${a.b})` : `expected rgb(${e.r}, ${e.g}, ${e.b})`,
      };
    }
  }

  // Single length: compare as pixels with tolerance.
  if (LENGTH_PROPS.has(property)) {
    const e = parseLength(expected);
    const a = parseLength(actual);
    if (e != null && a != null) {
      const ok = Math.abs(e - a) <= opts.lengthTolerance;
      return { ...base, match: ok, note: ok ? `${a}px` : `Δ${(a - e).toFixed(2)}px` };
    }
  }

  // Multi-value length (padding/margin): per-token, with shorthand expansion.
  if (MULTI_LENGTH_PROPS.has(property)) {
    const e = tokens(expected).map(parseLength);
    const a = tokens(actual).map(parseLength);
    if (e.every((x) => x != null) && a.every((x) => x != null)) {
      const eVals = e as number[];
      const aVals = a as number[];
      let ok = false;
      if (eVals.length === 1) ok = aVals.every((v) => Math.abs(v - eVals[0]) <= opts.lengthTolerance);
      else if (eVals.length === aVals.length)
        ok = eVals.every((v, i) => Math.abs(v - aVals[i]) <= opts.lengthTolerance);
      return { ...base, match: ok };
    }
  }

  // Fallback: case-insensitive string equality.
  return { ...base, match: expected.trim().toLowerCase() === actual.trim().toLowerCase() };
}

/** Compare expected design values against computed styles, property by property. */
export function compareStyles(
  expected: Record<string, string>,
  actual: Record<string, string>,
  options: CompareOptions = {},
): ConformanceResult {
  const opts: Required<CompareOptions> = {
    colorTolerance: options.colorTolerance ?? 2,
    lengthTolerance: options.lengthTolerance ?? 0.5,
  };
  const comparisons = Object.entries(expected).map(([prop, val]) =>
    compareOne(prop, String(val), actual[prop], opts),
  );
  const matched = comparisons.filter((c) => c.match).length;
  return { conforms: matched === comparisons.length, matched, total: comparisons.length, comparisons };
}
