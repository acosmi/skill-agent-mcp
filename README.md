# @acosmi/skill-agent-mcp

[中文 README →](./README.zh.md) · [GitHub](https://github.com/acosmi/skill-agent-mcp) · [Issues](https://github.com/acosmi/skill-agent-mcp/issues)

> **MCP server exposing skill-driven agent capabilities — SKILL.md as the
> unified fusion layer for tools, prompt fragments, and sub-agents.**

`@acosmi/skill-agent-mcp` wraps the [`@acosmi/agent`](https://github.com/acosmi/agent)
capability-tree subsystem behind a [Model Context Protocol](https://modelcontextprotocol.io)
server, letting external LLM clients (Claude Desktop, Claude Code, Cursor, …)
discover and execute SKILL-driven capabilities through a **single uniform
tool surface**.

SKILL.md is treated as a **unified fusion layer**: tools, prompt fragments,
and sub-agents all live in the same template grammar and dispatch
server-side based on `skill_mode`. Externally every capability still
appears as one MCP tool — clients never have to think about which mode
they are invoking.

---

## Why this exists

LLM clients today have two main ways to extend their capabilities:

1. **MCP servers** — well-defined protocol, but every tool has to be
   hand-coded in the host language.
2. **In-prompt tool definitions** — flexible, but the LLM has to recall
   tool names and schemas every conversation.

`@acosmi/skill-agent-mcp` collapses the gap: **SKILL.md files are the tool
definition**, loaded server-side once. The same SKILL.md format can express:

- A **prompt fragment** — zero code, pure markdown.
- A **deterministic tool pipeline** — composed steps invoking registered
  tools, with template-driven inputs.
- A **sub-agent spec** — role + capability whitelist + token / time
  budget for spawning a child LLM session.

The MCP protocol surface stays unchanged: every SKILL appears as **one
MCP tool** to the client.

---

## Key features

- ✅ **Three modes, one tool surface** — prompt / tool / agent collapse
  to one MCP tool per SKILL.
- ✅ **Permission monotone-decay** — a sub-agent can never gain a tool
  its parent lacks.
- ✅ **Skill-to-Tool codegen** — `tool_schema.steps[]` compiles to a
  callable composed tool with a single command.
- ✅ **`{{var.path}}` template engine** — pure variable refs preserve
  the original value type; mixed strings interpolate via `String(value)`.
- ✅ **Two transports** — stdio (Claude Desktop / Code) + Streamable
  HTTP (remote, the SDK-recommended replacement for SSE).
- ✅ **Natural-language SKILL authoring** — `skill_suggest` + `skill_generate`
  let the calling LLM iterate against a known-good template.
- ✅ **Workspace-root defense-in-depth** — refuse file writes outside the
  configured root, even if the client supplies a malicious `tree_id`.
- ✅ **Atomic-write JSON persistence** — composed-tool store survives
  restarts (tmp + rename, mode 0o600).
- ✅ **Zero built-in tools** — framework-agnostic. Register your own via
  `ToolCallbackRegistry` (`InMemoryToolCallbackRegistry` shipped).
- ✅ **TypeScript first** — `bun` runtime, `bunx tsc --noEmit` clean,
  136-test suite (~200 ms).

---

## Three SkillModes — concept primer

| Mode | What the MCP tool returns | Typical use case |
|------|---------------------------|------------------|
| `prompt` | The SKILL body verbatim (optionally prefixed by the caller's query). | Static playbooks, reference docs, prompt fragments the calling LLM should incorporate verbatim. |
| `tool` | Markdown-formatted per-step results from the composed pipeline. | Deterministic multi-step workflows that compose host-registered tools (e.g. "fetch → transform → write"). |
| `agent` | `[Agent Result] …` block containing a structured `ThoughtResult`. | Long-running, autonomous sub-agent sessions with their own role + tool whitelist + token / time budget. |

You can mix all three modes in a single SKILL library — the dispatcher
auto-resolves the mode based on `skill_mode` + presence of `tool_schema` /
`agent_config` fields. Templates for each mode live under
[`templates/`](./templates).

### How the dispatcher decides

1. Read the SKILL's `skill_mode` field. If present, use it.
2. Otherwise, if `tool_schema` is present → infer `tool`.
3. Otherwise → fall back to `prompt`.

Validation rejects mismatched combinations (e.g. `skill_mode=agent`
without `agent_config`, or `skill_mode=tool` with `agent_config`).

---

## Status

**v1.0.0** — initial release. Local-only at this stage
(`package.json#private: true`); the package is feature-complete for the
documented surface. Subsequent releases will harden `mcp/` + `e2e/` test
coverage and add a built-in disk-walking `SkillResolver`.

`v1.0.0` git tag is on `main`; release notes in
[CHANGELOG.md](./CHANGELOG.md).

---

## Install (local development)

```bash
git clone https://github.com/acosmi/skill-agent-mcp.git
cd skill-agent-mcp
bun install
bun test          # 136 pass / 2 skip / 0 fail / ~200 ms
bunx tsc --noEmit # 0 errors
```

Bun ≥ 1.3 and Node ≥ 20 (for the CLI shim) are required.

---

## Quick start: stdio MCP server

Run the bundled examples without writing any host code:

```bash
bun bin/acosmi-skill-agent-mcp \
  --transport stdio \
  --skills-dir ./examples/skills \
  --templates-dir ./templates \
  --state-dir ./.state
```

For Claude Desktop / Code, drop the snippet from
[`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json)
into your `mcpServers` block (replace the absolute paths first).

---

## Quick start: Streamable HTTP MCP server

```bash
bun bin/acosmi-skill-agent-mcp \
  --transport http \
  --port 3030 \
  --skills-dir ./examples/skills
# → [acosmi-skill-agent-mcp] streamable HTTP transport ready at http://127.0.0.1:3030/mcp
```

---

## Quick start: programmatic embedding

```ts
import { CapabilityTree, setTreeBuilder } from "@acosmi/skill-agent-mcp/capabilities";
import { ComposedToolStore } from "@acosmi/skill-agent-mcp/codegen";
import { staticSkillResolver, type SkillResolverWithBody } from "@acosmi/skill-agent-mcp/tools";
import { InMemoryToolCallbackRegistry } from "@acosmi/skill-agent-mcp/dispatch";
import { createServer, createStdioTransport } from "@acosmi/skill-agent-mcp/mcp";
import { promises as fs } from "node:fs";

// 1. Capability tree — empty here; production hosts seed real nodes.
const tree = new CapabilityTree();
setTreeBuilder(() => tree);

// 2. Resolver — production hosts walk disk; demos use the static helper.
const skillSources: Record<string, string> = {
  "tools/demo/hello": await fs.readFile("./skills/hello/SKILL.md", "utf-8"),
};
const skillResolver: SkillResolverWithBody = staticSkillResolver(skillSources);

// 3. Tool registry + composed-tool store (only needed for tool-mode SKILLs).
const toolRegistry = new InMemoryToolCallbackRegistry();
toolRegistry.register("echo", async (input) => String(input["text"] ?? ""));

const composedStore = new ComposedToolStore();

// 4. Build + connect the MCP server.
const server = createServer({
  tree,
  skillsDir: "./skills",
  templatesDir: "./templates",
  stateDir: "./.state",
  skillResolver,
  toolRegistry,
  composedStore,
  // spawnSubagent: ...host-supplied LLM loop... (only for agent-mode SKILLs)
});

await server.connect(createStdioTransport());
```

See [`examples/`](./examples) for working demos of all three modes.

---

## MCP tools registered

`createServer()` registers up to 11 MCP tools, each gated on the
presence of the relevant optional dependency. Minimal hosts get a small
toolbox; richer hosts opt in to the full surface.

| Tool | Purpose | Dependency gating |
|------|---------|-------------------|
| `capability_manage` | Inspect / validate / diagnose / patch the capability tree (folds 13 actions; pass JSON via `payload`). | always |
| `tree_lookup_tool` | Resolve a tool name to its tree node id + runtime owner. | always |
| `tree_dump` | Full tree as JSON. | always |
| `tree_list_tier` | Tools available at / below an intent tier. | always |
| `tree_list_bindable` | Nodes that accept SKILL.md frontmatter binding. | always |
| `skill_suggest` | Recommend a SKILL.md template from a free-form description. | always |
| `skill_generate` | Validate-then-save a SKILL.md draft. | always |
| `skill_manage` | List / get / update / delete / export SKILLs. | always |
| `skill_activate` | Invoke a SKILL through the dispatcher to verify runtime behaviour. | requires `skillResolver` |
| `skill_parse` | Parse + (optionally) validate a SKILL.md source. | always |
| `spawn_agent` | Agent-mode SKILL spawn. | requires `skillResolver` + `spawnSubagent` |

---

## Architecture (high-level)

```
External LLM client (Claude Desktop / Code · Cursor · Continue.dev · ...)
              │
              │  MCP protocol  (stdio or Streamable HTTP)
              ▼
   ┌─────────────────────────────────────────────┐
   │  @acosmi/skill-agent-mcp · createServer()   │
   │  ├─ 11 MCP tools registered                │
   │  └─ Internal dispatch by skill_mode        │
   └─────────────────────────────────────────────┘
              │
              ├─→ prompt mode → return SKILL body verbatim
              │
              ├─→ tool mode  → ComposedSubsystem.executeTool
              │                 → resolve {{var.path}} templates
              │                 → call ToolCallbackRegistry.get(toolName)
              │
              └─→ agent mode → resolveSkillAgentCapabilities (monotone-decay)
                              → DelegationContract.transitionStatus(active)
                              → SpawnSubagent (host-supplied LLM loop)
                              → DelegationContract.transitionStatus(completed/failed)
```

Full subsystem map + 7-dimension `CapabilityNode` shape +
`DelegationContract` state machine in
[ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Subsystem layout

| Module | Purpose |
|--------|---------|
| `@acosmi/skill-agent-mcp/capabilities` | `CapabilityTree`, 7-dim node types, `setTreeBuilder`, `defaultTree`. Copied from `@acosmi/agent` v1.0. |
| `@acosmi/skill-agent-mcp/manage` | `executeManageTool` 13-action meta-tool. Copied from v1.0. |
| `@acosmi/skill-agent-mcp/llm` | `LLMClient` interface + Anthropic / OpenAI / Ollama reference adapters. |
| `@acosmi/skill-agent-mcp/skill` | `SkillAgentConfig` (extended with 7 fields v1.0 lacks) + multi-source SKILL.md aggregator + validation. |
| `@acosmi/skill-agent-mcp/dispatch` | server-side `prompt` / `tool` / `agent` dispatcher + `DelegationContract` + `resolveSkillAgentCapabilities`. |
| `@acosmi/skill-agent-mcp/codegen` | SKILL → composed-tool compiler + executor with `{{var.path}}` template engine. |
| `@acosmi/skill-agent-mcp/tools` | `skill_suggest` / `skill_generate` / `skill_manage` / `skill_activate`. |
| `@acosmi/skill-agent-mcp/mcp` | `createServer` factory + stdio / Streamable HTTP transports. |

---

## Documentation

- [`docs/SKILL-TEMPLATE.md`](./docs/SKILL-TEMPLATE.md) — complete SKILL.md grammar (488 lines).
- [`templates/`](./templates) — five short skeletons (one per mode + intent).
- [`examples/`](./examples) — three demo SKILLs + reference callback impls + Claude Desktop config.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — subsystem boundaries + data flow.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — dev setup + commit style.
- [`CHANGELOG.md`](./CHANGELOG.md) — version history.

---

## FAQ

### Why not put all this in `@acosmi/agent`?

`@acosmi/agent` v1.0 is a "capability library" with zero protocol
assumptions. Forcing the MCP SDK + zod onto every consumer would be a
regression. Keeping the MCP wrapping here lets v1.0 stay
protocol-agnostic.

### Does this work outside Claude / Anthropic?

Yes. The framework is provider-agnostic — `LLMClient` ships Anthropic /
OpenAI / Ollama reference adapters and any MCP-compatible client
(Cursor, Continue.dev, custom hosts) can connect via stdio or HTTP.

### Why is `private: true` set?

Local-only for the v1.0 cycle. Removing `private` + registering an npm
token is the only step required before publishing.

### How do I write my first SKILL?

1. Pick a starting template from [`templates/`](./templates) — or
   ask the running server via `skill_suggest`.
2. Adapt the frontmatter (`tree_id`, `summary`, `skill_mode`, fields
   for your chosen mode).
3. Save under `<skillsDir>/<tree_id>/SKILL.md`.
4. Validate via the `skill_parse` MCP tool with `validate=true`.

### Can I add my own MCP tools alongside the built-in 11?

Yes — `createServer()` returns the underlying `McpServer` instance;
call `.registerTool()` on it directly.

### How is permission enforced for sub-agents?

`resolveSkillAgentCapabilities()` enforces **monotone-decay**: the
sub-agent's tool set is always a subset of the parent's. The agent's
`agent_config.allow` list is intersected with the parent's tool set
before being added — a sub-agent cannot gain a tool the parent lacks,
even by declaring `allow: [forbidden_tool]`.

### What happens if a tool-mode SKILL step fails?

Per-step `on_error` decides: `abort` (default) returns immediately;
`skip` records the error and continues to the next step; `retry`
re-attempts up to 2 extra times before giving up.

---

## Roadmap

| Milestone | Status | Description |
|-----------|--------|-------------|
| **v1.0** — initial release | ✅ shipped | 22 commits, 11 MCP tools, 136-test suite, full TS surface. |
| **v1.1** — disk-walking SkillResolver | ⏳ planned | Replace the demo `staticSkillResolver` with a built-in implementation that walks `--skills-dir` recursively. |
| **v1.2** — mcp / e2e test coverage | ⏳ planned | Add `tests/mcp/` and `tests/e2e/` against a mock McpServer + spawned process round-trips. |
| **v1.3** — npm publish | ⏳ planned | Drop `private: true`, generate `dist/` via `tsc`, register npm token. |
| **v2.0** — workspace-dep on `@acosmi/agent` | ⏳ planned | Replace duplicated `capabilities/` + `manage/` + `llm/` with a single peer dep once `@acosmi/agent` is on npm. |

---

## Acknowledgements

- [`@acosmi/agent`](https://github.com/acosmi/agent) — the v1.0
  capability library this package wraps.
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
  — the MCP TypeScript SDK we plug into.
- The crabclaw project (private) — original Go implementation that this
  package translates into TypeScript.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE).
