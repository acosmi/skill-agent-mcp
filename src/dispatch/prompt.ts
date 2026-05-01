// Prompt-mode SKILL dispatcher.
//
// `skill_mode=prompt` (the default for the vast majority of crabclaw
// SKILL.md files) means "the SKILL body itself is the answer" —
// there's no tool to call, no sub-agent to spawn, just a markdown
// payload to inject into the calling LLM's context.
//
// We dress it up minimally so the MCP server (commit #17) can register
// every prompt-mode SKILL as one MCP tool with a uniform handler:
// the tool returns the SKILL body as `text` content.

import type { ExtendedSkillMetadata } from "../skill/types.ts";

/** Input shape for the prompt-mode dispatcher. */
export interface PromptModeInput {
  /** Free-form question / context the user wants the SKILL to address. */
  query?: string;
}

/** Output shape — `text` is what the MCP server returns as tool content. */
export interface PromptModeOutput {
  text: string;
}

/**
 * Dispatch a prompt-mode SKILL: hand back the SKILL body verbatim,
 * optionally prepended with the caller's query when supplied.
 *
 * Why no LLM call here: `prompt` SKILLs deliberately delegate the
 * reasoning to the caller's LLM. Anything heavier belongs in
 * `skill_mode=tool` (composed executor) or `skill_mode=agent`
 * (sub-agent spawn).
 */
export function dispatchPromptSkill(
  metadata: ExtendedSkillMetadata,
  body: string,
  input: PromptModeInput = {},
): PromptModeOutput {
  const trimmedBody = body.replace(/^\s+/, "");

  if (input.query && input.query.trim().length > 0) {
    return {
      text: `## Query\n${input.query.trim()}\n\n## SKILL: ${metadata.treeId ?? ""}\n\n${trimmedBody}`,
    };
  }

  return {
    text: trimmedBody,
  };
}
