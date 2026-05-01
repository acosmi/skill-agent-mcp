// OpenAI Chat Completions adapter — reference LLMClient implementation.
// Endpoint: POST https://api.openai.com/v1/chat/completions
// Auth: Bearer <apiKey>.
//
// Note: OpenAI's tool-use shape differs from Anthropic's; this adapter
// translates LLMRequest into the chat-completions schema and the
// response back into our LLMContentBlock format. The translation layer
// loses some fidelity (e.g. multi-block assistant messages with mixed
// text + tool calls become separate blocks). Production users should
// validate against the specific OpenAI / Azure / OpenRouter / LiteLLM
// flavour they're targeting.

import type {
  LLMClient,
  LLMContentBlock,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMStopReason,
} from "./types.ts";

export interface OpenAIConfig {
  apiKey: string;
  defaultModel?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

export class OpenAILLMClient implements LLMClient {
  readonly providerId = "openai";
  private readonly config: Required<OpenAIConfig>;

  constructor(config: OpenAIConfig) {
    if (config.apiKey === "") {
      throw new Error("OpenAILLMClient: apiKey is required");
    }
    this.config = {
      apiKey: config.apiKey,
      defaultModel: config.defaultModel ?? DEFAULT_OPENAI_MODEL,
      baseUrl: config.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
      fetch: config.fetch ?? fetch,
    };
  }

  async chat(req: LLMRequest): Promise<LLMResponse> {
    const body = this.buildBody(req);
    const res = await this.config.fetch(
      `${this.config.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `openai chat failed: ${res.status} ${res.statusText} — ${text}`,
      );
    }
    const json = (await res.json()) as OpenAIChatResponse;
    return this.parseResponse(json);
  }

  private buildBody(req: LLMRequest): Record<string, unknown> {
    const messages = this.translateMessages(req);
    const body: Record<string, unknown> = {
      model: req.model ?? this.config.defaultModel,
      messages,
    };
    if (req.maxTokens !== undefined) body.max_completion_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
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
    return body;
  }

  private translateMessages(req: LLMRequest): unknown[] {
    const out: unknown[] = [];
    if (req.systemPrompt !== undefined) {
      out.push({ role: "system", content: req.systemPrompt });
    }
    for (const m of req.messages) {
      if (typeof m.content === "string") {
        out.push({ role: m.role, content: m.content });
        continue;
      }
      // Handle structured content
      out.push(...this.translateStructuredMessage(m));
    }
    return out;
  }

  private translateStructuredMessage(m: LLMMessage): unknown[] {
    if (typeof m.content === "string") {
      return [{ role: m.role, content: m.content }];
    }
    if (m.role === "assistant") {
      // Concatenate text blocks; collect tool_use blocks
      let text = "";
      const toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> = [];
      for (const b of m.content) {
        if (b.type === "text") text += b.text;
        else if (b.type === "tool_use") {
          toolCalls.push({
            id: b.id,
            type: "function",
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input),
            },
          });
        }
      }
      const msg: Record<string, unknown> = { role: "assistant" };
      if (text !== "") msg.content = text;
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      return [msg];
    }
    if (m.role === "user") {
      // tool_result blocks become role:"tool" messages; text blocks stay as user content
      const out: unknown[] = [];
      let text = "";
      for (const b of m.content) {
        if (b.type === "text") text += b.text;
        else if (b.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: b.toolUseId,
            content: b.content,
          });
        }
      }
      if (text !== "") out.unshift({ role: "user", content: text });
      return out;
    }
    return [{ role: m.role, content: m.content.map((b) => "text" in b ? b.text : "").join("") }];
  }

  private parseResponse(json: OpenAIChatResponse): LLMResponse {
    const choice = json.choices?.[0];
    const content: LLMContentBlock[] = [];
    if (choice?.message?.content !== undefined && choice.message.content !== null && choice.message.content !== "") {
      content.push({ type: "text", text: choice.message.content });
    }
    if (choice?.message?.tool_calls !== undefined) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: safeParseJson(tc.function.arguments),
        });
      }
    }
    return {
      id: json.id,
      model: json.model,
      content,
      stopReason: mapOpenAIFinish(choice?.finish_reason),
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }
}

interface OpenAIChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function mapOpenAIFinish(s: string | undefined): LLMStopReason {
  switch (s) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return "end_turn";
  }
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
