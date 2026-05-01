// LLMClient interface — provider-agnostic LLM contract for the
// @acosmi/agent framework. Per user decision P-3, the framework does
// not bind any specific LLM SDK. Adapters in this folder (anthropic /
// openai) are reference examples; users plug in their own
// implementations against this interface.

export type LLMRole = "user" | "assistant" | "system";

export interface LLMTextBlock {
  type: "text";
  text: string;
}

export interface LLMToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface LLMToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type LLMContentBlock =
  | LLMTextBlock
  | LLMToolUseBlock
  | LLMToolResultBlock;

export interface LLMMessage {
  role: LLMRole;
  /** Plain string is shorthand for [{ type: "text", text }]. */
  content: string | LLMContentBlock[];
}

export interface LLMToolDef {
  name: string;
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  inputSchema: unknown;
}

export interface LLMRequest {
  model?: string;
  messages: LLMMessage[];
  tools?: LLMToolDef[];
  /** System prompt as a separate top-level field (Anthropic-style). */
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional thinking / reasoning budget. */
  thinking?: { enabled: boolean; budgetTokens?: number };
  /** Caller-supplied abort signal. */
  signal?: AbortSignal;
}

export type LLMStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "stop_sequence";

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  id?: string;
  model?: string;
  content: LLMContentBlock[];
  stopReason: LLMStopReason;
  usage: LLMUsage;
}

/** Streamed event types — provider adapters emit these over an async iterable. */
export type LLMStreamChunk =
  | { type: "text_delta"; delta: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_input_delta"; id: string; partialJson: string }
  | { type: "tool_use_end"; id: string }
  | { type: "message_end"; stopReason: LLMStopReason; usage: LLMUsage };

/**
 * Provider-agnostic LLM client. Adapters implement this interface;
 * agents and tool runners depend on it without knowing which provider
 * is wired in.
 */
export interface LLMClient {
  /** Identifying name (e.g. "anthropic" / "openai" / custom — OpenAI adapter
   *  also covers OpenAI-compatible services like Ollama OAI mode, vLLM, DeepSeek). */
  readonly providerId: string;

  /** Send a chat request and get the full response. */
  chat(req: LLMRequest): Promise<LLMResponse>;

  /** Optional: stream incremental chunks via async iteration. */
  chatStream?(req: LLMRequest): AsyncIterable<LLMStreamChunk>;

  /** Optional: list available models for this provider (when discoverable). */
  models?(): Promise<string[]>;
}
