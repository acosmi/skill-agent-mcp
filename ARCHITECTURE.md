# Architecture

## Goal

Expose crabclaw's (private) skill-driven agent capabilities to external
LLM clients through a single MCP server,
with SKILL.md acting as the **unified fusion layer** for tools, prompt
fragments, and sub-agents.

External clients (🦀 Crab Code CLI, 🦀 Crab Code Desktop, Claude Desktop,
Code, Cursor, ...) discover one tool per registered SKILL, regardless
of `skill_mode`. Crab Code CLI / Desktop are acosmi's first-party
clients with deep integration; other clients connect via standard MCP
protocol. The server dispatches
based on the SKILL's mode internally; the protocol never asks the client
to think about whether they're invoking a "prompt" or a "sub-agent".

## Subsystem map

```
┌────────────────────────────────────────────────────────────┐
│                       MCP SDK (1.29)                       │
│           StdioServerTransport · StreamableHTTPServerTransport            │
└────────────────────────────────────────────────────────────┘
                ▲                          ▲
                │ (createServer wires both)│
                │                          │
┌─────────────────────────────────────────────────────────────┐
│                       src/mcp/                              │
│   createServer  →  registers ~11 MCP tools, gating each on  │
│                    optional dependencies (skillResolver,    │
│                    spawnSubagent, toolRegistry, …)          │
└─────────────────────────────────────────────────────────────┘
        │                  │                  │
        ▼                  ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
│  src/dispatch/   │ │   src/tools/     │ │     src/manage/      │
│ dispatchSkill →  │ │ skill_suggest    │ │  executeManageTool   │
│  prompt / tool / │ │ skill_generate   │ │  (13 actions)        │
│  agent branches  │ │ skill_manage     │ │                      │
│                  │ │ skill_activate   │ └──────────────────────┘
│ DelegationContract│ │                  │
│ resolveSkillAgent │ └──────────────────┘
│ buildSkillAgent... │
└──────────────────┘
        │                  │
        │                  ▼
        │          ┌──────────────────────────┐
        │          │      src/codegen/        │
        │          │ codegen / codegenIncrem. │
        │          │ ComposedSubsystem.exec   │
        │          │ ComposedToolStore        │
        │          │ {{var.path}} engine      │
        │          └──────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────────┐
│                       src/skill/                              │
│  ExtendedSkillMetadata (32 agent_config fields)              │
│  parseExtendedSkillFrontmatter / validateSkillMode           │
│  AggregatedSkillNodeProvider (5-source merge + alias demote) │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│            src/capabilities/  (copied from v1.0)             │
│  CapabilityTree (7-dim nodes) · setTreeBuilder · defaultTree │
└──────────────────────────────────────────────────────────────┘
```

`src/llm/` (LLMClient + Anthropic / OpenAI / Ollama adapters) is
exposed as a sibling subsystem — the dispatcher itself never imports
LLMClient directly; hosts that wire `spawnSubagent` typically do.

## Three SkillModes, one tool surface

| SkillMode | Dispatcher path | What the MCP tool returns |
|-----------|-----------------|---------------------------|
| `prompt`  | `dispatchPromptSkill` | The SKILL.md body verbatim. |
| `tool`    | `dispatchToolSkill` → `ComposedSubsystem.executeTool` | Markdown-formatted per-step results from the composed pipeline. |
| `agent`   | `executeSkillDrivenSpawn` → `SpawnSubagent` callback | Formatted `[Agent Result] …` with `ThoughtResult` payload. |

The `dispatchSkill()` top-level dispatcher resolves the mode and routes
to the right per-mode handler. Per-mode contexts (`SpawnContext`,
`ToolModeContext`) are explicit interfaces the host wires once at
startup and reuses.

## Permission monotone-decay

Sub-agent tool whitelists are computed via
`resolveSkillAgentCapabilities(cfg, parentTools)`:

1. Pick the starting set: `none` → ∅, `minimal` → MINIMAL_TOOL_SET ∩
   parent, `full` / unspecified → parent.
2. Add `cfg.allow` entries that are still in the parent set
   (a sub-agent can never gain a tool the parent lacks).
3. Remove `cfg.deny` entries.

This is enforced before every spawn — a malicious or misconfigured
SKILL cannot escape the parent's capability set, even by declaring
`allow: [forbidden_tool]`.

## Persistence

The composed-tool store (`src/codegen/store.ts`) writes a single JSON
file under the host-supplied state directory:

- Default location: `<stateDir>/composed_tools.json`
- File mode: 0o600 (composed tools may embed prompts referencing API
  keys; user-private file mode keeps them out of reach of other users).
- Atomic write: tmp + rename, mirroring crabclaw's
  `writeFileAtomic` semantics.

SKILL.md files themselves are read-only from this package's POV; the
host is responsible for SKILL library curation. `skill_generate` /
`skill_manage update` write fresh SKILL.md files to the configured
`skillsDir` with optional `workspaceRoot` defense-in-depth.

## What this package does NOT include

- An LLM runtime / agent loop. Hosts wire their own via the
  `SpawnSubagent` callback. This decision keeps the framework
  provider-agnostic and avoids forcing a specific Anthropic / OpenAI /
  Ollama dependency on every consumer.
- A built-in tool registry. Hosts wire their own
  `InMemoryToolCallbackRegistry` (or a custom impl) registering the
  tools their SKILLs reference. The framework deliberately ships zero
  built-in tools.
- A disk-walking `SkillSourceResolver`. The included
  `staticSkillResolver(map)` is intended for tests + demos; production
  hosts walk disk via `AggregatedSkillNodeProvider` (commit #6) plus
  whatever loader they prefer.

## Translation provenance

Every src/* file's header comment records its crabclaw / v1.0 origin
(file:line ranges where applicable) plus any deliberate divergence.
The `CHANGELOG.md` "Translation provenance" section provides the
package-wide summary for auditors.
