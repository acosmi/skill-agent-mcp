// Public surface for the MCP server subsystem.
//
// `createServer` returns an `McpServer` ready for `await server.connect(transport)`.
// Transport factories (stdio + Streamable HTTP) land in commit #18.

export {
  createServer,
  type CreateServerOptions,
} from "./server.ts";

export { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
