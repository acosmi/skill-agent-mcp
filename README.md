# @acosmi/skill-agent-mcp

> **MCP server exposing skill-driven agent capabilities — SKILL.md as the unified
> fusion layer for tools, prompt fragments, and sub-agents.**

`@acosmi/skill-agent-mcp` wraps the [`@acosmi/agent`](https://github.com/Acosmi/acosmi-agent)
capability-tree subsystem behind a [Model Context Protocol](https://modelcontextprotocol.io)
server, letting external LLM clients (Claude Desktop, Claude Code, Cursor, etc.)
discover and execute SKILL-driven capabilities through a single uniform tool surface.

SKILL.md is treated as a **unified fusion layer**: tools, prompt fragments, and
sub-agents are all expressed in the same template and dispatched server-side
based on `skill_mode`. Externally, every capability appears as one MCP tool.

## Status

**v1.0.0** — initial release **in progress**. The full surface lands across
commits #2 – #22 of the T3-C execution plan; this commit is the bootstrap.

The package is local-only at this stage (`private: true` in `package.json`)
and is not yet published to npm.

## Subsystem layout (planned)

| Module | Purpose |
|--------|---------|
| `@acosmi/skill-agent-mcp/capabilities` | `CapabilityTree` (copied from `@acosmi/agent` v1.0) |
| `@acosmi/skill-agent-mcp/manage` | `executeManageTool` 13-action meta-tool (copied from v1.0) |
| `@acosmi/skill-agent-mcp/llm` | `LLMClient` interface + Anthropic / OpenAI / Ollama adapters (copied from v1.0) |
| `@acosmi/skill-agent-mcp/skill` | `SkillAgentConfig` + multi-source SKILL.md aggregator |
| `@acosmi/skill-agent-mcp/dispatch` | server-side `prompt` / `tool` / `agent` dispatcher + `DelegationContract` + `ResolveSkillAgentCapabilities` |
| `@acosmi/skill-agent-mcp/codegen` | SKILL → composed-tool compiler + executor with `{{var.path}}` template engine |
| `@acosmi/skill-agent-mcp/tools` | natural-language `skill_suggest` / `skill_generate` / `skill_manage` / `skill_activate` |
| `@acosmi/skill-agent-mcp/mcp` | `McpServer` factory + stdio / Streamable HTTP transports |

## License

Apache 2.0 — see [LICENSE](./LICENSE).
