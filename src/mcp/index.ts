// Public surface for the MCP server subsystem.
//
// `createServer` returns an `McpServer` ready for `await server.connect(transport)`.
// Transport factories (stdio + Streamable HTTP) live in ./transport.ts.

export {
  createServer,
  type CreateServerOptions,
} from "./server.ts";

export { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export {
  createStdioTransport,
  createStreamableHttpTransport,
  type CreateStreamableHttpOptions,
  type TransportMode,
} from "./transport.ts";
