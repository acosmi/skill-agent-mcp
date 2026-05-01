// LLMClient — provider-agnostic LLM contract for the @acosmi/agent
// framework. Per user decision P-3, the framework defines the
// interface but does not bind to any specific LLM SDK.
//
// Three reference adapters ship with the framework as illustrative
// examples; users wire their own implementations against the LLMClient
// interface (or fork these for production use).

export type {
  LLMClient,
  LLMContentBlock,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMRole,
  LLMStopReason,
  LLMStreamChunk,
  LLMTextBlock,
  LLMToolDef,
  LLMToolResultBlock,
  LLMToolUseBlock,
  LLMUsage,
} from "./types.ts";

// Reference adapters
export { AnthropicLLMClient } from "./anthropic.ts";
export type { AnthropicConfig } from "./anthropic.ts";

export { OpenAILLMClient } from "./openai.ts";
export type { OpenAIConfig } from "./openai.ts";

export { OllamaLLMClient } from "./ollama.ts";
export type { OllamaConfig } from "./ollama.ts";
