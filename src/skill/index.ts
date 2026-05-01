// Public surface for the SKILL subsystem — extended SkillAgentConfig,
// nested trigger / SOP / review-gate types, validation helpers, and the
// extended SKILL.md frontmatter parser.

export type {
  AgentCronTrigger,
  AgentEventTrigger,
  AgentMessageMatch,
  AgentReviewGate,
  AgentSOPStep,
  AgentTriggers,
  BaseCrabClawSkillMetadata,
  BaseSkillAgentConfig,
  ExtendedSkillMetadata,
  SkillAgentConfig,
  SkillMode,
  SkillModeValidationCode,
  SkillModeValidationError,
} from "./types.ts";

export {
  type ExtendedParsedSkill,
  parseExtendedSkillFrontmatter,
} from "./parse-extended.ts";

export {
  normalizeSkillMode,
  resolvedSkillMode,
  type ValidateSkillModeOptions,
  validateSkillMode,
} from "./validate.ts";

export {
  AggregatedSkillNodeProvider,
  aggregateSkillEntries,
  type AggregateMetrics,
  type AggregateResult,
  buildSkillNodeData,
  type LoadedSkillEntry,
  type SkillSource,
  sourcePriority,
} from "./node-provider.ts";
