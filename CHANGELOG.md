# Changelog

All notable changes to `@acosmi/skill-agent-mcp` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-01

Initial release. MCP server wrapping `@acosmi/agent` v1.0's capability
tree and adding skill-driven agent dispatch on top.

`package.json` keeps `private: true` for the v1.0 cycle. Removing
`private` (and registering an npm token) is the only remaining step
before publishing.

### Added

- **MCP server factory** (`src/mcp/`)
  - `createServer({ tree, skillsDir, templatesDir, stateDir, … })` →
    `McpServer` with up to 11 MCP tools registered (each gated on the
    presence of optional dependencies).
  - `createStdioTransport()` + `createStreamableHttpTransport()` for
    desktop and remote deployment.
  - CLI shim: `bin/acosmi-skill-agent-mcp --transport stdio|http
    --skills-dir … --templates-dir … --state-dir … --tree-file …
    --workspace-root … --port … --host …`.

- **Three-mode dispatcher** (`src/dispatch/`)
  - `dispatchSkill()` resolves the SKILL's mode and routes to one of
    `dispatchPromptSkill`, `dispatchToolSkill`, or
    `executeSkillDrivenSpawn`.
  - `executeSkillDrivenSpawn` ports crabclaw's
    `executeSkillDrivenSpawn` (handoff二选一 routing, permission
    monotone-decay, contract state machine).
  - `resolveSkillAgentCapabilities()` ports
    `runner/skill_agent_capabilities.go` permission semantics 1:1.
  - `DelegationContract` class with full state machine
    (`pending → active → completed/failed`) — copied from `@acosmi/agent`
    v1.0's `fleet/delegation-contract.ts`.

- **Skill-to-Tool codegen** (`src/codegen/`)
  - `codegen()` + `codegenIncremental()` compile SKILL.md
    `tool_schema.steps[]` into `ComposedToolDef` entries (translated
    from crabclaw `composed/codegen.go`).
  - `ComposedSubsystem.executeTool()` runs steps with `{{var.path}}`
    template resolution, `loop_over` iteration, `on_error: abort/skip/retry`,
    and AbortSignal cancellation (translated from crabclaw
    `composed/executor.go`).
  - `ComposedToolStore` + atomic-write JSON persistence under
    `<stateDir>/composed_tools.json` (mode 0o600).

- **Extended SKILL surface** (`src/skill/`)
  - `SkillAgentConfig` extends v1.0's interface with the seven extended
    fields (`triggers / sop / review_gate / stall_threshold_ms /
    max_retry / escalation_chain / snapshot_rollback`) crabclaw
    production agent SKILLs use.
  - 6 nested types: `AgentTriggers / AgentCronTrigger /
    AgentMessageMatch / AgentEventTrigger / AgentSOPStep /
    AgentReviewGate`.
  - `parseExtendedSkillFrontmatter()` augments v1.0 parsing with the 7
    extended fields.
  - `validateSkillMode()` returns structured `SkillModeValidationError`
    (translated from crabclaw `frontmatter.go:259-322`).
  - `AggregatedSkillNodeProvider` — multi-source SKILL.md merge with
    canonical-rank tie-breaking + alias demotion (translated from
    crabclaw `skill_node_provider.go`).

- **Natural-language SKILL tools** (`src/tools/`)
  - `skill_suggest` — keyword-scored template recommendation.
  - `skill_generate` — validate-then-save SKILL.md drafts atomically
    (with optional `workspaceRoot` defense-in-depth).
  - `skill_manage` — list / get / update / delete / export.
  - `skill_activate` — invoke through the dispatcher to verify
    runtime behaviour.
  - `staticSkillResolver(map)` convenience for tests + demos.

- **Templates** (`templates/`)
  - Five short skeletons (`tool / operations / agent / subsystem /
    internal`) plus `templates/README.md` with a when-to-use table.
  - Full SKILL.md grammar reference at `docs/SKILL-TEMPLATE.md`
    (verbatim from crabclaw `docs/skills/SKILL-TEMPLATE.md`).

