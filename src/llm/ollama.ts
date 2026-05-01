// Ollama adapter — reference LLMClient for self-hosted models running
// against a local Ollama instance.
// Endpoint: POST http://localhost:11434/api/chat
// Auth: none (Ollama runs as a local service).
//
// Tool use: Ollama's tool-use API is OpenAI-compatible; this adapter
// reuses much of the OpenAI translation logic but targets the
// /api/chat endpoint with simpler response handling.

import type {
  LLMClient,
  LLMContentBlock,
  LLMRequest,
  LLMResponse,
  LLMStopReason,
} from "./types.ts";

export interface OllamaConfig {
  /** Base URL of the Ollama service. Default: http://localhost:11434 */
  baseUrl?: string;
  /** Default model — must already be pulled (e.g. via `ollama pull llama3.2`). */
  defaultModel?: string;
  fetch?: typeof fetch;
}

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2";

export class OllamaLLMClient implements LLMClient {
  readonly providerId = "ollama";
  private readonly config: Required<OllamaConfig>;

  constructor(config: OllamaConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL,
      defaultModel: config.defaultModel ?? DEFAULT_OLLAMA_MODEL,
      fetch: config.fetch ?? fetch,
    };
  }

  async chat(req: LLMRequest): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: req.model ?? this.config.defaultModel,
      messages: this.buildMessages(req),
      stream: false,
    };
    if (req.tools !== undefined) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }
    if (req.temperature !== undefined) {
      body.options = { temperature: req.temperature };
    }
    const res = await this.config.fetch(
      `${this.config.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: req.signal,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `ollama chat failed: ${res.status} ${res.statusText} — ${text}`,
      );
    }
    const json = (await res.json()) as OllamaChatResponse;
    return this.parseResponse(json);
  }

  async models(): Promise<string[]> {
    const res = await this.config.fetch(`${this.config.baseUrl}/api/tags`);
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    return (json.models ?? []).map((m) => m.name);
  }

  private buildMessages(req: LLMRequest): unknown[] {
    const out: unknown[] = [];
    if (req.systemPrompt !== undefined) {
      out.push({ role: "system", content: req.systemPrompt });
    }
    for (const m of req.messages) {
      if (typeof m.content === "string") {
        out.push({ role: m.role, content: m.content });
        continue;
      }
      // Concatenate text blocks; ollama doesn't do structured content
      let text = "";
      const toolCalls: Array<{ function: { name: string; arguments: unknown } }> = [];
      for (const b of m.content) {
        if (b.type === "text") text += b.text;
        else if (b.type === "tool_use") {
          toolCalls.push({
            function: { name: b.name, arguments: b.input },
          });
        } else if (b.type === "tool_result") {
          out.push({ role: "tool", content: b.content });
        }
      }
      const msg: Record<string, unknown> = { role: m.role };
      if (text !== "") msg.content = text;
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      if (text !== "" || toolCalls.length > 0) out.push(msg);
    }
    return out;
  }

  private parseResponse(json: OllamaChatResponse): LLMResponse {
    const content: LLMContentBlock[] = [];
    const msg = json.message;
    if (msg?.content !== undefined && msg.content !== "") {
      content.push({ type: "text", text: msg.content });
    }
    if (msg?.tool_calls !== undefined) {
      for (let i = 0; i < msg.tool_calls.length; i++) {
        const tc = msg.tool_calls[i]!;
        content.push({
          type: "tool_use",
          id: `ollama-${i}`,
          name: tc.function.name,
          input: tc.function.arguments,
        });
      }
    }
    let stopReason: LLMStopReason = "end_turn";
    if (msg?.tool_calls !== undefined && msg.tool_calls.length > 0) {
      stopReason = "tool_use";
    } else if (json.done === false) {
      stopReason = "max_tokens";
    }
    return {
      model: json.model,
      content,
      stopReason,
      usage: {
        inputTokens: json.prompt_eval_count ?? 0,
        outputTokens: json.eval_count ?? 0,
      },
    };
  }
}

interface OllamaChatResponse {
  model?: string;
  message?: {
    role: string;
    content?: string;
    tool_calls?: Array<{
      function: { name: string; arguments: unknown };
    }>;
  };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}
