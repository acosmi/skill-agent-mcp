// SkillMode validation + normalization.
//
// Translated from crabclaw frontmatter.go:259-322 (ResolvedSkillMode +
// ValidateSkillMode + NormalizeSkillMode). The Go side returns plain
// errors; we return structured `SkillModeValidationError` so MCP tool
// handlers can present a uniform error envelope without parsing message
// strings.
//
// v1.2.0 additions:
//   - T1 literal-secret scan: when ValidateSkillModeOptions.source is
//     supplied, refuses SKILL.md content that contains recognisable
//     token shapes (sk-... / ghp_... / Bearer ... / etc.).
//   - T2 secret_refs existence: when ValidateSkillModeOptions
//     .secretProvider is supplied, verifies every secret_refs entry is
//     a registered profile.
//   Both checks are opt-in via options — single-arg callers continue
//   to work unchanged.

import { findLiteralSecret } from "../secrets/redact.ts";
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
 * Optional sub-checks for `validateSkillMode`. All fields are optional
 * — the original single-arg signature still works unchanged.
 */
export interface ValidateSkillModeOptions {
  /**
   * Original SKILL.md source string (frontmatter + body). When provided,
   * runs T1 literal-secret scan. Omit to skip this check (e.g. when
   * validating an in-memory metadata object you constructed yourself).
   */
  source?: string;
  /**
   * Hook for verifying every entry in `meta.secretRefs` resolves to a
   * registered profile. Pass the host's SecretProvider to enable T2.
   * Typed as a structural minimum so test doubles don't need to depend
   * on the full SecretProvider interface.
   */
  secretProvider?: { hasProfile(name: string): boolean };
}

/**
 * Validate the agent_config / tool_schema mutual-exclusion rules. Returns
 * `null` on success and a structured error otherwise.
 *
 * The function is pure — it does not mutate the input. Default values
 * for `runtime_kind` are applied separately by `normalizeSkillMode`.
 *
 * Optional T1/T2 secret-profile checks are gated on `opts` — see
 * `ValidateSkillModeOptions` for how to enable each.
 */
export function validateSkillMode(
  meta: ExtendedSkillMetadata | BaseCrabClawSkillMetadata,
  opts?: ValidateSkillModeOptions,
): SkillModeValidationError | null {
  const mode = resolvedSkillMode(meta);

  // T1 — literal-secret scan (run BEFORE structural checks so a SKILL
  // that's malformed AND leaks a token still reports the leak; a leak
  // is the more pressing problem).
  if (opts?.source) {
    const hit = findLiteralSecret(opts.source);
    if (hit) {
      return {
        code: "literal_secret_rejected",
        message: `SKILL source contains what looks like a literal secret (${hit.label}). Move the value to a secret profile and reference it via secret_refs.`,
        resolvedMode: mode,
      };
    }
  }

  // T2 — secret_refs existence check (only when a provider is supplied).
  if (opts?.secretProvider && meta.secretRefs && meta.secretRefs.length > 0) {
    for (let i = 0; i < meta.secretRefs.length; i++) {
      const ref = meta.secretRefs[i]!;
      if (!opts.secretProvider.hasProfile(ref)) {
        return {
          code: "missing_secret_profile",
          message: `secret_refs[${i}] = ${JSON.stringify(ref)} is not a registered secret profile`,
          resolvedMode: mode,
          field: `secret_refs[${i}]`,
        };
      }
    }
  }

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