- **Examples** (`examples/`)
  - `claude-desktop-config.json` drop-in `mcpServers` block.
  - 3 demo SKILLs (`hello-prompt` / `hello-tool` / `hello-agent`).
  - Reference `tool-callback-registry.ts` (echo / uppercase /
    stub read_file).
  - Reference `agent-runner-impl.ts` (canned-reply stub +
    LLM-backed sketch).

- **Tests** (`tests/`)
  - 60 capabilities tests (verbatim from v1.0).
  - 24 manage tests + 2 skipped (path divergence with v1.0 fixtures).
  - 18 skill tests (parse / validate / aggregate).
  - 11 codegen tests (sanitize / sha / template engine / executor).
  - 13 dispatch tests (capabilities / SOP / system prompt / spawn).
  - 10 tools tests (suggest / generate / manage / static resolver).

  **Total: 136 pass / 2 skip / 0 fail / 275 expect() across 6 files.**

### Reused from `@acosmi/agent` v1.0

Three subsystems are copied verbatim into this package so it can ship
self-contained while the upstream npm publish is unblocked:

- `src/capabilities/` (5 files, ~1709 LoC, including `index.ts`)
- `src/manage/` (6 files, ~70.6 KB)
- `src/llm/` (5 files, ~23.4 KB)
- `src/dispatch/delegation-contract.ts` (single file, 599 LoC)

Once `@acosmi/agent` is on npm, a future release will switch these to
a workspace dep and drop the duplicates without surface change.

### Translation provenance

This release translates the following crabclaw Go files (file paths
relative to `backend/internal/agents/`):

- `runner/spawn_blueprint_agent.go` (387 LoC) → `src/dispatch/agent.ts` (~503 LoC)
- `runner/skill_agent_capabilities.go` (105 LoC) → `src/dispatch/agent-capabilities.ts` (~95 LoC)
- `skills/skill_node_provider.go` (380 LoC) → `src/skill/node-provider.ts` (~360 LoC)
- `skills/frontmatter.go` (selectively, lines 152-322) → `src/skill/types.ts` + `src/skill/parse-extended.ts` + `src/skill/validate.ts` (~520 LoC TS)
- `composed/types.go` (109 LoC) → `src/codegen/types.ts` (~80 LoC)
- `composed/store.go` + `atomic_write.go` (119 LoC) → `src/codegen/store.ts` (~200 LoC)
- `composed/codegen.go` (268 LoC) → `src/codegen/codegen.ts` (~280 LoC)
- `composed/executor.go` (300 LoC) → `src/codegen/executor.ts` (~340 LoC)

Total Go source consulted: ~1670 LoC. Total TS produced (excluding
verbatim copies + tests + docs): ~2380 LoC.

### Deliberate divergences from Go

- `slog.*` logging dropped throughout — observation flows through
  return-value structures + optional `SpawnLogger` injection.
- `sync.RWMutex` / `atomic.Pointer` dropped — TS event loop is
  single-threaded; per-instance Map ops are atomic.
- `context.Context` → `AbortSignal` (cancellation polled at the same
  boundaries the Go side polls `ctx.Done()`).
- `time.Now().Format(time.RFC3339)` → `new Date().toISOString()`.
- `crypto/sha256` → `node:crypto.createHash`.
- `encoding/json` → native `JSON.stringify` / `JSON.parse`.
- Process-global config getters (e.g. `statepaths.ResolveStateDir()`,
  `ProviderConfigGetter`) replaced with explicit `options` arguments
  so the library is free of OS / env / process-global side effects.

### Dependencies

| Package | Version | License |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | MIT |
| `yaml` | ^2.8.3 | ISC |
| `zod` | ^3.25.0 | MIT |

97 transitive packages installed; lockfile committed at
`bun.lock` for reproducibility.
