// Public surface for the dispatch subsystem.
//
// The MCP server imports `dispatchSkill` and the typed context
// interfaces from here, then registers a single MCP tool per
// SKILL.md. All three modes (prompt / tool / agent) collapse into one
// uniform tool surface for external clients.

import {
  type ResolvedAgentSkill,
  type SpawnAgentInput,
  type SpawnContext,
  executeSkillDrivenSpawn,
} from "./agent.ts";
import { dispatchPromptSkill, type PromptModeInput, type PromptModeOutput } from "./prompt.ts";
import {
  dispatchToolSkill,
  type ToolModeContext,
  type ToolModeInput,
  type ToolModeOutput,
} from "./tool.ts";
import { resolvedSkillMode } from "../skill/validate.ts";
import type { ExtendedSkillMetadata, SkillMode } from "../skill/types.ts";

// ── Re-exports (single import surface) ─────────────────────────────

export * from "./agent-capabilities.ts";
export * from "./agent.ts";
export * from "./delegation-contract.ts";
export * from "./prompt.ts";
export * from "./tool.ts";

// ── Combined dispatcher ────────────────────────────────────────────

/** Per-mode input union — populated based on the resolved SkillMode. */
export interface DispatchSkillInput {
  /** Free-form text query (`skill_mode=prompt`). */
  prompt?: PromptModeInput;
  /** Structured tool input (`skill_mode=tool`). */
  tool?: ToolModeInput;
  /** Sub-agent spawn parameters (`skill_mode=agent`). */
  agent?: Omit<SpawnAgentInput, "skillName">;
}

/** Per-mode context union. */
export interface DispatchSkillContext {
  /** Required when SkillMode resolves to `tool`. */
  tool?: ToolModeContext;
  /** Required when SkillMode resolves to `agent`. */
  agent?: SpawnContext;
}

/** Per-mode output union. */
export type DispatchSkillOutput =
  | { mode: "prompt"; output: PromptModeOutput }
  | { mode: "tool"; output: ToolModeOutput }
  | { mode: "agent"; output: { text: string } };

/**
 * Top-level dispatcher: resolves the SKILL's mode and routes to the
 * right per-mode handler.
 *
 * Throws when the resolved mode lacks the required context (e.g.
 * tool-mode SKILL but `context.tool` was not supplied) — those are
 * configuration errors at MCP server wiring time, not user-facing.
 */
export async function dispatchSkill(
  resolved: ResolvedAgentSkill | DispatchSkillTarget,
  input: DispatchSkillInput,
  context: DispatchSkillContext,
  signal?: AbortSignal,
): Promise<DispatchSkillOutput> {
  // Normalize input: ResolvedAgentSkill (agent mode) or generic target.
  const target: DispatchSkillTarget = isResolvedAgentSkill(resolved)
    ? {
        skillName: resolved.skillName,
        metadata: synthesizeAgentMetadata(resolved),
        body: resolved.skillBody,
      }
    : resolved;

  const mode: SkillMode = resolvedSkillMode(target.metadata);

  switch (mode) {
    case "prompt": {
      const out = dispatchPromptSkill(
        target.metadata,
        target.body,
        input.prompt ?? {},
      );
      return { mode: "prompt", output: out };
    }
    case "tool": {
      if (!context.tool) {
        throw new Error(
          "dispatchSkill: tool-mode SKILL requires context.tool (with ToolCallbackRegistry)",
        );
      }
      const out = await dispatchToolSkill(
        target.metadata,
        input.tool ?? {},
        context.tool,
        signal,
      );
      return { mode: "tool", output: out };
    }
    case "agent": {
      if (!context.agent) {
        throw new Error(
          "dispatchSkill: agent-mode SKILL requires context.agent (with SpawnContext)",
        );
      }
      // Agent mode requires a ResolvedAgentSkill; rebuild if we only
      // got a generic target.
      const resolvedAgent: ResolvedAgentSkill = isResolvedAgentSkill(resolved)
        ? resolved
        : extractAgentSkill(target);
      const text = await executeSkillDrivenSpawn(
        {
          skillName: target.skillName,
          ...(input.agent ?? { task: "" }),
        } as SpawnAgentInput,
        resolvedAgent,
        context.agent,
        signal,
      );
      return { mode: "agent", output: { text } };
    }
  }
}

/**
 * Generic skill target — used for prompt-mode + tool-mode SKILLs that
 * don't need the full ResolvedAgentSkill shape.
 */
export interface DispatchSkillTarget {
  skillName: string;
  metadata: ExtendedSkillMetadata;
  body: string;
}

function isResolvedAgentSkill(
  v: ResolvedAgentSkill | DispatchSkillTarget,
): v is ResolvedAgentSkill {
  return (
    typeof (v as ResolvedAgentSkill).agentConfig === "object" &&
    (v as ResolvedAgentSkill).agentConfig !== null &&
    typeof (v as ResolvedAgentSkill).skillBody === "string"
  );
}

/** Re-derive a metadata shell so the prompt + tool branches type-check. */
function synthesizeAgentMetadata(
  resolved: ResolvedAgentSkill,
): ExtendedSkillMetadata {
  return {
    treeId: resolved.skillName,
    skillMode: "agent",
    agentConfig: resolved.agentConfig,
  };
}

function extractAgentSkill(target: DispatchSkillTarget): ResolvedAgentSkill {
  const cfg = target.metadata.agentConfig;
  if (!cfg) {
    throw new Error(
      `dispatchSkill: target ${JSON.stringify(target.skillName)} has skill_mode=agent but no agent_config`,
    );
  }
  return {
    skillName: target.skillName,
    agentConfig: cfg,
    skillBody: target.body,
  };
}
