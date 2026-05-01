import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  startStreamableHttpServer,
  type StartedHttpServer,
} from "../../src/mcp/transport.ts";

// Tiny MCP server fixture — 1 tool, no I/O. createServer would work here
// too, but we'd need to spin up the full skill resolver / store stack
// just to verify HTTP wiring. P0-2 is purely about whether requests
// reach handleRequest, not about which tools the server exposes.
function makeFixtureServer(): McpServer {
  const server = new McpServer({ name: "p0-2-fixture", version: "0.0.1" });
  server.registerTool(
    "ping",
    {
      description: "Returns pong",
      inputSchema: { input: z.string().optional().describe("Echoed back") },
    },
    async ({ input }) => ({
      content: [{ type: "text" as const, text: `pong:${input ?? ""}` }],
    }),
  );
  return server;
}

let started: StartedHttpServer;

beforeAll(async () => {
  started = await startStreamableHttpServer({
    serverFactory: makeFixtureServer,
    port: 0, // OS-assigned to avoid races on a fixed port
    host: "127.0.0.1",
  });
});

afterAll(async () => {
  await started.close();
});

describe("startStreamableHttpServer (P0-2)", () => {
  it("listens on the chosen host:port and reports a /mcp URL", () => {
    expect(started.host).toBe("127.0.0.1");
    expect(started.port).toBeGreaterThan(0);
    expect(started.url).toBe(`http://127.0.0.1:${started.port}/mcp`);
  });

  it("POST /mcp initialize → 200 + mcp-session-id header (full handshake)", async () => {
    const initBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "p0-2-test", version: "0.0.1" },
      },
    };
    const res = await fetch(started.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initBody),
    });
    expect(res.status).toBe(200);
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    // SSE-style response from initialize per the SDK; consume it.
    await res.text();
  });

  it("POST /mcp without session id and not init → 400", async () => {
    const res = await fetch(started.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "tools/list",
        params: {},
      }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /mcp without session id → 400", async () => {
    const res = await fetch(started.url, { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("end-to-end: initialize → notifications/initialized → tools/list reaches the registered tool", async () => {
    // 1) initialize and capture session id
    const initRes = await fetch(started.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "p0-2-test", version: "0.0.1" },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    await initRes.text();

    // 2) notify initialized (per MCP handshake)
    const initializedRes = await fetch(started.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
    });
    // notifications return 202 Accepted (no JSON-RPC reply expected).
    expect([200, 202]).toContain(initializedRes.status);
    await initializedRes.text();

    // 3) tools/list → response should include "ping"
    const listRes = await fetch(started.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    expect(listRes.status).toBe(200);
    const text = await listRes.text();
    expect(text).toContain("ping");
  });
});
