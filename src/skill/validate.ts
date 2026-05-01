// SkillMode validation + normalization.
//
// Translated from crabclaw frontmatter.go:259-322 (ResolvedSkillMode +
// ValidateSkillMode + NormalizeSkillMode). The Go side returns plain
// errors; we return structured `SkillModeValidationError` so MCP tool
// handlers can present a uniform error envelope without parsing message
// strings.

import type {
  BaseCrabClawSkillMetadata,
  ExtendedSkillMetadata,
  SkillMode,
  SkillModeValidationError,
} from "./types.ts";

const VALID_RUNTIME_KINDS = new Set(["skill", "coder", "media"]);

/**
 * Resolve the effective SkillMode of a metadata object.
 *
 * Priority: explicit `skillMode` field → presence of `toolSchema` → fallback "prompt".
 */
export function resolvedSkillMode(
  meta: ExtendedSkillMetadata | BaseCrabClawSkillMetadata,
): SkillMode {
  if (meta.skillMode) return meta.skillMode;
  if (meta.toolSchema) return "tool";
  return "prompt";
}

/**
 * Validate the agent_config / tool_schema mutual-exclusion rules. Returns
 * `null` on success and a structured error otherwise.
 *
 * The function is pure — it does not mutate the input. Default values
 * for `runtime_kind` are applied separately by `normalizeSkillMode`.
 */
export function validateSkillMode(
  meta: ExtendedSkillMetadata | BaseCrabClawSkillMetadata,
): SkillModeValidationError | null {
  const mode = resolvedSkillMode(meta);

  switch (mode) {
    case "agent": {
      if (!meta.agentConfig) {
        return {
          code: "missing_agent_config",
          message: "skill_mode=agent requires agent_config",
          resolvedMode: mode,
          field: "agent_config",
        };
      }
      if (!meta.agentConfig.roleTitle) {
        return {
          code: "missing_role_title",
          message: "skill_mode=agent requires agent_config.role_title",
          resolvedMode: mode,
          field: "agent_config.role_title",
        };
      }
      if (meta.toolSchema) {
        return {
          code: "tool_schema_with_agent",
          message: "skill_mode=agent prohibits tool_schema",
          resolvedMode: mode,
          field: "tool_schema",
        };
      }
      const rk = meta.agentConfig.runtimeKind || "skill";
      if (!VALID_RUNTIME_KINDS.has(rk)) {
        return {
          code: "invalid_runtime_kind",
          message: `invalid runtime_kind ${JSON.stringify(rk)}, must be skill|coder|media`,
          resolvedMode: mode,
          field: "agent_config.runtime_kind",
        };
      }
      return null;
    }

    case "tool": {
      if (!meta.toolSchema) {
        return {
          code: "missing_tool_schema",
          message: "skill_mode=tool requires tool_schema",
          resolvedMode: mode,
          field: "tool_schema",
        };
      }
      if (meta.agentConfig) {
        return {
          code: "agent_config_with_tool",
          message: "skill_mode=tool prohibits agent_config",
          resolvedMode: mode,
          field: "agent_config",
        };
      }
      if (meta.agentInputSchema || meta.agentOutputSchema) {
        return {
          code: "agent_io_schema_with_tool",
          message:
            "skill_mode=tool prohibits agent_input_schema / agent_output_schema",
          resolvedMode: mode,
          field: meta.agentInputSchema ? "agent_input_schema" : "agent_output_schema",
        };
      }
      return null;
    }

    case "prompt": {
      if (meta.agentConfig) {
        return {
          code: "agent_config_with_prompt",
          message: "skill_mode=prompt prohibits agent_config",
          resolvedMode: mode,
          field: "agent_config",
        };
      }
      if (meta.agentInputSchema || meta.agentOutputSchema) {
        return {
          code: "agent_io_schema_with_prompt",
          message:
            "skill_mode=prompt prohibits agent_input_schema / agent_output_schema",
          resolvedMode: mode,
          field: meta.agentInputSchema ? "agent_input_schema" : "agent_output_schema",
        };
      }
      return null;
    }

    default: {
      return {
        code: "invalid_skill_mode",
        message: `invalid skill_mode ${JSON.stringify(mode)}, must be prompt|tool|agent`,
        resolvedMode: mode,
      };
    }
  }
}

/**
 * Apply post-validation defaults that the Go side stamps on disk
 * (currently: `agent_config.runtime_kind` defaults to "skill").
 *
 * Mutates `meta` in place. Callers should run `validateSkillMode` first.
 */
export function normalizeSkillMode(
  meta: ExtendedSkillMetadata | BaseCrabClawSkillMetadata,
): void {
  if (
    resolvedSkillMode(meta) === "agent" &&
    meta.agentConfig &&
    !meta.agentConfig.runtimeKind
  ) {
    meta.agentConfig.runtimeKind = "skill";
  }
}
