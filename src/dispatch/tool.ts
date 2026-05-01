// Tool-mode SKILL dispatcher.
//
// `skill_mode=tool` SKILLs declare a `tool_schema` containing a sequence
// of `steps[]` that compose existing tools (and sometimes other SKILLs)
// into a single callable. Composition runs through the codegen + executor
// pipeline (commits #11–#13).
//
// This file is a placeholder shim until commit #13 lands. We keep the
// interface stable now so MCP tool wiring (commit #17) can be authored
// against the final shape; the body of `dispatchToolSkill` will be
// rewritten in commit #13 to delegate to ComposedSubsystem.executeTool.

import type { ExtendedSkillMetadata } from "../skill/types.ts";

/** Input shape for tool-mode SKILLs (matches `tool_input_schema` declarations). */
export type ToolModeInput = Record<string, unknown>;

/** Output shape — `text` is what the MCP server returns as tool content. */
export interface ToolModeOutput {
  text: string;
  /** Optional structured payload (commit #13 will surface step results here). */
  data?: unknown;
}

/**
 * Tool callback registry — the MCP server hands one of these to the
 * dispatcher so composed steps can resolve to actual tool functions.
 *
 * Why pluggable: the framework deliberately ships zero built-in tools.
 * OSS users register their own (`bash`, `read_file`, custom domain
 * tools, …) and the composed executor (commit #13) walks step.tool
 * names through this registry.
 */
export interface ToolCallback {
  (input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

export interface ToolCallbackRegistry {
  /** Returns undefined when the tool is not registered. */
  get(toolName: string): ToolCallback | undefined;
  /** Registers (or replaces) a callback. */
  register(toolName: string, callback: ToolCallback): void;
  /** Lists registered tool names. */
  names(): string[];
}

/** Default in-memory implementation. OSS users can swap this freely. */
export class InMemoryToolCallbackRegistry implements ToolCallbackRegistry {
  private readonly callbacks = new Map<string, ToolCallback>();

  get(toolName: string): ToolCallback | undefined {
    return this.callbacks.get(toolName);
  }

  register(toolName: string, callback: ToolCallback): void {
    this.callbacks.set(toolName, callback);
  }

  names(): string[] {
    return Array.from(this.callbacks.keys()).sort();
  }
}

/** Context the tool-mode dispatcher receives from the MCP server. */
export interface ToolModeContext {
  /** Pluggable tool registry — required when the SKILL has steps. */
  registry: ToolCallbackRegistry;
}

/**
 * Dispatch a tool-mode SKILL.
 *
 * **Stub** — commit #13 wires this to ComposedSubsystem.executeTool so
 * step composition + `{{var.path}}` template resolution + loop / retry /
 * abort semantics actually run. Until then this returns a structured
 * placeholder so the MCP server wiring (commit #17) can be authored
 * against the final signature without forward dependencies.
 */
export async function dispatchToolSkill(
  metadata: ExtendedSkillMetadata,
  _input: ToolModeInput,
  _context: ToolModeContext,
  _signal?: AbortSignal,
): Promise<ToolModeOutput> {
  return Promise.resolve({
    text:
      `[skill_mode=tool] dispatcher placeholder for ${metadata.treeId ?? "<unknown>"}.\n` +
      `Composed-tool execution lands in commit #13.`,
  });
}
