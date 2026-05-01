// Tool-mode SKILL dispatcher.
//
// `skill_mode=tool` SKILLs declare a `tool_schema` containing a sequence
// of `steps[]` that compose existing tools (and sometimes other SKILLs)
// into a single callable. Composition runs through the codegen + executor
// pipeline (commits #11–#13).

import {
  ComposedSubsystem,
  type ComposedToolStore,
  type ExecuteToolFn,
  sanitizeName,
} from "../codegen/index.ts";
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
  /**
   * Pluggable tool registry — every step's `tool` name is looked up
   * here. Tools that are not registered fail at execute time with an
   * "tool not registered" error (matches v1.0 expectations).
   */
  registry: ToolCallbackRegistry;
  /**
   * Composed-tool store keyed by the synthesized name `skill_<sanitized>`.
   * Populated by `codegen()` (commit #12) and persisted via
   * loadComposedToolStore / saveComposedToolStore (commit #11).
   */
  composedStore: ComposedToolStore;
}

/**
 * Dispatch a tool-mode SKILL by name. Looks up the compiled
 * ComposedToolDef in `context.composedStore` (synthesized name =
 * `"skill_" + sanitizeName(metadata.treeId)`) and invokes the executor.
 *
 * Returns the executor's markdown-formatted result string as the MCP
 * tool's `text` content. Errors during composed-tool execution are
 * embedded in `output.text` per the per-step `on_error` policy; only
 * configuration errors (missing composed tool, missing registry entry)
 * surface as `text` prefixed with `[skill_mode=tool]`.
 */
export async function dispatchToolSkill(
  metadata: ExtendedSkillMetadata,
  input: ToolModeInput,
  context: ToolModeContext,
  signal?: AbortSignal,
): Promise<ToolModeOutput> {
  const skillName = metadata.treeId ?? "";
  if (!skillName) {
    return {
      text: `[skill_mode=tool] cannot dispatch: SKILL has no tree_id`,
    };
  }
  const composedToolName = "skill_" + sanitizeName(skillName);
  if (!context.composedStore.get(composedToolName)) {
    return {
      text:
        `[skill_mode=tool] composed tool ${JSON.stringify(composedToolName)} not in store ` +
        `(run codegen() against this SKILL.md before dispatching)`,
    };
  }

  const executeToolFn: ExecuteToolFn = async (
    toolName,
    inputJson,
    abortSignal,
  ) => {
    const callback = context.registry.get(toolName);
    if (!callback) {
      throw new Error(
        `tool ${JSON.stringify(toolName)} is not registered in the ToolCallbackRegistry`,
      );
    }
    let inputObj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(inputJson);
      inputObj =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      inputObj = {};
    }
    const result = await callback(inputObj, abortSignal);
    if (typeof result === "string") return result;
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  };

  const subsystem = new ComposedSubsystem(context.composedStore, executeToolFn);
  const text = await subsystem.executeTool(
    composedToolName,
    JSON.stringify(input),
    signal,
  );
  return { text };
}
