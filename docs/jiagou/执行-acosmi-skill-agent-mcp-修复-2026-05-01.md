# 执行-acosmi-skill-agent-mcp-修复-2026-05-01

> 基于 2026-05-01 全链路 T3 审计发现的 3 P0 + 3 P1 + 6 P2 + 1 P3 + 1 架构纠正（去 LLM 硬编码）的 18 步增量修复执行档。
>
> 上一档位：crabcode-tier2-research（同会话，全部决策已锁定）
> 进入档位：crabcode-execute（本档）
> 衔接档位：crabcode-audit（execute 完成后强制）

---

## 用户已拍板决策（compact 后不可推翻）

| # | 决策 | 来源消息 |
|---|---|---|
| D1 | 修 P0/P1 全部，先调研规划 | 2026-05-01 用户："1直接修复 P0/P1（先调研和规划）..." |
| D2 | P1-2 不撤回 — Go 端 spawn_blueprint 漏修，TS port 复制了遗漏 → 修 | 用户："不要退化要跟入分析根因处理" |
| D3 | P2/P3 全修不延迟 | 用户："不可不要遗留延迟" |
| D4 | 双 bin（node + dist 默认 / bun + src 备选） | 用户："P0-3 bin双bin是不是更好？" |
| D5 | 加 express 直接依赖（用 SDK `createMcpExpressApp`） | T2 调研推荐方案，用户"其他都同意" |
| D6 | 追加复核纠错段到原 T3-C 审计文档 | 同上 |
| D7 | LLM 默认模型架构纠正：删 Ollama 保 Anthropic+OpenAI 双兼容；`LLMRequest.model` 改必填；删除所有 `DEFAULT_MODEL` 硬编码 | 用户："模型是由智能体来直接执行...在一个即使需索告模型的适配，也是要需要 anthropic兼容格式和openai兼容格式双模式" |

## 用户硬约束（不可违反）

