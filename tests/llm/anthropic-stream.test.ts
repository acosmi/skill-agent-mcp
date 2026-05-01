import { describe, expect, it } from "bun:test";

import { parseSSEStream, anthropicEventToChunks } from "../../src/llm/anthropic.ts";
import type { LLMStreamChunk, LLMUsage } from "../../src/llm/types.ts";

function makeStream(sseText: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });
}

function dataLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<LLMStreamChunk[]> {
  const out: LLMStreamChunk[] = [];
  for await (const c of parseSSEStream(stream)) out.push(c);
  return out;
}

describe("parseSSEStream — Anthropic content_block index→id mapping", () => {
  it("scenario 1: single tool_use — start/delta/delta/stop emits chunks with consistent id", async () => {
    const sse =
      dataLine({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_01", name: "foo" },
      }) +
      dataLine({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"x' },
      }) +
      dataLine({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '":1}' },
      }) +
      dataLine({ type: "content_block_stop", index: 0 }) +
      dataLine({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 5 },
      });

    const chunks = await collect(makeStream(sse));

    expect(chunks).toEqual([
      { type: "tool_use_start", id: "toolu_01", name: "foo" },
      { type: "tool_use_input_delta", id: "toolu_01", partialJson: '{"x' },
      { type: "tool_use_input_delta", id: "toolu_01", partialJson: '":1}' },
      { type: "tool_use_end", id: "toolu_01" },
      {
        type: "message_end",
        stopReason: "tool_use",
        usage: { inputTokens: 0, outputTokens: 5 },
      },
    ]);
  });

  it("scenario 2: two concurrent tool_uses (index 0 + 1) — input_deltas route to correct id", async () => {
    const sse =
      dataLine({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_A", name: "alpha" },
      }) +
      dataLine({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_B", name: "beta" },
      }) +
      dataLine({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"b":2}' },
      }) +
      dataLine({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"a":1}' },
      }) +
      dataLine({ type: "content_block_stop", index: 0 }) +
      dataLine({ type: "content_block_stop", index: 1 }) +
      dataLine({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 12 },
      });

    const chunks = await collect(makeStream(sse));
    const ids = chunks
      .filter((c): c is Extract<LLMStreamChunk, { type: "tool_use_input_delta" }> =>
        c.type === "tool_use_input_delta",
      )
      .map((c) => ({ id: c.id, partialJson: c.partialJson }));

    expect(ids).toEqual([
      { id: "toolu_B", partialJson: '{"b":2}' },
      { id: "toolu_A", partialJson: '{"a":1}' },
    ]);

    const ends = chunks
      .filter((c): c is Extract<LLMStreamChunk, { type: "tool_use_end" }> =>
        c.type === "tool_use_end",
      )
      .map((c) => c.id);
    expect(ends).toEqual(["toolu_A", "toolu_B"]);
  });

  it("scenario 3: mixed text + tool_use — text_delta unaffected by tool index map", async () => {
    const sse =
      dataLine({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text" },
      }) +
      dataLine({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello " },
      }) +
      dataLine({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "world" },
      }) +
      dataLine({ type: "content_block_stop", index: 0 }) +
      dataLine({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_42", name: "search" },
      }) +
      dataLine({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"q":"x"}' },
      }) +
      dataLine({ type: "content_block_stop", index: 1 }) +
      dataLine({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 7 },
      });

    const chunks = await collect(makeStream(sse));

    expect(chunks.find((c) => c.type === "text_delta" && c.delta === "Hello ")).toBeDefined();
    expect(chunks.find((c) => c.type === "text_delta" && c.delta === "world")).toBeDefined();
    const toolDelta = chunks.find((c) => c.type === "tool_use_input_delta");
    expect(toolDelta).toEqual({
      type: "tool_use_input_delta",
      id: "toolu_42",
      partialJson: '{"q":"x"}',
    });
    const toolEnd = chunks.find((c) => c.type === "tool_use_end");
    expect(toolEnd).toEqual({ type: "tool_use_end", id: "toolu_42" });
    expect(chunks.filter((c) => c.type === "tool_use_start").length).toBe(1);
  });

  it("scenario 4: malformed JSON line silently skipped, subsequent valid events still parsed", async () => {
    const sse =
      "data: {invalid json broken\n\n" +
      dataLine({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_OK", name: "ok" },
      }) +
      dataLine({ type: "content_block_stop", index: 0 }) +
      dataLine({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
      });

    const chunks = await collect(makeStream(sse));

    const ids = chunks
      .filter((c): c is Extract<LLMStreamChunk, { type: "tool_use_start" }> =>
        c.type === "tool_use_start",
      )
      .map((c) => c.id);
    expect(ids).toEqual(["toolu_OK"]);
    expect(
      chunks.find((c): c is Extract<LLMStreamChunk, { type: "tool_use_end" }> =>
        c.type === "tool_use_end",
      ),
    ).toEqual({ type: "tool_use_end", id: "toolu_OK" });
  });
});

describe("anthropicEventToChunks — index→id map state transitions", () => {
  it("content_block_stop with no prior matching start emits no tool_use_end", () => {
    const usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
    const map = new Map<number, string>();
    const out = anthropicEventToChunks(
      { type: "content_block_stop", index: 5 },
      usage,
      map,
    );
    expect(out).toEqual([]);
    expect(map.size).toBe(0);
  });

  it("content_block_stop deletes entry — second stop on same index is a no-op", () => {
    const usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
    const map = new Map<number, string>();
    anthropicEventToChunks(
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_X", name: "x" },
      },
      usage,
      map,
    );
    expect(map.get(0)).toBe("toolu_X");
    const first = anthropicEventToChunks({ type: "content_block_stop", index: 0 }, usage, map);
    expect(first).toEqual([{ type: "tool_use_end", id: "toolu_X" }]);
    expect(map.size).toBe(0);
    const second = anthropicEventToChunks({ type: "content_block_stop", index: 0 }, usage, map);
    expect(second).toEqual([]);
  });
});
