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

### src/secrets/ — secret-profile subsystem (v1.2.0+)

Profile-ref pattern: SKILL.md only stores profile **names**
(`openai_default`); the actual secret lives in `process.env` /
`/run/secrets/...` / a registered SecretSourceAdapter, and is
resolved at call-time by tool implementations holding a
`SecretProvider` handle. Raw secrets never enter `varMap`, never
pass through the codegen template engine, and never reach the
formatted MCP response (the `formatComposedResult` redact pass
scrubs known token shapes as a final safety net).

**Secret-leakage invariants — split by enforcement level:**

*Architectural (always enforced, no host config required):*
- Secrets never enter `varMap` — `resolveProfile` is called from inside
  the host's tool implementation, not from the framework's template
  engine.
- `formatComposedResult` runs `redactSecrets()` as the last step before
  returning to the MCP client, scrubbing recognisable token shapes
  (sk-..., ghp_..., Bearer ..., AKIA..., xoxb-..., etc.).
- On POSIX, `FileSecretSource` does **two-layer mode check**: `lstat`
  on the path entry itself (rejecting loose-mode symlinks even when
  the target is 600) and `stat` on the resolved file (rejecting
  group/other-readable targets).

*Opt-in (only when host calls `validateSkillMode(meta, opts)` with
the second argument):*
- T1 — literal-secret refusal in SKILL source (`opts.source` provided).
- T2 — `secret_refs` existence check against the registered profile
  store (`opts.secretProvider` provided).

The bundled `skill_generate` / `skill_manage update` / `skill_parse`
MCP tools intentionally do NOT pass `opts` — they remain
back-compatible with v1.1.0 callers. Hosts that want T1/T2 enforced
at SKILL save time must call `validateSkillMode(meta, { source,
secretProvider })` themselves before persisting. See
`docs/jiagou/审计-acosmi-skill-agent-mcp-secrets-v1.md` §六 R1.

```
┌──────────────────────────────────────────────────────────────┐
│                       src/secrets/                           │
│  types.ts        : SecretProvider/SourceAdapter/Profile      │
│  store.ts        : SecretProfileStore (0o600 + atomic)       │
│  provider.ts     : DefaultSecretProvider                     │
│  sources/env.ts  : EnvSecretSource                           │
│  sources/file.ts : FileSecretSource (mode 校验)              │
│  redact.ts       : redactSecrets() / findLiteralSecret()     │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                src/manage/secret-profile-manage.ts           │
│  5 actions: register / list / get / remove / test            │
│  Never accepts / returns a raw secret value                  │
└──────────────────────────────────────────────────────────────┘
```

Extension points (out-of-tree sibling packages, no native deps in
this package):
- `@acosmi/skill-secrets-keychain` (planned) — registers
  `KeychainSecretSource` with prefix `keychain:`
- `@acosmi/skill-secrets-vault` (planned) — registers
  `VaultSecretSource` with prefix `vault:`

`src/llm/` (LLMClient + Anthropic / OpenAI reference adapters) is
exposed as a sibling subsystem — the dispatcher itself never imports
LLMClient directly; hosts that wire `spawnSubagent` typically do. The
OpenAI adapter doubles as a generic OpenAI-compatible client (Ollama
OpenAI mode, vLLM, DeepSeek, OpenRouter, LiteLLM, Groq, …) via
`baseUrl` override.

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
  provider-agnostic and avoids forcing a specific Anthropic / OpenAI
  dependency on every consumer.
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
