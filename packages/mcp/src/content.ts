// Shape a raw tool-server result into MCP content blocks.
//
// The one case that matters: a screenshot. The tool-server returns it as
// `{ format: "png", base64 }`, and wrapping that in a text block hands the
// model thousands of tokens of base64 it cannot see. It has to travel as an
// MCP *image* block for the model to look at it — which is the whole point of
// the figma-conformance skill's visual-judgment step.

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ContentBlock = CallToolResult["content"][number];

/** Base64 of the 8-byte PNG signature. A result claiming to be a PNG must start with it. */
const PNG_BASE64_PREFIX = "iVBORw0KGgo";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Split a `{ format: "png", base64, ...rest }` result into its image and the remaining fields. */
function splitImage(
  value: unknown,
): { data: string; mimeType: string; rest: Record<string, unknown> } | null {
  if (!isRecord(value) || value.format !== "png" || typeof value.base64 !== "string") return null;
  // Guard against a non-PNG payload being labelled image/png — the model API
  // rejects such a block outright, which would hide the real result.
  if (!value.base64.startsWith(PNG_BASE64_PREFIX)) return null;
  const { base64, ...rest } = value;
  return { data: base64, mimeType: "image/png", rest };
}

/** Render a tool result as MCP content: an image block for screenshots, text otherwise. */
export function toContent(result: unknown): ContentBlock[] {
  const image = splitImage(result);
  if (image) {
    const blocks: ContentBlock[] = [{ type: "image", data: image.data, mimeType: image.mimeType }];
    // Anything that rode along beside the bytes (format, a path, page state)
    // still reaches the model — as text, after the image.
    if (Object.keys(image.rest).length > 0) {
      blocks.push({ type: "text", text: stringify(image.rest) });
    }
    return blocks;
  }
  // A result may carry an image in one of its fields (screenshot-diff's `diff`):
  // lift each into an image block after the text, leaving the path behind.
  if (isRecord(result)) {
    const images: ContentBlock[] = [];
    const shaped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result)) {
      const nested = splitImage(value);
      if (nested) {
        images.push({ type: "image", data: nested.data, mimeType: nested.mimeType });
        shaped[key] = nested.rest;
      } else {
        shaped[key] = value;
      }
    }
    if (images.length > 0) return [{ type: "text", text: stringify(shaped) }, ...images];
  }
  return [{ type: "text", text: stringify(result) }];
}

export function stringify(value: unknown): string {
  if (value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
