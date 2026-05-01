// SKILL types — extends @acosmi/agent v1.0 with the seven nested /
// trigger / SOP / review-gate fields that crabclaw frontmatter.go ships
// in production agent SKILLs (~10 occurrences across 2 prod SKILLs at
// the time of writing).
//
// We intentionally do NOT modify the copies under src/manage/ — those
// stay byte-equivalent to v1.0. Instead, we re-export the broader shape
// here. Consumers should prefer importing from `@acosmi/skill-agent-mcp/skill`
// when they need the agent-mode dispatcher to see triggers / SOP /
// review_gate; importing from `/manage` still works for the narrower
// v1.0 surface.

import type {
  CrabClawSkillMetadata as BaseCrabClawSkillMetadata,
  SkillAgentConfig as BaseSkillAgentConfig,
  SkillMode,
} from "../manage/skill-frontmatter.ts";

// ── Nested types (translated from crabclaw frontmatter.go:215-257) ──

/** Sub-agent automatic trigger configuration. */
export interface AgentTriggers {
  cron?: AgentCronTrigger[];
  event?: AgentEventTrigger[];
  messageMatch?: AgentMessageMatch[];
}

/** Cron-style schedule trigger. */
export interface AgentCronTrigger {
  schedule: string;
  task: string;
  channels?: string[];
}

/** Pattern-based message trigger. */
export interface AgentMessageMatch {
  pattern: string;
  task: string;
  channels?: string[];
}

/** Event source trigger. */
export interface AgentEventTrigger {
  event: string;
  source?: string;
  channels?: string[];
}

/** A single Standard Operating Procedure (SOP) step the sub-agent must follow. */
export interface AgentSOPStep {
  step: string;
  prompt?: string;
  tools?: string[];
  condition?: string;
}

/** Quality review-gate configuration applied at SOP boundaries. */
export interface AgentReviewGate {
  enabled: boolean;
  /** "llm" | "rule" | "human" */
  reviewer?: string;
  maxRounds?: number;
  autoApproveTiers?: string[];
}

// ── Extended SkillAgentConfig (v1.0 + 7 new fields) ─────────────────

/**
 * Full SkillAgentConfig with all 32 fields from crabclaw frontmatter.go:152-213.
 *
 * Extends the v1.0 25-field base via plain `interface … extends …` so that
 * any code that accepts the v1.0 shape still accepts ours.
 */
export interface SkillAgentConfig extends BaseSkillAgentConfig {
  // Auto-trigger / SOP / review-gate
  triggers?: AgentTriggers;
  sop?: AgentSOPStep[];
  reviewGate?: AgentReviewGate;
  // Schedule / fault-tolerance
  stallThresholdMs?: number;
  maxRetry?: number;
  escalationChain?: string[];
  snapshotRollback?: boolean;
}

// ── Extended CrabClawSkillMetadata (rebinds agentConfig to wider shape) ──

/**
 * Same shape as the v1.0 `CrabClawSkillMetadata` except that `agentConfig`
 * resolves to the wider `SkillAgentConfig` defined above. Use this type
 * everywhere the agent-mode dispatcher consumes parsed metadata so that
 * triggers / SOP / review-gate are visible at compile time.
 */
export interface ExtendedSkillMetadata
  extends Omit<BaseCrabClawSkillMetadata, "agentConfig"> {
  agentConfig?: SkillAgentConfig;
}

// ── SkillMode validation result types ───────────────────────────────

/** Reason codes for SkillMode validation failures. */
export type SkillModeValidationCode =
  | "missing_agent_config"
  | "missing_role_title"
  | "tool_schema_with_agent"
  | "missing_tool_schema"
  | "agent_config_with_tool"
  | "agent_io_schema_with_tool"
  | "agent_config_with_prompt"
  | "agent_io_schema_with_prompt"
  | "invalid_runtime_kind"
  | "invalid_skill_mode";

/**
 * Structured validation error (preferred over throwing so callers can
 * present a unified MCP error response without parsing message strings).
 */
export interface SkillModeValidationError {
  code: SkillModeValidationCode;
  message: string;
  /** Echo of the SkillMode the metadata resolved to. */
  resolvedMode: SkillMode;
  /** Field most relevant to the error, where applicable. */
  field?: string;
}

// ── Re-exports (single import surface) ──────────────────────────────

export type {
  BaseCrabClawSkillMetadata,
  BaseSkillAgentConfig,
  SkillMode,
};
