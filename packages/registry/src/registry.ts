import {
  DuplicateToolError,
  InvalidToolArgsError,
  ToolDisabledError,
  UnknownToolError,
} from "./errors.js";
import type {
  AnyBlueprint,
  AnyServiceRef,
  AnyToolDefinition,
  ServiceRef,
  ToolInfo,
  Urn,
} from "./types.js";

export interface RegistryOptions {
  /**
   * Decide whether a feature-flagged tool may run / be listed as enabled.
   * Omitted ⇒ every flag is treated as enabled.
   */
  isFlagEnabled?(flag: string): boolean | Promise<boolean>;
}

interface CacheEntry {
  readonly urn: Urn;
  readonly blueprint: AnyBlueprint;
  /** The in-flight or settled creation promise — cached so concurrent resolves share one instance. */
  readonly service: Promise<unknown>;
}

/**
 * Holds the registered tools and the cache of live Services.
 *
 * The Registry is the only place that knows how to turn a tool call into a
 * result: validate the args, gate on the feature flag, resolve the tool's
 * Service dependencies (creating each at most once per {@link Urn}), then run
 * the tool. It owns no domain logic itself.
 */
export class Registry {
  readonly #tools = new Map<string, AnyToolDefinition>();
  readonly #services = new Map<Urn, CacheEntry>();
  readonly #options: RegistryOptions;

  constructor(options: RegistryOptions = {}) {
    this.#options = options;
  }

  /** Register a tool. Throws {@link DuplicateToolError} on a name clash. */
  registerTool(tool: AnyToolDefinition): this {
    if (this.#tools.has(tool.name)) throw new DuplicateToolError(tool.name);
    this.#tools.set(tool.name, tool);
    return this;
  }

  /** Register several tools at once. */
  registerTools(tools: Iterable<AnyToolDefinition>): this {
    for (const tool of tools) this.registerTool(tool);
    return this;
  }

  /** Describe every registered tool, including whether its flag is currently on. */
  async listTools(): Promise<ToolInfo[]> {
    const infos: ToolInfo[] = [];
    for (const tool of this.#tools.values()) {
      infos.push({
        name: tool.name,
        description: tool.description,
        flag: tool.flag,
        enabled: tool.flag ? await this.#isEnabled(tool.flag) : true,
        input: tool.input,
      });
    }
    return infos;
  }

  /**
   * Run a tool by name.
   *
   * Validates `rawArgs`, enforces the feature flag, resolves the tool's Service
   * dependencies, and returns the tool's result.
   *
   * @throws {UnknownToolError} no tool registered under `name`
   * @throws {ToolDisabledError} the tool's flag is off
   * @throws {InvalidToolArgsError} `rawArgs` fail the tool's schema
   */
  async execute(name: string, rawArgs: unknown): Promise<unknown> {
    const tool = this.#tools.get(name);
    if (!tool) throw new UnknownToolError(name);

    if (tool.flag && !(await this.#isEnabled(tool.flag))) {
      throw new ToolDisabledError(name, tool.flag);
    }

    const parsed = tool.input.safeParse(rawArgs);
    if (!parsed.success) throw new InvalidToolArgsError(name, parsed.error);
    const args = parsed.data;

    const deps = Object.entries(tool.services?.(args) ?? {});
    const resolved = await Promise.all(
      deps.map(([, ref]) => this.resolveService(ref)),
    );
    const services: Record<string, unknown> = {};
    deps.forEach(([key], i) => {
      services[key] = resolved[i];
    });

    return tool.execute(args, services as never);
  }

  /**
   * Resolve a Service for a {@link ServiceRef}, creating it on first need and
   * reusing the cached instance for the same {@link Urn} thereafter. Concurrent
   * resolves of the same URN share a single creation.
   */
  resolveService<TInput, TService>(
    ref: ServiceRef<TInput, TService>,
  ): Promise<TService> {
    const urn = ref.blueprint.urn(ref.input);
    const existing = this.#services.get(urn);
    if (existing) return existing.service as Promise<TService>;

    const service = (async () => ref.blueprint.create(ref.input))();
    this.#services.set(urn, { urn, blueprint: ref.blueprint, service });

    // A failed creation must not stay cached, or the URN is poisoned forever.
    service.catch(() => {
      const current = this.#services.get(urn);
      if (current?.service === service) this.#services.delete(urn);
    });

    return service as Promise<TService>;
  }

  /** The URNs of every Service currently held alive. */
  liveUrns(): Urn[] {
    return [...this.#services.keys()];
  }

  /** Dispose and forget a single Service. No-op if the URN isn't live. */
  async evict(urn: Urn): Promise<void> {
    const entry = this.#services.get(urn);
    if (!entry) return;
    this.#services.delete(urn);
    await this.#dispose(entry);
  }

  /** Dispose every live Service. Call on tool-server shutdown. */
  async disposeAll(): Promise<void> {
    const entries = [...this.#services.values()];
    this.#services.clear();
    await Promise.all(entries.map((entry) => this.#dispose(entry)));
  }

  async #isEnabled(flag: string): Promise<boolean> {
    if (!this.#options.isFlagEnabled) return true;
    return this.#options.isFlagEnabled(flag);
  }

  async #dispose(entry: CacheEntry): Promise<void> {
    try {
      const service = await entry.service;
      await entry.blueprint.dispose?.(service);
    } catch {
      // Creation already failed (nothing to dispose) or dispose threw —
      // the entry is gone from the map either way.
    }
  }
}
