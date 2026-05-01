// Example SpawnSubagent implementation.
//
// The framework deliberately ships no built-in agent runtime — hosts
// are expected to plug in their own LLM loop. This example shows the
// minimum a SpawnSubagent callback has to do:
//
//   1. Receive the SystemPrompt + Task + tool whitelist + contract.
//   2. Run an LLM loop, honouring `subAgentAllowedTools` for tool gating.
//   3. Emit a ThoughtResult when the sub-agent decides it's done.
//   4. Return a SubagentRunOutcome to the dispatcher.
//
// This stub returns a canned "completed" ThoughtResult so the rest of
// the dispatcher pipeline can be exercised end-to-end without an LLM
// dependency.

import type {
  SpawnSubagent,
  SpawnSubagentParams,
  SubagentRunOutcome,
} from "@acosmi/skill-agent-mcp/dispatch";

/**
 * Stub SpawnSubagent — returns a canned ThoughtResult so the
 * dispatcher pipeline runs without needing a real LLM.
 */
export const stubSpawnSubagent: SpawnSubagent = async (
  params: SpawnSubagentParams,
): Promise<SubagentRunOutcome> => {
  return {
    status: "completed",
    thoughtResult: {
      contractId: params.contract.contractId,
      status: "completed",
      result: `(stub) sub-agent received task: ${params.task.slice(0, 80)}`,
      reasoningSummary: `Allowed tools: ${(params.subAgentAllowedTools ?? ["<inherit>"]).join(", ")}.`,
    },
  };
};

/**
 * Sketch of a real LLM-backed SpawnSubagent. Wire your LLMClient
 * (e.g. AnthropicLLMClient or OpenAILLMClient from
 * @acosmi/skill-agent-mcp/llm — OpenAILLMClient also covers Ollama
 * OpenAI mode, vLLM, DeepSeek, OpenRouter, LiteLLM, and any other
 * OpenAI-compatible service via baseUrl override) and run an inner
 * loop until the model emits a structured ThoughtResult.
 *
 * This signature stays stable — hosts can swap the inner body with
 * whatever LLM provider they prefer without touching the dispatcher.
 */
export function makeLLMSpawnSubagent(): SpawnSubagent {
  return async (params: SpawnSubagentParams): Promise<SubagentRunOutcome> => {
    void params;
    throw new Error(
      "makeLLMSpawnSubagent: replace this stub with your own LLMClient + reasoning loop.",
    );
  };
}
