# Changelog

All notable changes to `@acosmi/skill-agent-mcp` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — secret-profile subsystem (v1.2.0 prep)

新增 `src/secrets/` 子系统，让 SKILL 可以引用上游 API 密钥但 **密钥本身永不进入 SKILL 文件 / varMap / 框架内存生命周期**。设计与执行档：
- `docs/jiagou/架构-acosmi-skill-agent-mcp-secrets-v1.md`
- `docs/jiagou/执行-acosmi-skill-agent-mcp-secrets-v1.md`
- `docs/jiagou/审计-acosmi-skill-agent-mcp-secrets-v1.md`

**新增 8 个文件**：
- `src/secrets/types.ts` — `SecretProvider` / `SecretSourceAdapter` / `SecretProfile` / `ResolvedAuth` / `SecretError`
- `src/secrets/store.ts` — `SecretProfileStore` + `loadSecretProfileStore` / `saveSecretProfileStore`（仿 codegen/store.ts 的 0o600 atomic-write 范式）
- `src/secrets/sources/env.ts` — `EnvSecretSource`（读 process.env）
- `src/secrets/sources/file.ts` — `FileSecretSource`（含 stat.mode 校验，POSIX 拒 group/other readable）
- `src/secrets/sources/index.ts` — `defaultSourceAdapters()` 工厂
- `src/secrets/provider.ts` — `DefaultSecretProvider`（store + adapter map 粘合层）
- `src/secrets/redact.ts` — `redactSecrets` / `findLiteralSecret` / `containsLikelySecret`
- `src/secrets/index.ts` — barrel
- `src/manage/secret-profile-manage.ts` — `executeSecretProfileManage` 5 actions: register / list / get / remove / test（永不接收 / 返回 raw key）

**SKILL frontmatter 扩展**：
- `secret_refs?: string[]` 字段，声明 SKILL 会用哪些 profile name
- `validateSkillMode(meta, opts?)` 新签名 — 可选 `{ source, secretProvider }`：
  - **T1**：`source` 提供时扫描字面密钥（`sk-` / `ghp_` / Bearer / AWS AKIA / Slack xoxb 等），命中 → `code: "literal_secret_rejected"`
  - **T2**：`secretProvider` 提供时校验每个 `secret_refs` 都是已注册 profile，缺失 → `code: "missing_secret_profile"`

**MCP server 扩展**：
- `CreateServerOptions.secretProvider?` / `secretProfileStore?` / `allowLiteralSecretSource?`
- 当 `secretProvider + secretProfileStore` 都注入时，`createServer` 自动注册 `secret_profile_manage` MCP tool

**executor 输出脱敏**：
- `formatComposedResult` 末尾经 `redactSecrets` 过滤 — 上游 API 错误体若回显 Authorization header / token 字面，到达 MCP 客户端前替换为 `***`

**package.json**：
- 新增 `./secrets` exports 子路径

**测试增量**：
- `tests/secrets/{store,sources,provider,redact}.test.ts`
- `tests/manage/secret-profile-manage.test.ts`
- `tests/skill/skill.test.ts` 扩展 6 个 secret-profile 用例
- `tests/codegen/codegen.test.ts` 扩展 3 个 redact 集成用例
- 总计：234 pass / 2 skip / 0 fail / 470 expect() across 15 files

**零新依赖**：本子系统不引入任何 npm 新依赖（仅用 `node:fs/promises` + `process.env` + 现有 `zod`）。

**向后兼容**：
- 既有 `validateSkillMode(meta)` 单参签名仍可用
- 既有 host 不传 `secretProvider` 时行为完全不变
- 新 stateDir 文件 `secret_profiles.json` 不存在时正常启动（emit empty store）

### Fixed — 复核审计 P11 修复

P1-P10 实施完成后由独立 code-reviewer 子代理复核，发现并修复 3 个阻断项：

- **修-1**：`src/secrets/sources/file.ts` POSIX 上 `fs.stat` follows symlink，符号链接本身权限未校验 → 改为 `lstat + stat` 双层 mode 校验。链接条目和链接目标都必须 `mode & 0o077 === 0`。
- **修-2**：`src/secrets/provider.ts` `parseSourceUri` 抛 `invalid_source_uri` 时错误信息含完整 URI 字面 → 改为 `length=N` 形式不 dump 内容（防 host 误填字面密钥进 `source` 字段时回显泄露）。
- **修-3**：`tests/skill/skill.test.ts` 加 R1 lock-in 测试，明示 `validateSkillMode` 单参签名默认不跑 T1/T2 是有意决定，将来意外开启会先 fail。

**测试增量**：+5 用例（symlink 接受 / symlink 拒绝 / parseSourceUri 不漏字面 / R1 lock-in T1 / R1 lock-in T2）。
**最终基准**：234 → **239 pass / 2 skip / 0 fail / 474 expect() across 15 files**。

## [1.1.0] - 2026-05-01

T3 全链路审计 (2026-05-01) 发现的 3 P0 + 3 P1 + 6 P2 + 1 P3 + 1 架构纠正
（去 LLM 硬编码）— 18 项增量修复。详见
`docs/jiagou/执行-acosmi-skill-agent-mcp-修复-2026-05-01.md`。

> **SemVer 偏离公示**：本版本含 5 项 BREAKING CHANGES（见下），按严格
> SemVer 应当 major bump 至 2.0.0。本次接受 minor bump (1.0.0→1.1.0)
> 的理由：v1.0.0 在 npm 上发布仅数小时（2026-05-01 08:44 UTC），下游
> 影响面已确认极小（用户自管的 known consumers）。`^1.0.0` 用户升级后
> 若用到下表 BREAKING 项，请按 "Migration" 路径调整或 pin `1.0.0`。

