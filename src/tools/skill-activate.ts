// `skill_activate` MCP tool — invoke a SKILL by name through the
// three-mode dispatcher to verify it works end-to-end before binding
// it into the capability tree as a permanent MCP tool.
//
// Useful for fast iteration: the client LLM can edit SKILL.md via
// `skill_generate` / `skill_manage update`, then run `skill_activate`
// to validate the runtime behaviour without restarting the MCP server.

import {
  dispatchSkill,
  type DispatchSkillContext,
  type DispatchSkillInput,
  type DispatchSkillOutput,
  type DispatchSkillTarget,
  type ResolvedAgentSkill,
  type SkillSourceResolver,
  type ToolModeContext,
  type SpawnContext,
} from "../dispatch/index.ts";
import {
  type ExtendedSkillMetadata,
  parseExtendedSkillFrontmatter,
  resolvedSkillMode,
} from "../skill/index.ts";
import { type SkillMode } from "../skill/types.ts";

// ── Types ──────────────────────────────────────────────────────────

export interface SkillActivateInput {
  /** SKILL identifier — looked up via SkillSourceResolver. */
  skillName: string;
  /** Mode-specific input payload (see DispatchSkillInput). */
  modeInput?: {
    prompt?: { query?: string };
    tool?: Record<string, unknown>;
    agent?: { task?: string; timeoutMs?: number };
  };
}

export interface SkillActivateOutput {
  ok: boolean;
  resolvedMode?: SkillMode;
  /** Populated when ok=true. */
  result?: DispatchSkillOutput;
  /** Populated when ok=false. */
  error?: string;
}

export interface SkillActivateContext {
  resolver: SkillResolverWithBody;
  dispatch: DispatchSkillContext;
}

/**
 * Skill resolver extended to also return the prompt/tool body for
 * non-agent SKILLs (the agent-only SkillSourceResolver only carries
 * SkillAgentConfig + skillBody).
 */
export interface SkillResolverWithBody extends SkillSourceResolver {
  /** Returns the parsed metadata + body for any SKILL (any mode). */
  resolveAny(skillName: string): SkillResolution | undefined;
}

export interface SkillResolution {
  metadata: ExtendedSkillMetadata;
  body: string;
}

// ── MCP tool input schema ──────────────────────────────────────────

export const SKILL_ACTIVATE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    skill_name: {
      type: "string",
      description: "SKILL identifier resolvable by the host's SkillSourceResolver.",
    },
    mode_input: {
      type: "object",
      description: "Mode-specific input payload — populate the field matching the SKILL's resolved mode.",
      properties: {
        prompt: {
          type: "object",
          properties: { query: { type: "string" } },
        },
        tool: {
          type: "object",
          description: "Tool-mode input — passed through to ComposedSubsystem.executeTool.",
        },
        agent: {
          type: "object",
          properties: {
            task: { type: "string" },
            timeout_ms: { type: "integer" },
          },
        },
      },
    },
  },
  required: ["skill_name"],
} as const;

// ── Entry point ────────────────────────────────────────────────────

export async function executeSkillActivate(
  input: SkillActivateInput,
  context: SkillActivateContext,
  signal?: AbortSignal,
): Promise<SkillActivateOutput> {
  if (!input.skillName || !input.skillName.trim()) {
    return { ok: false, error: "skill_name is required" };
  }

  const resolution = context.resolver.resolveAny(input.skillName);
  if (!resolution) {
    return { ok: false, error: `skill ${JSON.stringify(input.skillName)} not found` };
  }
  const mode = resolvedSkillMode(resolution.metadata);

  const dispatchInput: DispatchSkillInput = {};
  if (input.modeInput?.prompt) dispatchInput.prompt = input.modeInput.prompt;
  if (input.modeInput?.tool) dispatchInput.tool = input.modeInput.tool;
  if (input.modeInput?.agent) {
    dispatchInput.agent = {
      task: input.modeInput.agent.task ?? "",
      ...(input.modeInput.agent.timeoutMs !== undefined && {
        timeoutMs: input.modeInput.agent.timeoutMs,
      }),
    };
  }

  // Convert SkillResolution → DispatchSkillTarget or ResolvedAgentSkill
  let target: ResolvedAgentSkill | DispatchSkillTarget;
  if (mode === "agent" && resolution.metadata.agentConfig) {
    target = {
      skillName: input.skillName,
      agentConfig: resolution.metadata.agentConfig,
      skillBody: resolution.body,
    };
  } else {
    target = {
      skillName: input.skillName,
      metadata: resolution.metadata,
      body: resolution.body,
    };
  }

  // Sanity check: agent / tool modes need their per-mode contexts.
  if (mode === "agent" && !context.dispatch.agent) {
    return {
      ok: false,
      resolvedMode: mode,
      error: "agent-mode SKILL requires DispatchSkillContext.agent (SpawnContext)",
    };
  }
  if (mode === "tool" && !context.dispatch.tool) {
    return {
      ok: false,
      resolvedMode: mode,
      error: "tool-mode SKILL requires DispatchSkillContext.tool (ToolModeContext)",
    };
  }

  let result: DispatchSkillOutput;
  try {
    result = await dispatchSkill(target, dispatchInput, context.dispatch, signal);
  } catch (err) {
    return {
      ok: false,
      resolvedMode: mode,
      error: errMsg(err),
    };
  }
  return { ok: true, resolvedMode: mode, result };
}

// ── Convenience: build a SkillResolverWithBody from a parsed map ──

/**
 * Build a `SkillResolverWithBody` from a static map of SKILL.md
 * sources. Useful for tests + small / static SKILL libraries; for
 * larger / dynamically-discovered libraries the host should provide
 * a real implementation that walks disk.
 */
export function staticSkillResolver(
  sources: Record<string, string>,
): SkillResolverWithBody {
  const cache = new Map<string, SkillResolution>();
  for (const [name, content] of Object.entries(sources)) {
    const parsed = parseExtendedSkillFrontmatter(content);
    if (parsed?.metadata) {
      cache.set(name, { metadata: parsed.metadata, body: parsed.content });
    }
  }
  return {
    resolveAny(name: string): SkillResolution | undefined {
      return cache.get(name);
    },
    resolveAgentSkill(name: string): ResolvedAgentSkill | undefined {
      const r = cache.get(name);
      if (!r || resolvedSkillMode(r.metadata) !== "agent") return undefined;
      const agentConfig = r.metadata.agentConfig;
      if (!agentConfig) return undefined;
      return { skillName: name, agentConfig, skillBody: r.body };
    },
    listAgentSkills(): string[] {
      const out: string[] = [];
      for (const [name, res] of cache) {
        if (resolvedSkillMode(res.metadata) === "agent") out.push(name);
      }
      out.sort();
      return out;
    },
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Re-exports for convenience — callers commonly want all three contexts.
export type { DispatchSkillContext, SpawnContext, ToolModeContext };
