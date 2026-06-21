import { z } from "zod";
import type {
  Blueprint,
  ServiceDeps,
  ServiceRef,
  ToolDefinition,
} from "./types.js";

export type {
  AnyBlueprint,
  AnyServiceRef,
  AnyToolDefinition,
  Blueprint,
  ResolvedServices,
  ServiceDeps,
  ServiceRef,
  ToolDefinition,
  ToolInfo,
  Urn,
} from "./types.js";

export {
  DuplicateToolError,
  InvalidToolArgsError,
  ToolDisabledError,
  UnknownToolError,
} from "./errors.js";

export { Registry, type RegistryOptions } from "./registry.js";

/** Pair a Blueprint with an input to form a Service dependency. */
export function ref<TInput, TService>(
  blueprint: Blueprint<TInput, TService>,
  input: TInput,
): ServiceRef<TInput, TService> {
  return { blueprint, input };
}

/** Identity helper that preserves a Blueprint's generic types at the call site. */
export function defineBlueprint<TInput, TService>(
  blueprint: Blueprint<TInput, TService>,
): Blueprint<TInput, TService> {
  return blueprint;
}

/**
 * Identity helper that infers a tool's argument and service types so `execute`
 * is fully typed without manual annotations.
 */
export function defineTool<
  TSchema extends z.ZodTypeAny,
  TDeps extends ServiceDeps,
  TResult,
>(
  tool: ToolDefinition<TSchema, TDeps, TResult>,
): ToolDefinition<TSchema, TDeps, TResult> {
  return tool;
}
