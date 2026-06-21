/** Thrown when {@link Registry.execute} is given a name no tool is registered under. */
export class UnknownToolError extends Error {
  constructor(public readonly toolName: string) {
    super(`Unknown tool: ${toolName}`);
    this.name = "UnknownToolError";
  }
}

/** Thrown when a tool's feature flag is off at call time. */
export class ToolDisabledError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly flag: string,
  ) {
    super(`Tool "${toolName}" is disabled (feature flag "${flag}" is off)`);
    this.name = "ToolDisabledError";
  }
}

/** Thrown when raw arguments fail the tool's zod schema. `cause` is the ZodError. */
export class InvalidToolArgsError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly cause: unknown,
  ) {
    super(`Invalid arguments for tool "${toolName}"`);
    this.name = "InvalidToolArgsError";
  }
}

/** Thrown when a tool name is registered twice. */
export class DuplicateToolError extends Error {
  constructor(public readonly toolName: string) {
    super(`A tool named "${toolName}" is already registered`);
    this.name = "DuplicateToolError";
  }
}
