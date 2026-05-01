// MCP transport factories.
//
// Two transports cover the common deployment shapes:
//   - stdio (default): the host launches the MCP server as a child
//     process and communicates over stdin / stdout. Used by Claude
//     Desktop / Code, Cursor, etc.
//   - Streamable HTTP: the host runs the MCP server as a long-lived
//     HTTP service and clients connect via the Streamable HTTP
//     transport (the SSE transport is deprecated upstream).

import * as http from "node:http";
import * as crypto from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

// ── Public types ───────────────────────────────────────────────────

/** Transport mode selector for the CLI. */
export type TransportMode = "stdio" | "http";

export interface CreateStreamableHttpOptions
  extends Partial<StreamableHTTPServerTransportOptions> {
  /** TCP port for the HTTP listener. Defaults to 3030. */
  port?: number;
  /** TCP host for the HTTP listener. Defaults to "127.0.0.1". */
  host?: string;
}

export interface StartStreamableHttpServerOptions {
  /**
   * Factory invoked once per new MCP session. Each call must return a
   * fresh McpServer (the SDK binds server↔transport one-to-one, so
   * sharing a server across sessions is not supported).
   */
  serverFactory: () => McpServer;
  /** TCP port. 0 = OS picks a free port; defaults to 3030. */
  port?: number;
  /** TCP host. Defaults to "127.0.0.1" (DNS-rebinding protection auto-on). */
  host?: string;
  /** Allowed Host header values; opt-in DNS-rebinding protection for non-localhost binds. */
  allowedHosts?: string[];
}

export interface StartedHttpServer {
  /** Bound URL including the /mcp path. */
  url: string;
  /** Actual port (resolved when caller passes 0). */
  port: number;
  /** Bound host. */
  host: string;
  /** Gracefully close all sessions and the HTTP listener. */
  close(): Promise<void>;
}

// ── Factories ──────────────────────────────────────────────────────

/**
 * Create a stdio MCP transport. Suitable for Claude Desktop / Code /
 * Cursor and any other client that expects to launch the server as
 * a child process.
 */
export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

/**
 * Create a Streamable HTTP MCP transport object. Kept for callers who
 * want to wire the transport into their own HTTP framework — e.g. a
 * pre-existing express app or a non-express stack. For most users
 * `startStreamableHttpServer` is the better entry point because it
 * actually opens a TCP listener.
 *
 * Returns the constructed transport plus the resolved port / host.
 */
export function createStreamableHttpTransport(
  options: CreateStreamableHttpOptions = {},
): {
  transport: StreamableHTTPServerTransport;
  host: string;
  port: number;
} {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3030;
  const { host: _h, port: _p, ...rest } = options;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    ...rest,
  });
  return { transport, host, port };
}

/**
 * Spin up a fully-listening Streamable HTTP MCP server. Maintains a
 * sessionId → transport map so multiple concurrent clients each get
 * their own MCP session. POST /mcp accepts JSON-RPC, GET /mcp serves
 * SSE notifications, DELETE /mcp terminates a session.
 *
 * Why this exists: StreamableHTTPServerTransport.start() is a no-op in
 * the SDK — without an external HTTP wrapper that forwards req/res to
 * transport.handleRequest, --transport http listens nowhere. Pre-fix
 * the CLI logged "ready at http://..." but the OS had no socket bound.
 */
export async function startStreamableHttpServer(
  options: StartStreamableHttpServerOptions,
): Promise<StartedHttpServer> {
  const desiredPort = options.port ?? 3030;
  const host = options.host ?? "127.0.0.1";

  const app = createMcpExpressApp({
    host,
    ...(options.allowedHosts !== undefined && { allowedHosts: options.allowedHosts }),
  });

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // POST /mcp — JSON-RPC requests + initialization.
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId !== undefined && transports[sessionId] !== undefined) {
        transport = transports[sessionId];
      } else if (sessionId === undefined && isInitializeRequest(req.body)) {
        // New session: stand up a fresh transport + server, register the
        // transport in our session map via onsessioninitialized so future
        // requests with this sessionId hit the same transport.
        const newTransport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = newTransport;
          },
        });
        newTransport.onclose = () => {
          const sid = newTransport.sessionId;
          if (sid !== undefined && transports[sid] !== undefined) {
            delete transports[sid];
          }
        };
        const server = options.serverFactory();
        await server.connect(newTransport);
        await newTransport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  // GET /mcp — SSE notification stream.
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId === undefined || transports[sessionId] === undefined) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // DELETE /mcp — explicit session termination.
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId === undefined || transports[sessionId] === undefined) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  const httpServer = await new Promise<http.Server>((resolve, reject) => {
    const srv = app.listen(desiredPort, host, () => resolve(srv));
    srv.on("error", reject);
  });
  const address = httpServer.address();
  const actualPort =
    typeof address === "object" && address !== null && "port" in address
      ? (address.port as number)
      : desiredPort;

  return {
    url: `http://${host}:${actualPort}/mcp`,
    port: actualPort,
    host,
    close: async () => {
      // Tear down every active session before closing the listener so
      // SSE streams flush their final messages instead of dropping mid-frame.
      for (const [sid, transport] of Object.entries(transports)) {
        try {
          await transport.close();
        } catch {
          // ignore — best-effort cleanup
        }
        delete transports[sid];
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
