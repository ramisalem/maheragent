import { z } from "zod";

/** Stable identity of a live Service instance, e.g. `BrowserSession:abc123`. */
export type Urn = string;

/**
 * Factory plus lifecycle for one kind of long-lived Service.
 *
 * The Registry uses a Blueprint to create a Service on first need and reuse it
 * for every later call that resolves to the same {@link Urn}.
 */
export interface Blueprint<TInput, TService> {
  /** The URN namespace for this kind of service, e.g. `"BrowserSession"`. */
  readonly kind: string;
  /** Stable identity for the instance this input maps to, e.g. `${kind}:${id}`. */
  urn(input: TInput): Urn;
  /** Create the live service. Called at most once per URN; the result is cached. */
  create(input: TInput): Promise<TService> | TService;
  /** Tear the service down when it is evicted or the Registry is disposed. */
  dispose?(service: TService): Promise<void> | void;
}

/** A dependency on a specific Service instance: a Blueprint paired with its input. */
export interface ServiceRef<TInput, TService> {
  readonly blueprint: Blueprint<TInput, TService>;
  readonly input: TInput;
}

// Loose aliases used where the concrete generics don't matter.
export type AnyBlueprint = Blueprint<any, any>;
export type AnyServiceRef = ServiceRef<any, any>;

/** A tool's declared service dependencies, keyed by the name execute() will see. */
export type ServiceDeps = Record<string, AnyServiceRef>;

/** The live services a tool receives, inferred from its declared {@link ServiceRef}s. */
export type ResolvedServices<TDeps extends ServiceDeps> = {
  [K in keyof TDeps]: TDeps[K] extends ServiceRef<any, infer S> ? S : never;
};

/**
 * A named, agent-callable operation.
 *
 * `input` validates the raw arguments; `services` declares which live Services
 * the call needs (derived from the validated args); `execute` runs the logic
 * against those resolved Services. Tools stay oracles — orchestration and loops
 * live in skills, not here.
 */
export interface ToolDefinition<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TDeps extends ServiceDeps = ServiceDeps,
  TResult = unknown,
> {
  readonly name: string;
  readonly description: string;
  /** Zod schema for the tool's arguments; validated before {@link execute}. */
  readonly input: TSchema;
  /** Optional feature flag; the tool is hidden/blocked when the flag is off. */
  readonly flag?: string;
  /** Declare the Services this call needs, derived from the validated args. */
  services?(args: z.infer<TSchema>): TDeps;
  execute(
    args: z.infer<TSchema>,
    services: ResolvedServices<TDeps>,
  ): Promise<TResult> | TResult;
}

export type AnyToolDefinition = ToolDefinition<z.ZodTypeAny, ServiceDeps, unknown>;

/** What {@link Registry.listTools} reports for one tool. */
export interface ToolInfo {
  name: string;
  description: string;
  flag?: string;
  /** False when the tool is gated by a feature flag that is currently off. */
  enabled: boolean;
  /** The raw zod schema; consumers (e.g. the MCP adapter) convert to JSON Schema. */
  input: z.ZodTypeAny;
}
