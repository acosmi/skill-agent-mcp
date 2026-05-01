// Anthropic Messages API adapter — reference implementation of LLMClient.
// Uses the global fetch API (built-in to bun and Node 18+).
//
// Endpoint: POST https://api.anthropic.com/v1/messages
// Auth: x-api-key header.
// Streaming: SSE (server-sent events). chatStream() is implemented but
// kept minimal — production users should harden retry / backoff /
// reconnect handling for their use cases.

import type {
  LLMClient,
  LLMContentBlock,
  LLMRequest,
  LLMResponse,
  LLMStopReason,
  LLMUsage,
} from "./types.ts";

export interface AnthropicConfig {
  apiKey: string;
  /** Override the API base URL (e.g. for proxies or LiteLLM). */
  baseUrl?: string;
  /** API version header — defaults to a recent stable version. */
  apiVersion?: string;
  /** Custom fetch implementation (e.g. for retries / instrumentation). */
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_API_VERSION = "2023-06-01";

export class AnthropicLLMClient implements LLMClient {
  readonly providerId = "anthropic";
  private readonly config: Required<AnthropicConfig>;

  constructor(config: AnthropicConfig) {
    if (config.apiKey === "") {
      throw new Error("AnthropicLLMClient: apiKey is required");
    }
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      apiVersion: config.apiVersion ?? DEFAULT_API_VERSION,
      fetch: config.fetch ?? fetch,
    };
  }

  async chat(req: LLMRequest): Promise<LLMResponse> {
    const body = this.buildBody(req, false);
    const res = await this.config.fetch(
      `${this.config.baseUrl}/messages`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: req.signal,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `anthropic chat failed: ${res.status} ${res.statusText} — ${text}`,
      );
    }
    const json = (await res.json()) as AnthropicMessageResponse;
    return this.parseResponse(json);
  }

  async *chatStream(req: LLMRequest): AsyncIterable<import("./types.ts").LLMStreamChunk> {
    const body = this.buildBody(req, true);
    const res = await this.config.fetch(
      `${this.config.baseUrl}/messages`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: req.signal,
      },
    );
    if (!res.ok || res.body === null) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `anthropic stream failed: ${res.status} ${res.statusText} — ${text}`,
      );
    }
    yield* parseSSEStream(res.body);
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": this.config.apiVersion,
    };
  }

  private buildBody(req: LLMRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: req.maxTokens ?? 4096,
    };
    if (req.systemPrompt !== undefined) body.system = req.systemPrompt;
    if (req.tools !== undefined) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.thinking?.enabled === true) {
      body.thinking = {
        type: "enabled",
        budget_tokens: req.thinking.budgetTokens ?? 1024,
      };
    }
    if (stream) body.stream = true;
    return body;
  }

  private parseResponse(json: AnthropicMessageResponse): LLMResponse {
    const content: LLMContentBlock[] = [];
    for (const block of json.content) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        content.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }
    return {
      id: json.id,
      model: json.model,
      content,
      stopReason: mapStopReason(json.stop_reason),
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
    };
  }
}

interface AnthropicMessageResponse {
  id: string;
  model: string;
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

function mapStopReason(s: string): LLMStopReason {
  switch (s) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}

async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<import("./types.ts").LLMStreamChunk> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  let currentUsage: LLMUsage = { inputTokens: 0, outputTokens: 0 };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "" || data === "[DONE]") continue;
      let event: AnthropicSSEEvent;
      try {
        event = JSON.parse(data) as AnthropicSSEEvent;
      } catch {
        continue;
      }
      const chunk = anthropicEventToChunk(event, currentUsage);
      if (chunk !== undefined) {
        if ("usage" in chunk) currentUsage = chunk.usage;
        yield chunk;
      }
    }
  }
}

interface AnthropicSSEEvent {
  type: string;
  index?: number;
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
  content_block?: { type: string; id?: string; name?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  message?: { stop_reason?: string; usage?: { input_tokens: number; output_tokens: number } };
}

function anthropicEventToChunk(
  e: AnthropicSSEEvent,
  carryUsage: LLMUsage,
): import("./types.ts").LLMStreamChunk | undefined {
  switch (e.type) {
    case "content_block_start":
      if (e.content_block?.type === "tool_use") {
        return {
          type: "tool_use_start",
          id: e.content_block.id ?? "",
          name: e.content_block.name ?? "",
        };
      }
      return undefined;
    case "content_block_delta":
      if (e.delta?.type === "text_delta" && e.delta.text !== undefined) {
        return { type: "text_delta", delta: e.delta.text };
      }
      if (e.delta?.type === "input_json_delta" && e.delta.partial_json !== undefined) {
        return { type: "tool_use_input_delta", id: "", partialJson: e.delta.partial_json };
      }
      return undefined;
    case "content_block_stop":
      return undefined;
    case "message_delta":
      if (e.delta?.stop_reason !== undefined) {
        return {
          type: "message_end",
          stopReason: mapStopReason(e.delta.stop_reason),
          usage: e.usage !== undefined
            ? {
                inputTokens: e.usage.input_tokens ?? carryUsage.inputTokens,
                outputTokens: e.usage.output_tokens ?? carryUsage.outputTokens,
              }
            : carryUsage,
        };
      }
      return undefined;
    default:
      return undefined;
  }
}
