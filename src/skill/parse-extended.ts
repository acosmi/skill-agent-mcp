// Extended SKILL.md frontmatter parser.
//
// Wraps the v1.0 `parseSkillFrontmatter` to also populate the seven
// agent_config fields the v1.0 parser drops on the floor (triggers /
// sop / review_gate / stall_threshold_ms / max_retry / escalation_chain
// / snapshot_rollback).
//
// We re-derive the raw frontmatter object from the source string (not
// from `ParsedSkill.metadata`, which has already lost the nested data)
// so the augmentation stays additive and never re-parses agent_config
// fields the v1.0 parser already handled.

import {
  parseFrontmatter,
  parseSkillFrontmatter,
} from "../manage/skill-frontmatter.ts";
import type {
  AgentCronTrigger,
  AgentEventTrigger,
  AgentMessageMatch,
  AgentReviewGate,
  AgentSOPStep,
  AgentTriggers,
  ExtendedSkillMetadata,
  SkillAgentConfig,
} from "./types.ts";

/** Same shape as v1.0 ParsedSkill but `metadata` widens to ExtendedSkillMetadata. */
export interface ExtendedParsedSkill {
  frontmatter: Record<string, unknown>;
  metadata?: ExtendedSkillMetadata;
  content: string;
}

/**
 * Full parse pipeline for SKILL.md sources that may carry the seven
 * extended agent_config fields. Returns undefined under the same
 * conditions as v1.0 parseSkillFrontmatter.
 */
export function parseExtendedSkillFrontmatter(
  source: string,
): ExtendedParsedSkill | undefined {
  const base = parseSkillFrontmatter(source);
  if (!base) return undefined;

  // Fast path: nothing to augment.
  if (!base.metadata?.agentConfig) {
    return base as ExtendedParsedSkill;
  }

  const raw = parseFrontmatter(source);
  const acRaw = raw?.["agent_config"];
  if (!acRaw || typeof acRaw !== "object") {
    return base as ExtendedParsedSkill;
  }

  const acObj = acRaw as Record<string, unknown>;
  const wider: SkillAgentConfig = base.metadata.agentConfig as SkillAgentConfig;

  // Scalar additions
  if (typeof acObj["stall_threshold_ms"] === "number") {
    wider.stallThresholdMs = acObj["stall_threshold_ms"];
  }
  if (typeof acObj["max_retry"] === "number") {
    wider.maxRetry = acObj["max_retry"];
  }
  if (typeof acObj["snapshot_rollback"] === "boolean") {
    wider.snapshotRollback = acObj["snapshot_rollback"];
  }
  const escalation = stringArray(acObj["escalation_chain"]);
  if (escalation !== undefined) {
    wider.escalationChain = escalation;
  }

  // Nested additions
  const triggers = parseAgentTriggers(acObj["triggers"]);
  if (triggers !== undefined) wider.triggers = triggers;

  const sop = parseSOP(acObj["sop"]);
  if (sop !== undefined) wider.sop = sop;

  const reviewGate = parseReviewGate(acObj["review_gate"]);
  if (reviewGate !== undefined) wider.reviewGate = reviewGate;

  return {
    frontmatter: base.frontmatter,
    metadata: { ...base.metadata, agentConfig: wider } as ExtendedSkillMetadata,
    content: base.content,
  };
}

// ── Nested-object parsers ───────────────────────────────────────────

function parseAgentTriggers(v: unknown): AgentTriggers | undefined {
  if (!v || typeof v !== "object") return undefined;
  const obj = v as Record<string, unknown>;
  const out: AgentTriggers = {};
  const cron = parseCronArray(obj["cron"]);
  if (cron !== undefined) out.cron = cron;
  const event = parseEventArray(obj["event"]);
  if (event !== undefined) out.event = event;
  const messageMatch = parseMessageMatchArray(obj["message_match"]);
  if (messageMatch !== undefined) out.messageMatch = messageMatch;
  return out.cron || out.event || out.messageMatch ? out : undefined;
}

function parseCronArray(v: unknown): AgentCronTrigger[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: AgentCronTrigger[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const schedule = typeof obj["schedule"] === "string" ? obj["schedule"] : "";
    const task = typeof obj["task"] === "string" ? obj["task"] : "";
    if (!schedule || !task) continue;
    const entry: AgentCronTrigger = { schedule, task };
    const channels = stringArray(obj["channels"]);
    if (channels !== undefined) entry.channels = channels;
    out.push(entry);
  }
  return out.length ? out : undefined;
}

function parseEventArray(v: unknown): AgentEventTrigger[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: AgentEventTrigger[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const event = typeof obj["event"] === "string" ? obj["event"] : "";
    if (!event) continue;
    const entry: AgentEventTrigger = { event };
    if (typeof obj["source"] === "string") entry.source = obj["source"];
    const channels = stringArray(obj["channels"]);
    if (channels !== undefined) entry.channels = channels;
    out.push(entry);
  }
  return out.length ? out : undefined;
}

function parseMessageMatchArray(v: unknown): AgentMessageMatch[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: AgentMessageMatch[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const pattern = typeof obj["pattern"] === "string" ? obj["pattern"] : "";
    const task = typeof obj["task"] === "string" ? obj["task"] : "";
    if (!pattern || !task) continue;
    const entry: AgentMessageMatch = { pattern, task };
    const channels = stringArray(obj["channels"]);
    if (channels !== undefined) entry.channels = channels;
    out.push(entry);
  }
  return out.length ? out : undefined;
}

function parseSOP(v: unknown): AgentSOPStep[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: AgentSOPStep[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const step = typeof obj["step"] === "string" ? obj["step"] : "";
    if (!step) continue;
    const entry: AgentSOPStep = { step };
    if (typeof obj["prompt"] === "string") entry.prompt = obj["prompt"];
    if (typeof obj["condition"] === "string") entry.condition = obj["condition"];
    const tools = stringArray(obj["tools"]);
    if (tools !== undefined) entry.tools = tools;
    out.push(entry);
  }
  return out.length ? out : undefined;
}

function parseReviewGate(v: unknown): AgentReviewGate | undefined {
  if (!v || typeof v !== "object") return undefined;
  const obj = v as Record<string, unknown>;
  const enabled = typeof obj["enabled"] === "boolean" ? obj["enabled"] : false;
  const out: AgentReviewGate = { enabled };
  if (typeof obj["reviewer"] === "string") out.reviewer = obj["reviewer"];
  if (typeof obj["max_rounds"] === "number") out.maxRounds = obj["max_rounds"];
  const autoApproveTiers = stringArray(obj["auto_approve_tiers"]);
  if (autoApproveTiers !== undefined) out.autoApproveTiers = autoApproveTiers;
  return out;
}

// ── Local helper (mirrors the private one inside skill-frontmatter.ts) ──

function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}
