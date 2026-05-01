// MCP transport factories.
//
// Two transports cover the common deployment shapes:
//   - stdio (default): the host launches the MCP server as a child
//     process and communicates over stdin / stdout. Used by Claude
//     Desktop / Code, Cursor, etc.
//   - Streamable HTTP: the host runs the MCP server as a long-lived
//     HTTP service and clients connect via the Streamable HTTP
//     transport (the SSE transport is deprecated upstream).
//
// Both factories return ready-to-use Transport instances; callers
// pass the result to `await server.connect(transport)`.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";

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
 * Create a Streamable HTTP MCP transport. The MCP SDK owns the HTTP
 * binding; the caller is responsible for listening on the chosen port
 * (the SDK exposes a fetch / Web-standard handler the host integrates
 * into its own HTTP server framework).
 *
 * Returns the constructed transport plus the resolved port / host so
 * the CLI can log a single "listening at http://host:port/mcp" line.
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
