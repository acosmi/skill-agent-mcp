# @acosmi/skill-agent-mcp

> **MCP server exposing skill-driven agent capabilities — SKILL.md as the
> unified fusion layer for tools, prompt fragments, and sub-agents.**

`@acosmi/skill-agent-mcp` wraps the [`@acosmi/agent`](https://github.com/Acosmi/acosmi-agent)
capability-tree subsystem behind a [Model Context Protocol](https://modelcontextprotocol.io)
server, letting external LLM clients (Claude Desktop, Claude Code, Cursor, …)
discover and execute SKILL-driven capabilities through one uniform tool surface.

SKILL.md is treated as a **unified fusion layer**: tools, prompt fragments,
and sub-agents are all expressed in the same template and dispatched
server-side based on `skill_mode`. Every capability still appears as one
MCP tool externally — clients never have to think about which mode they
are invoking.

## Status

**v1.0.0** — initial release. Local-only at this stage (`private: true`
in `package.json`). The package is feature-complete for the documented
surface; subsequent releases will harden the test coverage on `mcp/` +
`e2e/` and add a built-in disk-walking SkillResolver.

## Install (local development)

```bash
git clone https://github.com/Acosmi/acosmi-skill-agent-mcp.git   # placeholder URL
cd acosmi-skill-agent-mcp
bun install
bun test
```

## Quick start: stdio MCP server

```bash
# Start the server with the bundled examples (no host code needed):
bun bin/acosmi-skill-agent-mcp \
  --transport stdio \
  --skills-dir ./examples/skills \
  --templates-dir ./templates \
  --state-dir ./.state
```

For Claude Desktop / Code, drop the snippet from
[`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json)
into your `mcpServers` block.

## Quick start: Streamable HTTP MCP server

```bash
bun bin/acosmi-skill-agent-mcp \
  --transport http \
  --port 3030 \
  --skills-dir ./examples/skills
# → [acosmi-skill-agent-mcp] streamable HTTP transport ready at http://127.0.0.1:3030/mcp
```

## Quick start: programmatic embedding

```ts
import { CapabilityTree, setTreeBuilder } from "@acosmi/skill-agent-mcp/capabilities";
import { ComposedToolStore } from "@acosmi/skill-agent-mcp/codegen";
import { staticSkillResolver, type SkillResolverWithBody } from "@acosmi/skill-agent-mcp/tools";
import { createServer, createStdioTransport } from "@acosmi/skill-agent-mcp/mcp";
import { promises as fs } from "node:fs";

const tree = new CapabilityTree();
setTreeBuilder(() => tree);

const skillSources: Record<string, string> = {
  "tools/demo/hello": await fs.readFile("./skills/hello/SKILL.md", "utf-8"),
};
const skillResolver: SkillResolverWithBody = staticSkillResolver(skillSources);

const server = createServer({
  tree,
  skillsDir: "./skills",
  templatesDir: "./templates",
  stateDir: "./.state",
  skillResolver,
  composedStore: new ComposedToolStore(),
  // spawnSubagent + toolRegistry only needed when SKILLs use those modes
});

await server.connect(createStdioTransport());
```

## MCP tools registered

| Tool | Purpose |
|------|---------|
| `capability_manage` | 13-action meta-tool (inspect / validate / diagnose / patch the tree) — pass the action JSON via `payload`. |
| `tree_lookup_tool` | Resolve a tool name to its tree node id + runtime owner. |
| `tree_dump` | Full tree as JSON. |
| `tree_list_tier` | Every tool node available at / below an intent tier. |
| `tree_list_bindable` | Every node that accepts SKILL.md frontmatter binding. |
| `skill_suggest` | Recommend a starting template from a free-form description. |
| `skill_generate` | Validate-then-save a SKILL.md draft. |
| `skill_manage` | List / get / update / delete / export SKILLs. |
| `skill_activate` | Invoke a SKILL through the dispatcher (gated on `skillResolver`). |
| `skill_parse` | Parse + (optionally) validate a SKILL.md source. |
| `spawn_agent` | Agent-mode SKILL spawn (gated on `skillResolver` + `spawnSubagent`). |

## Subsystem layout

| Module | Purpose |
|--------|---------|
| `@acosmi/skill-agent-mcp/capabilities` | `CapabilityTree` (copied from `@acosmi/agent` v1.0). |
| `@acosmi/skill-agent-mcp/manage` | `executeManageTool` 13-action meta-tool (copied from v1.0). |
| `@acosmi/skill-agent-mcp/llm` | `LLMClient` interface + Anthropic / OpenAI / Ollama adapters. |
| `@acosmi/skill-agent-mcp/skill` | `SkillAgentConfig` (extended) + multi-source SKILL.md aggregator + validation. |
| `@acosmi/skill-agent-mcp/dispatch` | server-side `prompt` / `tool` / `agent` dispatcher + `DelegationContract` + `resolveSkillAgentCapabilities`. |
| `@acosmi/skill-agent-mcp/codegen` | SKILL → composed-tool compiler + executor with `{{var.path}}` template engine. |
| `@acosmi/skill-agent-mcp/tools` | natural-language `skill_suggest` / `skill_generate` / `skill_manage` / `skill_activate`. |
| `@acosmi/skill-agent-mcp/mcp` | `createServer` factory + stdio / Streamable HTTP transports. |

## Documentation

- [`docs/SKILL-TEMPLATE.md`](./docs/SKILL-TEMPLATE.md) — complete SKILL.md grammar.
- [`templates/`](./templates) — five short skeletons (one per `skill_mode` + intent).
- [`examples/`](./examples) — three demo SKILLs + reference callback impls + Claude Desktop config.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — subsystem boundaries + data flow.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — dev setup + commit style.
- [`CHANGELOG.md`](./CHANGELOG.md) — version history.

## Relationship to `@acosmi/agent`

`@acosmi/skill-agent-mcp` copies the v1.0 `capabilities/` + `manage/` +
`llm/` subsystems verbatim and adds the MCP wrapping + dispatcher
concern on top. The two packages stay independent: `@acosmi/agent`
remains a "capability library" with no protocol assumptions, and this
package owns the MCP surface so its dependency profile (zod, MCP SDK)
does not bleed into the v1.0 capability library.

A future cycle will switch the duplicated subsystems to a workspace dep
on `@acosmi/agent` once npm publish is unblocked. The `CHANGELOG.md`
records the v1.0 baseline so the eventual migration is mechanical.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
