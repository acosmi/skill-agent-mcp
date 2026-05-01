// Permission monotone-decay for sub-agent skill spawn.
//
// Translated from crabclaw runner/skill_agent_capabilities.go (105 LoC
// Go → ~95 TS). The core invariant — a sub-agent's tool set is always
// a subset of its parent's — is preserved 1:1.
//
// The Go side hard-codes a `minimalToolSet` of {bash, read_file,
// write_file, list_dir}. We keep the same defaults so SKILL.md authored
// against crabclaw moves over without re-tuning. OSS users can override
// by passing `inherit="full"` and an explicit Allow list.

import type { AgentSOPStep, SkillAgentConfig } from "../skill/types.ts";

/**
 * Default starting set when `agent_config.inherit === "minimal"`.
 *
 * Order is irrelevant — the function intersects this set with the
 * parent's tool set before applying Allow / Deny.
 */
export const MINIMAL_TOOL_SET: ReadonlySet<string> = new Set([
  "bash",
  "read_file",
  "write_file",
  "list_dir",
]);

/**
 * Resolve the tool name list a sub-agent may invoke given its parent's
 * tool set and its `agent_config`.
 *
 * Algorithm:
 *   1. Pick a starting set: "none" → ∅, "minimal" → MINIMAL_TOOL_SET ∩
 *      parent, "full" / undefined → parent.
 *   2. Add `allow` entries that are still in the parent set
 *      (monotone-decay: a sub-agent cannot gain a tool the parent lacks).
 *   3. Remove `deny` entries.
 *
 * Returned slice ordering is not guaranteed to be stable; callers that
 * depend on stability should sort the result themselves.
 *
 * Returns a defensive copy of `parentTools` when `cfg` is `undefined`,
 * so the caller can mutate the result without aliasing.
 */
export function resolveSkillAgentCapabilities(
  cfg: SkillAgentConfig | undefined,
  parentTools: readonly string[],
): string[] {
  if (!cfg) return [...parentTools];

  const parentSet = new Set(parentTools);
  let resultSet: Set<string>;

  switch (cfg.inherit) {
    case "none":
      resultSet = new Set();
      break;
    case "minimal":
      resultSet = new Set();
      for (const t of MINIMAL_TOOL_SET) {
        if (parentSet.has(t)) resultSet.add(t);
      }
      break;
    default: // "full" or unspecified
      resultSet = new Set(parentSet);
      break;
  }

  if (cfg.allow) {
    for (const t of cfg.allow) {
      if (parentSet.has(t)) resultSet.add(t);
    }
  }

  if (cfg.deny) {
    for (const t of cfg.deny) {
      resultSet.delete(t);
    }
  }

  return Array.from(resultSet);
}

/**
 * Format an `agent_config.sop` array into a markdown section suitable
 * for prepending to a sub-agent's system prompt.
 *
 * Returns an empty string when `sop` is empty or undefined.
 */
export function buildSOPPromptSection(
  sop: readonly AgentSOPStep[] | undefined,
): string {
  if (!sop || sop.length === 0) return "";
  let out = "\n## Standard Operating Procedure\n";
  for (let i = 0; i < sop.length; i++) {
    const step = sop[i]!;
    out += `${i + 1}. ${step.step}\n`;
    if (step.prompt) {
      out += `   Guidance: ${step.prompt}\n`;
    }
  }
  return out;
}