- **C1**：禁止修改 `C:\Users\fushihua\Desktop\crabcode\` + `D:\CrabClawApp\`（仅 Read 参考）
- **C2**：每步独立 commit，commit msg 写 why
- **C3**：诚实汇报，未解风险公示

---

## G8 事实陈述（验证范围 + 未验证项）

### 事实 1：P3-1 commit #N 占位注释共 33 处
- **命令**：`Grep "commit #?\d+" path=src`
- **范围**：`src/` 全部 .ts 文件（capabilities/manage/dispatch/codegen/mcp/tools/llm 7 子模块）
- **结果**：33 处命中（清单见 commit #1 详情）
- **未验证**：`tests/`（不该有此模式）、`docs/`（保留历史描述，不动）
- **风险**：若改注释时同步动到逻辑会引入 bug → 缓解：每处 Edit 仅替换注释字面量，不动相邻代码

### 事实 2：Ollama 引用清单 8 处（不含 ollama.ts 自身）
- **命令**：`Grep "[Oo]llama" path=. !node_modules/`
- **范围**：全仓除 node_modules
- **结果**：
  - 必删：`src/llm/ollama.ts` 整文件
  - 必改：`src/llm/index.ts:32-33`（export）、`src/llm/types.ts:4,93`（注释名）
  - 必改 docs：`ARCHITECTURE.md:70,123` + `README.md:254,285` + `README.en.md:276,308`
  - 不改（历史档案）：`docs/jiagou/架构-...md:49` + `docs/jiagou/执行-...T3C-v1.md:155`
- **未验证**：CHANGELOG 已有 v1.0.0 entry 是否提到 Ollama → 已查 L1-50 未提及 OK
- **风险**：BREAKING CHANGE，v1.0 用户若 import OllamaLLMClient 会 break → CHANGELOG 明示替代方案（用 OpenAILLMClient + baseUrl="http://localhost:11434/v1"）

### 事实 3：LLM 模块在仓内运行时 zero usage
- **命令**：`Grep "from.*llm|LLMClient|AnthropicLLMClient|OpenAILLMClient|OllamaLLMClient" path=. !node_modules/`
- **范围**：src/、tests/、examples/、docs/
- **结果**：除 src/llm/ 内部 + examples/agent-runner-impl.ts 注释 + 文档说明，**仓内代码 0 处运行时 import**
- **未验证**：用户下游项目可能 import（不在本仓控制范围）
- **风险**：删 Ollama / 改 model 必填 = 破坏性改动，但本仓 v1.0.0 刚发布，下游影响面应当极小

### 事实 4：MCP SDK 1.29 HTTP 用法
- **命令**：`Read node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts:42-89` + `Read .../examples/server/simpleStreamableHttp.js`
- **结果**：
  - `transport.start()` 是 no-op
  - 用法：`app.post('/mcp', (req, res) => transport.handleRequest(req, res, req.body))`
  - stateful 模式：sessionIdGenerator + transports map + onsessioninitialized
  - SDK 提供 `createMcpExpressApp({ host, allowedHosts? })` helper（含 DNS rebinding 保护）
- **未验证**：实际 listen + initialize 端到端流程（依赖 commit #17 的 transport-http.test.ts 覆盖）
- **风险**：stateful session 在 SIGINT/异常时可能泄漏 → close handler 遍历 transports

### 事实 5：Anthropic SSE 协议
- **命令**：`Grep "content_block" path=src/llm/anthropic.ts` + 协议常识
- **结果**：
  - `content_block_start` 携 id + name（在 `content_block` 字段内）+ index
  - `content_block_delta` 仅携 index + delta（type=text_delta 或 input_json_delta）
  - `content_block_stop` 仅携 index
  - 必须维护 `Map<index, id>`：start 写入、delta 查、stop 查 + 删除并 emit `tool_use_end`
- **未验证**：实际 Anthropic API 端到端（用 mock SSE stream 测试覆盖）
- **风险**：流状态机重构有边界 case 风险 → 测试覆盖单/多/mixed/异常 4 场景

### 事实 6：Go 端 contract 注入参考
- **命令**：`Read D:\CrabClawApp\backend\internal\agents\runner\spawn_media_agent.go:135` + `spawn_blueprint_agent.go:325-338`
- **结果**：
  - `spawn_media_agent.go:135`：`contractPrompt = contract.FormatForSystemPrompt()` 拼到 base/fallback
  - `spawn_blueprint_agent.go:325-338`：buildSkillAgentSystemPrompt 不调 FormatForSystemPrompt → Go 端遗漏
- **未验证**：Go 团队是否计划修 spawn_blueprint（不在本仓控制范围）
- **决策**：本 TS port 修复（不复制 Go 端遗漏）

---

## 改动清单（18 项）

每项含：file / old→new / why / 关联方 / 测试 / 回滚。

### Commit #1 — P3-1 清理 commit #N 占位注释

| 字段 | 内容 |
|---|---|
| files | src/{capabilities/{types,capability-tree,providers,index}.ts, codegen/{types,index}.ts, dispatch/{tool,agent,prompt,index}.ts, manage/index.ts, mcp/{server,index}.ts, tools/{skill-suggest,index}.ts}（共 12 文件 33 处） |
| 改动类型 | edit（注释替换） |
| old → new | 删除"commit #N" 引用，改成现状描述（如 `(commit #13)` → 删除或改为"see ./codegen/executor.ts"） |
| why | 历史叙述对外发布后无意义且令读者困惑（"commit #14 是哪个？"）；P3-1 |
| 关联方 | 仅注释；零运行时影响 |
| 测试 | typecheck pass（注释不影响编译） |
| 回滚 | git revert |

### Commit #2 — A-1+A-2 删 Ollama adapter

| 字段 | 内容 |
|---|---|
| files | 删除：src/llm/ollama.ts；编辑：src/llm/index.ts（移除 OllamaLLMClient + OllamaConfig export）；编辑：src/llm/types.ts（注释中删除 "ollama" 引用 L4, L93） |
| 改动类型 | delete + edit |
| old → new | src/llm/index.ts:32-33 删除 2 行 ollama export；types.ts L4 "openai / ollama" → "openai"；L93 "anthropic / openai / ollama" → "anthropic / openai" |
| why | MCP server 不调 LLM；用户 D7：保留 Anthropic + OpenAI 双兼容即可，OpenAI 兼容已覆盖 Ollama OAI mode；BREAKING CHANGE |
| 关联方 | 仓内 0 处 import OllamaLLMClient（已 grep）；用户下游若用需改为 OpenAILLMClient + baseUrl |
| 测试 | typecheck pass + bun test pass（已确认 tests/ 无 ollama 测试） |
| 回滚 | git revert |

### Commit #3 — B-1 LLMRequest.model 改必填

| 字段 | 内容 |
|---|---|
| files | src/llm/types.ts |
| 改动类型 | edit |
| old → new | L47 `model?: string;` → `model: string;` |
| why | 去除"默认模型 = X"概念；caller 必显式传 model（D7）；BREAKING CHANGE |
| 关联方 | anthropic.ts buildBody / openai.ts buildBody 引用 req.model（commit #4 #5 处理） |
| 测试 | typecheck 强制现有 caller 显式传；本仓 0 caller 故无内部影响 |
| 回滚 | git revert |

### Commit #4 — B-2 删 anthropic DEFAULT_MODEL

| 字段 | 内容 |
|---|---|
| files | src/llm/anthropic.ts |
| 改动类型 | edit |
| old → new | L33 `const DEFAULT_MODEL = "claude-sonnet-4-6";` → 删除；L22 `defaultModel?: string;` → 删除；L37 `Required<AnthropicConfig>` 类型简化（移除 defaultModel 字段）；L45 `defaultModel: config.defaultModel ?? DEFAULT_MODEL,` → 删除；L103 `model: req.model ?? this.config.defaultModel,` → `model: req.model,` |
| why | 去除模型 ID 硬编码（D7）；req.model 已强制（commit #3） |
| 关联方 | AnthropicConfig 接口对外契约变更（删 defaultModel 字段） |
| 测试 | typecheck pass；adapter 行为：必须 caller 传 model 否则 TS 编译错 |
| 回滚 | git revert |

### Commit #5 — B-3 删 openai DEFAULT_OPENAI_MODEL

| 字段 | 内容 |
|---|---|
| files | src/llm/openai.ts |
| 改动类型 | edit |
| old → new | L30 `const DEFAULT_OPENAI_MODEL = "gpt-4o";` → 删除；L23 `defaultModel?: string;` → 删除；L34 `Required<OpenAIConfig>` 简化；L42 `defaultModel: config.defaultModel ?? DEFAULT_OPENAI_MODEL,` → 删除；L75 `model: req.model ?? this.config.defaultModel,` → `model: req.model,` |
| why | 同 commit #4，OpenAILLMClient 同步去硬编码 |
| 关联方 | OpenAIConfig 接口契约变更 |
| 测试 | typecheck pass |
| 回滚 | git revert |

### Commit #6 — P1-3 SSE 多 tool_use 解析修复

| 字段 | 内容 |
|---|---|
| files | src/llm/anthropic.ts + 新建 tests/llm/anthropic-stream.test.ts |
| 改动类型 | edit + new |
| old → new | parseSSEStream 引入 `indexToId: Map<number, string>`；anthropicEventToChunks（重命名 + 改 generator）：start 时记录 index→id，delta 时查 id，stop 时 emit `tool_use_end` 并 delete |
| why | content_block_delta 只携 index 不带 id → 多并发 tool_use 解析失败丢数据；P1-3 |
| 关联方 | LLMStreamChunk 类型已声明 tool_use_end（无类型变更） |
| 测试 | tests/llm/anthropic-stream.test.ts：mock SSE 4 场景（单 tool / 多 tool / mixed text+tool / 异常断流） |
| 回滚 | git revert |

### Commit #7 — P2-1 parse-extended 复用 base.frontmatter

| 字段 | 内容 |
|---|---|
| files | src/skill/parse-extended.ts |
| 改动类型 | edit |
| old → new | L51 `const raw = parseFrontmatter(source);` → `const raw = base.frontmatter;`；删除 import 中的 parseFrontmatter（如不再用） |
| why | base 已含 frontmatter（v1.0 ParsedSkill.frontmatter 字段），重复 parse 浪费；P2-1 |
| 关联方 | parseFrontmatter 仍被 manage/skill-frontmatter.ts 使用，保留 export |
| 测试 | tests/skill/skill.test.ts 已覆盖 parseExtendedSkillFrontmatter，pass 即可 |
| 回滚 | git revert |

### Commit #8 — P2-3 isStoreData 防 array

| 字段 | 内容 |
|---|---|
| files | src/codegen/store.ts |
| 改动类型 | edit |
| old → new | L213-216 `typeof obj["tools"] === "object" && obj["tools"] !== null` → 加 `&& !Array.isArray(obj["tools"])` |
| why | tools 是 Record，array 也是 object → 通过校验后 Object.entries 处理 array 语义错乱；P2-3 |
| 关联方 | loadComposedToolStore 唯一调用方 |
| 测试 | tests/codegen/codegen.test.ts 加一条：load 含 tools=[] 应返回 error |
| 回滚 | git revert |

### Commit #9 — P2-4 loop_over 非数组报错

| 字段 | 内容 |
|---|---|
| files | src/codegen/executor.ts + tests/codegen/codegen.test.ts |
| 改动类型 | edit |
| old → new | coerceLoopItems 非数组时不返回 [] 而 throw Error；executeLoop 调用方 catch + 在 step.onError !== "skip" 时 push StepResult.error 而非默默 push 空 |
| why | 非数组 loop_over 静默吞掉等于 step 不执行也不报错，违反 abort 期望；P2-4 |
| 关联方 | 仅 executor 内部；loop_over 用户行为变化（错误更明显） |
| 测试 | tests/codegen 加 case：loop_over 引用非数组变量 → 应报"loop_over expects array, got string" |
| 回滚 | git revert |

### Commit #10 — P2-5 retry/abort 错误格式统一

| 字段 | 内容 |
|---|---|
| files | src/codegen/executor.ts + tests/codegen/codegen.test.ts |
| 改动类型 | edit |
| old → new | L157 retry exhausted 的 return string 加上 step number / total，与 L159 abort 格式一致：`[step ${i + 1}/${def.steps.length} ${step.action} retry exhausted: ${message}]` |
| why | retry 失败和 abort 失败错误反馈不一致，用户看不出哪步出错；P2-5 |
| 关联方 | 仅 executor 内部 |
| 测试 | tests/codegen 加 case：on_error=retry + 模拟连续失败 → 错误信息含 step number |
| 回滚 | git revert |

### Commit #11 — P2-2 nowNano 真精度（hrtime）

| 字段 | 内容 |
|---|---|
| files | src/manage/manage-tool.ts + src/manage/patch-store.ts |
| 改动类型 | edit |
| old → new | manage-tool.ts:184 `Date.now() * 1_000_000` → `Number(process.hrtime.bigint())`；patch-store.ts:35 `nextPatchId` 同样改用 hrtime + random 后缀 |
| why | Date.now()*1e6 名为 ns 但精度仍是 ms，sort tie-break 失效；P2-2 |
| 关联方 | replayAppliedPatches / findDependentAppliedPatches 排序逻辑不变（仍用 createdAtNano） |
| 测试 | tests/manage/manage.test.ts 加 case：同毫秒内 storePatch 两次 → createdAtNano 不同 |
| 回滚 | git revert |

### Commit #12 — P2-6 capability tree 反向索引

| 字段 | 内容 |
|---|---|
| files | src/capabilities/capability-tree.ts + tests/capabilities/capabilities.test.ts |
| 改动类型 | edit |
| old → new | 加 `private readonly _nameIndex = new Map<string, CapabilityNode>();`；addNode 时写入；removeNode 时清除；clone 时复制；lookupByName / lookupByToolHint 改用 _nameIndex.get() 替代遍历 |
| why | O(N) 遍历在 SKILL 注入后节点 N 较大时热路径退化为 O(N²)；P2-6 |
| 关联方 | clone() 必须同步复制索引；mergeNodeData 不影响 name → 不需更新索引 |
| 测试 | tests/capabilities 加：addNode → lookupByName 命中；removeNode → lookupByName 返回 undefined |
| 回滚 | git revert |

### Commit #13 — P0-1 顶层 index.ts re-export

| 字段 | 内容 |
|---|---|
| files | src/index.ts + 新建 tests/index/index.test.ts |
| 改动类型 | edit + new |
| old → new | src/index.ts 从 1 行 `export {};` 改为：`export * from "./capabilities/index.ts"; ... export * from "./tools/index.ts"; export * from "./mcp/index.ts";` 但 skill / manage 同名 type（SkillAgentConfig / SkillMode 等）需 explicit override —— 先尝试，typecheck 报错则回退到全 explicit named export |
| why | npm 用户 `import { CapabilityTree } from "@acosmi/skill-agent-mcp"` 当前得 undefined；必须修；P0-1 |
| 关联方 | 9 个子模块的 export；package.json#main / types / exports."." 指向 dist/index.js |
| 测试 | tests/index/index.test.ts：import 至少 8 个关键 export（CapabilityTree、createServer、AnthropicLLMClient、dispatchSkill、ComposedToolStore、executeManageTool、parseExtendedSkillFrontmatter、executeSkillSuggest），断言均为 truthy |
| 回滚 | git revert |

### Commit #14 — P1-1 contract.timeoutMs 一致性

| 字段 | 内容 |
|---|---|
| files | src/dispatch/agent.ts + 新建 tests/dispatch/agent-timeout.test.ts |
| 改动类型 | edit + new |
| old → new | agent.ts L286-315 重构：把 timeoutMs 计算（L312-315）上移到 contract 构造前；DelegationContract init 加 `timeoutMs` 字段（已在 DelegationContractInit 接口中存在 L172）；spawn 时仍用同一变量 |
| why | contract.timeoutMs 永远是默认 60_000 但 spawn 用用户值，formatForSystemPrompt 暴露不一致；P1-1 |
| 关联方 | 测试 dispatch.test.ts 已有 buildSkillAgentSystemPrompt 测试，不传 contract，不受影响 |
| 测试 | tests/dispatch/agent-timeout.test.ts：input.timeoutMs=30000 → 验证 spawn 收到的 contract.timeoutMs===30000 |
| 回滚 | git revert |

### Commit #15 — P1-2 注入 contract 到 skill agent system prompt

| 字段 | 内容 |
|---|---|
| files | src/dispatch/agent.ts + tests/dispatch/dispatch.test.ts（修改） |
| 改动类型 | edit |
| old → new | buildSkillAgentSystemPrompt 增加可选参数 `contract?: DelegationContract`；末尾若 contract 非空则拼 `\n---\n\n${contract.formatForSystemPrompt()}\n`；executeSkillDrivenSpawn L310 调用改为 `buildSkillAgentSystemPrompt(skill, contract)` |
| why | Go 端 spawn_media:135 注入了，spawn_blueprint:325-338 漏修；TS port 1:1 复制了遗漏；sub-agent 看不到 scope/constraints 会浪费 token；P1-2 |
| 关联方 | dispatch.test.ts L72-79 现有测试不传 contract → 仍 pass（向后兼容） |
| 测试 | dispatch.test.ts 加 case：buildSkillAgentSystemPrompt(skill, contract) 输出含 "## Delegation Contract" |
| 回滚 | git revert |

### Commit #16 — P0-3 双 bin

| 字段 | 内容 |
|---|---|
| files | bin/acosmi-skill-agent-mcp（编辑）+ bin/acosmi-skill-agent-mcp-bun（新建）+ package.json + examples/claude-desktop-config.json |
| 改动类型 | edit + new |
| old → new | bin/acosmi-skill-agent-mcp shebang `#!/usr/bin/env bun` → `#!/usr/bin/env node`；import `../src/cli/main.ts` → `../dist/cli/main.js`；新增 bin/acosmi-skill-agent-mcp-bun 用 bun shebang + .ts；package.json#bin 加 `"acosmi-skill-agent-mcp-bun"` 入口；scripts.start 改 `"bun src/cli/main.ts"`；scripts 加 `"start:built": "node bin/acosmi-skill-agent-mcp"`；examples/claude-desktop-config.json command 从 `"bun"` 改为 `"npx"` + args 加 `acosmi-skill-agent-mcp` |
| why | engines.node>=20 但 bin 强制 bun，是失实声明；node 用户 npm install 后 CLI 不工作；P0-3；用户 D4 |
| 关联方 | dist/cli/main.js 必须存在（prepublishOnly 已含 build）；package.json#files 已含 bin/ 和 dist/ |
| 测试 | 手测 `bun run build && node bin/acosmi-skill-agent-mcp --help` 应输出 help；`bun bin/acosmi-skill-agent-mcp-bun --help` 应输出 help |
| 回滚 | git revert（bin file mode 100755 在 .gitattributes 已设） |

### Commit #17 — P0-2 HTTP transport listener

| 字段 | 内容 |
|---|---|
| files | src/mcp/transport.ts（新增 startStreamableHttpServer）+ src/cli/main.ts（HTTP 分支重构）+ package.json（加 express + @types/express dep）+ 新建 tests/mcp/transport-http.test.ts |
| 改动类型 | edit + new |
| old → new | transport.ts 保留 createStreamableHttpTransport（向后兼容 transport object 创建），新增 `startStreamableHttpServer({ serverFactory, port?, host?, allowedHosts? }): Promise<StartedHttpServer>`：用 createMcpExpressApp + 维护 transports map + POST/GET/DELETE /mcp + listen + close()；cli/main.ts L153-162 重构调用 startStreamableHttpServer；package.json#dependencies 加 `"express": "^4.21.2"` 和 devDependencies 加 `"@types/express": "^4.17.21"` |
| why | StreamableHTTPServerTransport.start() 是 no-op，必须外部 wrapper forward 请求 → 当前 --transport http 完全不工作；P0-2 |
| 关联方 | createStdioTransport 行为不变；现有 cli stdio 分支不变 |
| 测试 | tests/mcp/transport-http.test.ts：随机端口起 server → POST /mcp initialize → 收 200 + sessionId → POST tools/list → 收响应 → close 测试 |
| 回滚 | git revert（npm install 会自动同步） |

### Commit #18 — docs 复核纠错 + 双兼容架构反映

| 字段 | 内容 |
|---|---|
| files | docs/jiagou/审计-acosmi-skill-agent-mcp-T3C-2026-05-01.md（追加）+ examples/agent-runner-impl.ts（注释更新）+ README.md + README.en.md + ARCHITECTURE.md + CHANGELOG.md |
| 改动类型 | edit |
| old → new | (a) 审计-T3C 文档末尾追加"## 复核纠错（2026-05-01 后追加）"段，撤回原"audit pass"结论 + 列本次 18 项修复；(b) examples/agent-runner-impl.ts 注释从 "AnthropicLLMClient from /llm" 改为 "AnthropicLLMClient or OpenAILLMClient (covers Claude / GPT / DeepSeek / Ollama OpenAI-mode / any compatible service)"；(c) README*.md / ARCHITECTURE.md 移除 Ollama 段，强调 Anthropic+OpenAI 双兼容；(d) CHANGELOG 新增 Unreleased 段含 BREAKING CHANGES（Ollama removed / LLMRequest.model required / DEFAULT_MODEL removed）+ Fixed（P0/P1/P2/P3）+ Added（HTTP listener / 双 bin / 顶层 re-export） |
| why | D6 + 反映本次架构纠正 |
| 关联方 | 所有面向用户的文档 |
| 测试 | markdown 渲染 + grep 检查关键 BREAKING CHANGE 是否提及 |
| 回滚 | git revert |

---

## 关联方调用图（已验证）

```
用户 npm install -g @acosmi/skill-agent-mcp
  └─ bin/acosmi-skill-agent-mcp [shebang=node, import dist/.js]      ← P0-3 修
       └─ dist/cli/main.js [build 自 src/cli/main.ts]
            ├─ parseArgs                                              ← unchanged
            ├─ loadOrEmptyTree → CapabilityTree.addNode (best-effort)
            │     └─ tree._nameIndex 同步                              ← P2-6 修
            ├─ setTreeBuilder
            ├─ loadComposedToolStore (atomic-read JSON)
            │     └─ isStoreData(data)                                ← P2-3 修
            ├─ createServer (mcp/server.ts)                            ← unchanged
            └─ if transport==="http": startStreamableHttpServer        ← P0-2 新建
                  ├─ createMcpExpressApp({ host, allowedHosts })       (SDK)
                  ├─ POST/GET/DELETE /mcp → transport.handleRequest
                  ├─ transports map (sessionId)
                  └─ httpServer.listen + close()
                else: createStdioTransport + server.connect            ← unchanged

用户 import { ... } from "@acosmi/skill-agent-mcp"
  └─ dist/index.js [build 自 src/index.ts]                              ← P0-1 修
       ├─ export * from capabilities/                                   (含 _nameIndex P2-6)
       ├─ export * from manage/
       ├─ export * from llm/                                            (减 Ollama A-1+A-2)
       │     ├─ types.ts (LLMRequest.model 必填 B-1)
       │     ├─ anthropic.ts (无默认模型 B-2 / SSE 修 P1-3)
       │     └─ openai.ts (无默认模型 B-3)
       ├─ export * from skill/                                          (复用 base.frontmatter P2-1)
       ├─ export * from dispatch/                                       (contract.timeoutMs P1-1 / 注入 contract P1-2)
       ├─ export * from codegen/                                        (loop 报错 P2-4 / retry 格式 P2-5)
       ├─ export * from tools/
       └─ export * from mcp/                                            (含 startStreamableHttpServer P0-2)

旁路 manage 子系统：
  capability_manage MCP tool → executeManageTool
       └─ propose_register / apply_patch → patch-store
             └─ nextPatchId / nowNano (hrtime P2-2)
```

跨语言边界：无（纯 TS）。
跨进程边界：MCP transport（stdio child process / Streamable HTTP）— SDK 拥有，本仓 wrapper P0-2。
跨包边界：node_modules/{@modelcontextprotocol/sdk, yaml, zod, **express（新增 P0-2）**}。

---

## 测试策略

### 单元测试（新建 / 修改）

| 文件 | 类型 | 覆盖 |
|---|---|---|
| `tests/index/index.test.ts` | 新建 | P0-1：顶层 import ≥8 关键 export |
| `tests/mcp/transport-http.test.ts` | 新建 | P0-2：随机端口 listen + initialize + tools/list 端到端 |
| `tests/dispatch/agent-timeout.test.ts` | 新建 | P1-1：contract.timeoutMs 一致性 |
| `tests/llm/anthropic-stream.test.ts` | 新建 | P1-3：SSE 多 tool_use（单/多/mixed/异常 4 场景）|
| `tests/dispatch/dispatch.test.ts` | 修改 | P1-2：buildSkillAgentSystemPrompt 含 contract 输出 "## Delegation Contract" |
| `tests/codegen/codegen.test.ts` | 修改 | P2-3 P2-4 P2-5：array tools 拒绝 / 非数组 loop_over 报错 / retry 格式 |
| `tests/manage/manage.test.ts` | 修改 | P2-2：同毫秒内 storePatch 两次 createdAtNano 不同 |
| `tests/capabilities/capabilities.test.ts` | 修改 | P2-6：addNode/removeNode 后 lookupByName 一致性 |

### 集成 / 手测

- `bun run typecheck`（每 commit 前必跑）
- `bun test`（每 commit 前必跑，看新加测试不 break 现有 136 pass）
- `bun run build`（commit #16 后必跑，确认 dist/ 生成）
- `node bin/acosmi-skill-agent-mcp --help`（commit #16 后手测，Node bin 可用）
- `bun bin/acosmi-skill-agent-mcp-bun --help`（commit #16 后手测，Bun bin 可用）
- `bun run start`（commit #16 后手测，开发期 stdio 启动）

---

## 回滚步骤

每 commit 独立可 revert。完整回滚顺序（如全部撤销）：

1. `git revert HEAD~17..HEAD`（按倒序 revert 18 个 commit）
2. `bun install`（如已 commit #17 的 express 依赖被 revert，npm 同步）
3. `bun test` + `bun run typecheck` 验证回到初始 136 pass

无外部副作用（无 DB / 无远程服务调用）。

---

## 提交计划（实时勾选）

每完成一项立即 Edit 本文件把 `[ ]` → `[x]` + 追加 `commit <sha>`：

- [x] commit 1：P3-1 注释清理（实测 15 文件 36 处；执行文档原"12 文件 33 处"低估；src/index.ts 11 处保留给 commit #13 重写） — commit b9ae49d
- [x] commit 2：A-1+A-2 删 Ollama — commit ca102bd
- [x] commit 3：B-1 LLMRequest.model 必填 — commit 190cb8c
- [ ] commit 4：B-2 删 anthropic DEFAULT_MODEL
- [ ] commit 5：B-3 删 openai DEFAULT_OPENAI_MODEL
- [ ] commit 6：P1-3 SSE 多 tool_use + 测试
- [ ] commit 7：P2-1 parse-extended 复用 base.frontmatter
- [ ] commit 8：P2-3 isStoreData 防 array
- [ ] commit 9：P2-4 loop_over 非数组报错
- [ ] commit 10：P2-5 retry/abort 格式统一
- [ ] commit 11：P2-2 nowNano hrtime
- [ ] commit 12：P2-6 反向索引
- [ ] commit 13：P0-1 顶层 re-export + 测试
- [ ] commit 14：P1-1 contract.timeoutMs + 测试
- [ ] commit 15：P1-2 注入 contract + 测试更新
- [ ] commit 16：P0-3 双 bin
- [ ] commit 17：P0-2 HTTP listener + express dep + 测试
- [ ] commit 18：docs 复核纠错 + 双兼容架构反映

---

## 已知风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| commit #13 P0-1 同名 type re-export TS ambiguity | 中 | 先 export * + explicit override 试，typecheck 失败回退全 explicit named |
| commit #17 P0-2 加 express 增大 ~5MB 安装大小 | 高（确定） | 接受 |
| commit #17 transport-http test 用随机端口可能 race | 低 | port 0 让 OS 分配 + 用 server.address() 取实际 port |
| commit #16 改 bin 后 bun start 走 src 不走 bin | 已设计 | scripts.start = "bun src/cli/main.ts" 不依赖 bin |
| commit #6 P1-3 SSE 重构状态机边界 case | 中 | 4 场景 mock 测试覆盖 |
| commit #15 P1-2 注入 contract 后 prompt 长度变长 | 低 | host 自己拼也是这个长度，差异不大 |
| commit #11 P2-2 hrtime.bigint 转 number 丢精度（>2^53） | 极低 | 进程启动后 hrtime 不会快速达 2^53 ns（约 104 天） |
| commit #2 + #3 BREAKING CHANGES | 高（确定） | CHANGELOG 明示 + v1.0 影响面极小（刚发布） |

---

## G7 续接首句强制动作（如本会话被 /compact）

**新窗口续接时第一动作必须**（不允许跳过）：

1. **Read** `D:\acosmi-skill-agent-mcp\docs\jiagou\执行-acosmi-skill-agent-mcp-修复-2026-05-01.md` 全文（恢复 commit checklist + 进度）
2. **Read** `C:\Users\fushihua\.claude\skills\crabcode-execute\SKILL.md`（重读本档协议，含 G1/G2/G6/G7/G8 等护栏）
3. **Read** `C:\Users\fushihua\.claude\projects\D--acosmi-skill-agent-mcp\memory\feedback_anti_hallucination_protocol.md`（反幻觉 8 条；如不存在则跳过）
4. **Skill 调用** `/crabcode-execute`（重新装载 skill 让协议生效）

**续接 prompt 模板**（用户在新窗口第一句直接粘贴）：

> 续接 acosmi-skill-agent-mcp 18 项修复任务的执行阶段。先按 SKILL.md G7 续接首句强制动作执行：
> 1. Read D:\acosmi-skill-agent-mcp\docs\jiagou\执行-acosmi-skill-agent-mcp-修复-2026-05-01.md
> 2. Read C:\Users\fushihua\.claude\skills\crabcode-execute\SKILL.md
> 3. Skill /crabcode-execute
> 完成后告诉我"协议加载完成，下一步 commit #N"。

---

## 衔接事后审计（commit #18 完成后强制）

完成后调用 `crabcode-audit` 子技能：

- [ ] 主文件复检（按本执行文档的 18 个 commit 清单逐项对照）
- [ ] 关联方重检（`src/index.ts` re-export 与 8 子模块一致性 / express 依赖在 package.json 与 transport.ts 互见）
- [ ] 举一反三扫描（重跑本次审计的 8 项关键 grep：`^export \{\};` `\.listen\(` `commit #` `[Oo]llama` `DEFAULT_MODEL` 等）
- [ ] 测试通过（136 pass 基线 + 新增 ≥10 个 case）/ 失败说明
- [ ] 文档回写（CHANGELOG / README / ARCHITECTURE / 复核纠错段都有）
- [ ] 风险公示（剩余未解 / 接受的风险）