### BREAKING CHANGES

- **Removed `OllamaLLMClient` + `OllamaConfig`** (A-1+A-2). 迁移路径：
  用 `OpenAILLMClient` + `baseUrl="http://localhost:11434/v1"` 即可对接
  Ollama 的 OpenAI 兼容端点（Ollama 0.1.30+ 默认开启）。OpenAI 兼容
  协议天然覆盖 vLLM / DeepSeek / OpenRouter / LiteLLM / Groq 等任何
  兼容服务。
- **`LLMRequest.model` 改必填** (B-1)。从 `model?: string` 改为
  `model: string` — 调用方必须显式声明模型。框架不再替用户拍板。
- **删除 framework constant `DEFAULT_MODEL` / `DEFAULT_OPENAI_MODEL`**
  (B-2 + B-3)。`AnthropicConfig.defaultModel` 字段 + `OpenAIConfig.defaultModel`
  字段一并移除。模型选择前推到调用方（成本 / 上下文窗口 / 工具能力
  是业务决策不该藏在 const 里）。
- **bin shebang 切到 node** + dist/ 路径 (P0-3)。原 bin/acosmi-skill-agent-mcp
  是 `#!/usr/bin/env bun` + `import "../src/cli/main.ts"`，纯 node 用户
  npm install 后无 bun → 直接挂掉。新版默认 node + dist/，bun 用户用
  `acosmi-skill-agent-mcp-bun` 备选 bin。
- **`buildSkillAgentSystemPrompt` 加可选 `contract` 参数** (P1-2)。向后
  兼容（不传 contract 输出与原版一致），但调用方传 contract 时输出
  会含 "## Delegation Contract" 段，sub-agent 收到的 prompt 内容会变。

### Added

- **`startStreamableHttpServer`** in `src/mcp/transport.ts` (P0-2). 真的
  开 TCP 监听 + 维护 sessionId map + POST/GET/DELETE /mcp + 优雅关闭。
  原 `--transport http` 路径 silently no-op（SDK 的 transport.start 是
  no-op）。
- **顶层 re-export** in `src/index.ts` (P0-1). 8 个子模块的 public API
  从顶层一次到达；`import { CapabilityTree } from "@acosmi/skill-agent-mcp"`
  现在真的能拿到值（之前是 undefined）。
- **第二个 bin** `bin/acosmi-skill-agent-mcp-bun` (P0-3). 给 bun 用户的
  zero-build 入口（直接跑 src/.ts）。
- **express 依赖** ^4.21.2 + @types/express ^4.17.21（dev）— P0-2 HTTP
  listener 必需。
- **新测试 35 cases**：tests/index/ + tests/llm/ + tests/dispatch/agent-timeout +
  tests/mcp/transport-http + tests/codegen/ 与 tests/manage/ 与
  tests/capabilities/ 内追加。**Total: 171 pass / 2 skip / 0 fail / 360
  expect() across 10 files**。

### Fixed

- **P0-1** 顶层 `src/index.ts` 真的 re-export（之前只有 `export {};`）。
- **P0-2** HTTP transport listener 真的监听（之前 SDK no-op + 没 wrap）。
- **P0-3** bin shebang 与 engines.node 不匹配 → node 用户 install 后挂。
- **P1-1** `contract.timeoutMs` 与 spawn 用的 timeoutMs 一致（之前 contract
  始终 60_000 默认，spawn 用 input 值，两数字漂移）。
- **P1-2** sub-agent system prompt 注入 delegation contract（与 Go 端
  spawn_media_agent.go:135 行为对齐；之前 spawn_blueprint_agent.go 漏修，
  TS port 1:1 复制了遗漏）。
- **P1-3** Anthropic SSE 多 tool_use 解析按 index→id 路由（之前
  `content_block_delta` 给 `tool_use_input_delta.id` 填空字符串，多并发
  tool_use 时 partial_json 串到一起）。
- **P2-1** `parseExtendedSkillFrontmatter` 复用 `base.frontmatter` 避免
  重复 YAML 解析。
- **P2-2** `nowNano` + `nextPatchId` 用 `process.hrtime.bigint()` 真 ns
  精度（之前 `Date.now()*1e6` 名为 ns 实为 ms 精度，同 ms 内 patch
  createdAtNano 撞库）。
- **P2-3** `isStoreData` type guard 拒掉 `tools` 字段是 array（array 在
  JS 里 `typeof === "object"` 且不为 null，会通过原校验后被
  `Object.entries` 误迭代）。
- **P2-4** `loop_over` 引用非数组变量时报错而非静默吞（之前
  `coerceLoopItems` 见非数组返回 `[]`，loop step 形同跳过但不报错）。
- **P2-5** `on_error: retry` exhausted 错误格式与 abort 对齐（带
  `step <i+1>/<total>`），上层定位故障容易。
- **P2-6** `CapabilityTree.lookupByName` / `lookupByToolHint` 加反向
  Map 索引 O(1)（之前 O(N) 遍历，SKILL 注入后 N 大时退化 O(N²)）。
- **P3-1** 全仓清理 `commit #N` 路线图占位 36+11 处（占位对外发布后
  无锚点反而令读者困惑）。

### Architecture correction

- 删除 LLM 模块对模型 ID 的硬编码（A-1+A-2 + B-1/2/3）。框架的契约边界
  退到 "Anthropic API 协议" 与 "OpenAI 协议"，模型选择 100% 业务决策。
- HTTP transport 的 listener 责任明确归框架（之前在 SDK 与 user 之间
  灰色地带，user 不知道要自己 wrap）。
- 顶层 public surface 落实（之前 deep-import only）。

详细修复清单：见
`docs/jiagou/执行-acosmi-skill-agent-mcp-修复-2026-05-01.md`。

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
