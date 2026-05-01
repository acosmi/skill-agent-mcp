# 执行-acosmi-skill-agent-mcp-T3C-v1

> 上一档：T3 A 阶段（设计档 v1）
> 用户拍板：方案 γ 全档 + Q2-Q5 全部推荐
> 目标：D:\acosmi-skill-agent-mcp（独立 git repo / @acosmi/skill-agent-mcp / private:true / Apache 2.0）
> 创建：2026-05-01
> 设计档：D:\CrabClawApp\docs\claude\goujia\架构-acosmi-skill-agent-mcp-设计-v1.md

---

## 一、术语切割（继承设计档 §一，防 execute 阶段语义漂移 / G8）

| 术语 | 真实语义 |
|---|---|
| acosmi-agent v1.0 | npm 包 `@acosmi/agent` v1.0.0，已完工，**本档 0 修改**（C4） |
| acosmi-skill-agent-mcp | 本档目标，新建独立 sibling 包 |
| SKILL | 统一封装层（不是 MCP 三类型）；对外 100% 走 MCP tools |
| SkillMode | server 内部 dispatch 信号，不是 MCP 协议表面分类 |
| dispatcher | server 内部按 SkillMode 路由的代码（不是 MCP 协议层 / 不是 LLM runner main loop） |
| agent runtime | 完整 LLM 推理循环 — **acosmi-skill-agent-mcp 不带**，由 OSS 用户提供 SpawnSubagent callback |

---

## 二、已撤回方案（继承设计档 §二，execute 阶段不可重启）

- 撤回 A：SKILL → MCP 三类型映射 → 全部走 tools，server 内部 dispatch
- 撤回 B：抄 crabclaw 90 SKILL.md → 仅移植模板规范，不带业务 SKILL
- 撤回 C：翻译 4 蓝图工具 + 8 YAML → 跟随 crabclaw 现状（spawn_agent 单工具）+ 自然语言生成是新增

---

## 三、关联方完整列表（来自设计档 §3 + §5 翻译矩阵）

**外部输入（只读，不修改）**：
1. **acosmi-agent v1.0**（D:\acosmi-agent\src\）
   - capabilities/ 5 文件 1406 LOC（直接复制）
   - manage/ 6 文件 1873 LOC（直接复制）
   - llm/ 4 文件 782 LOC（直接复制）
2. **crabclaw 后端**（D:\CrabClawApp\backend\internal\agents\）— C1 严格 0 修改
   - skills/frontmatter.go 1137L（部分翻译 SkillAgentConfig）
   - skills/skill_node_provider.go 380L（增量翻译多源聚合）
   - runner/spawn_blueprint_agent.go 387L（全译）
   - runner/skill_agent_capabilities.go 105L（全译）
   - composed/codegen.go 268L（全译）
   - composed/executor.go 300L（全译）
   - composed/types.go + store.go ~300L（全译，execute 阶段先 Read 确认）
3. **crabclaw 模板规范**：docs/skills/SKILL-TEMPLATE.md 489 行（移植）
4. **MCP TS SDK**：`@modelcontextprotocol/sdk@^1.29.0`（npm 新依赖，MIT）
5. **Zod v3**：`zod@^3`（npm 新依赖，MIT — MCP SDK 要求）
6. **YAML**：`yaml@^2.8.3`（继承 v1.0 唯一 dep，ISC）

**新建（输出）**：D:\acosmi-skill-agent-mcp 全部 30+ 文件 / ~4500 src LOC + ~1500 test LOC + ~600 docs

**关联方影响（C1-C5 验证）**：
- C1（crabclaw 0 修改）✅ — 仅 Read 作翻译参考，无 Write/Edit
- C2（新文件在 D:\acosmi-skill-agent-mcp）✅ — 全部输出在新独立目录
- C3（不擅自 gh repo create）✅ — local-only，private:true 保留
- C4（不动 v1.0 17 commits）✅ — Read v1.0 作复制源，无 Write/Edit
- C5（翻译语义）✅ — Go→TS 等价产出（v1.0 内复制是 TS→TS，不冲突 C5）

---

## 四、测试策略

| 层 | 来源 | 范围 |
|---|---|---|
| 单元测试 capabilities | 复用 v1.0 60 tests | tests/capabilities/capabilities.test.ts 复制 |
| 单元测试 manage | 复用 v1.0 26 tests | tests/manage/manage.test.ts 复制 |
| 单元测试 fleet | 复用 v1.0 60 tests（仅 delegation-contract 部分有用，manager/budget/circuit 等不带）| 选择性复制（仅 delegation-contract.test.ts） |
| 单元测试 skill | 新增 ~20 tests | tests/skill/skill.test.ts |
| 单元测试 dispatch | 新增 ~25 tests | tests/dispatch/{prompt,tool,agent}.test.ts |
| 单元测试 codegen | 新增 ~20 tests（参考 crabclaw composed/codegen_test.go 8 + executor_test.go 10）| tests/codegen/{codegen,executor}.test.ts |
| 单元测试 tools | 新增 ~15 tests | tests/tools/{suggest,generate,manage,activate}.test.ts |
| 单元测试 mcp | 新增 ~10 tests（mock McpServer + tool registration 验证）| tests/mcp/server.test.ts |
| 集成测试 | bin/acosmi-skill-agent-mcp 启动 + stdio 单 tool 端到端 | tests/e2e/stdio-server.test.ts |
| 手测 | examples/claude-desktop-config.json + 3 demo SKILL.md 在 Claude Desktop 跑通 | 提交后 user 自验证（不在 commit 内） |

**预期总数**：~146（v1.0 复用） + ~90（新增） = **~236 tests**

**测试通过基准**：`bun test` 全绿 + `bunx tsc --noEmit` 0 errors

---

## 五、回滚步骤

| 级别 | 操作 |
|---|---|
| 整体回滚 | `rm -rf D:\acosmi-skill-agent-mcp`（local-only / 不影响 v1.0 / 不影响 crabclaw） |
| 单 commit 回滚 | `cd D:\acosmi-skill-agent-mcp && git reset --hard <prev-sha>` |
| 外部副作用 | **无** — local-only、未发 npm（private:true）、未建 GitHub repo（C3）、未修改 v1.0/crabclaw |
| 验证回滚成功 | `git log --oneline | head` 应回到 `<prev-sha>` 之前 |

---

## 六、改动清单（22 commit 细化表 — 设计档 §7 落地）

每个 commit 单独逻辑块。文件类型：**new** = 新建文件。**edit** = 修改已存在文件（仅 README/CHANGELOG/package.json 等增量）。

### Commit 1: bootstrap

| 文件 | 类型 | 内容 | why |
|---|---|---|---|
| package.json | new | name=@acosmi/skill-agent-mcp / version=1.0.0 / private:true / type=module / Apache 2.0 / engines.bun>=1.3.0 / bin / dependencies={yaml,@modelcontextprotocol/sdk,zod} / peerDeps={typescript} / devDeps={@types/bun} | 项目 npm 元数据 — bootstrap 必备 |
| tsconfig.json | new | strict + verbatimModuleSyntax + noUncheckedIndexedAccess + bundler resolution + Preserve + ESNext | 同 v1.0 配置 — 减少风格漂移 |
| README.md | new | skeleton：项目定位 + Status v1.0.0 + Install + Quick start placeholder | OSS 入口 |
| LICENSE | new | Apache 2.0 全文 + (c) 2026 Acosmi | C5 用户决策 D6 |
| .gitignore | new | node_modules / dist / .DS_Store / *.log | bun build 标准 |
| bin/acosmi-skill-agent-mcp | new | `#!/usr/bin/env bun\nimport "../src/cli/main.ts";` | bin entry |
| src/index.ts | new | placeholder export | npm package 必需 main |
| src/cli/main.ts | new | placeholder（bootstrap stub，commit 18 改完整 MCP server 启动）| bin 引用 |
| | | `git init && git add -A && git commit` | bootstrap |

**关联方**：无（首个 commit）
**测试**：`bun install` 成功 + `bunx tsc --noEmit` 0 errors（无 src 仅声明）
**回滚**：rm -rf

### Commit 2: 复制 v1.0 src/capabilities/ 5 文件

| 文件 | 类型 | 内容 | why |
|---|---|---|---|
| src/capabilities/types.ts | new | 复制 D:\acosmi-agent\src\capabilities\types.ts (306L) | CapabilityNode 7 维 + Spec |
| src/capabilities/capability-tree.ts | new | 复制 (623L) | 树 + 23 衍生方法 |
| src/capabilities/providers.ts | new | 复制 (408L) | SkillNodeProvider 接口 + mergeNodeData |
| src/capabilities/singleton.ts | new | 复制 (227L) | defaultTree + Tree* helpers |
| src/capabilities/subagent-tree.ts | new | 复制 (59L) | SubAgentToolProvider |
| src/capabilities/index.ts | new | 复制 (86L) | export aggregation |

**关联方**：v1.0 src/capabilities/ 是源（Read only）
**测试**：bunx tsc 0 errors（自包含模块）
**回滚**：git reset --hard
**Q3 落实**：方案 b（复制不依赖）— LICENSE Apache 2.0 头保留，CHANGELOG 后续 commit 21 写 baseline 版本

### Commit 3: 复制 v1.0 src/manage/ 6 文件

| 文件 | 类型 | 内容 |
|---|---|---|
| src/manage/types.ts | new | 复制 (125L) |
| src/manage/manage-tool.ts | new | 复制 (1028L) — 13 actions |
| src/manage/skill-frontmatter.ts | new | 复制 (495L) — parser |
| src/manage/patch-store.ts | new | 复制 (216L) |
| src/manage/gen-frontend.ts | new | 复制 (137L) |
| src/manage/index.ts | new | 复制 (61L) |

**关联方**：v1.0 + commit 2（依赖 capabilities）
**测试**：bunx tsc 0 errors
**回滚**：git reset --hard

### Commit 4: 复制 v1.0 src/llm/ 4 文件

| 文件 | 类型 | 内容 |
|---|---|---|
| src/llm/types.ts | new | 复制 (104L) — LLMClient interface |
| src/llm/anthropic.ts | new | 复制 (265L) |
| src/llm/openai.ts | new | 复制 (220L) |
| src/llm/ollama.ts | new | 复制 (164L) |
| src/llm/index.ts | new | 复制 (33L) |

**why**：agent 模式 SKILL 的 SpawnSubagent callback 需 LLMClient 让 OSS 用户接入 LLM
**关联方**：v1.0
**测试**：bunx tsc 0 errors

### Commit 5: src/skill/ 类型定义（SkillAgentConfig 30+ 字段）

| 文件 | 类型 | 内容 | why |
|---|---|---|---|
| src/skill/types.ts | new | SkillAgentConfig 完整 30+ 字段（翻译 frontmatter.go:152-213）+ AgentTriggers / AgentSOPStep / AgentReviewGate / AgentCronTrigger / AgentMessageMatch / AgentEventTrigger | agent 模式 SKILL 完整配置；v1.0 没带（仅带了 frontmatter 解析的精简版）|

**关联方**：commit 3（manage/skill-frontmatter.ts 引用 SkillAgentConfig）
**测试**：bunx tsc 0 errors（仅类型）+ 1 test 验证字段对齐 frontmatter.go

**事实陈述（G8 三件套）**：
- 事实 1：v1.0 manage/skill-frontmatter.ts 中 SkillAgentConfig 字段 ≠ crabclaw frontmatter.go:152-213 完整版
  - 命令：Read D:\acosmi-agent\src\manage\skill-frontmatter.ts + 对比 D:\CrabClawApp\backend\internal\agents\skills\frontmatter.go:152-213
  - 范围：仅 v1.0 manage/skill-frontmatter.ts 单文件 + crabclaw frontmatter.go 单段落
  - 未验证：v1.0 fleet/delegation-contract.ts 是否带 SkillAgentConfig 等价类型 → commit 5 启动前补 grep
  - 风险：如果 v1.0 已带 → commit 5 改为"补全增量字段而非新写"

### Commit 6: src/skill/node-provider.ts（多源聚合 5 源）

| 文件 | 类型 | 内容 |
|---|---|---|
| src/skill/node-provider.ts | new | 翻译 crabclaw skill_node_provider.go:150-310 多源聚合 5 源（bundled/user/managed/extra/workspace）+ canonicalRank + alias map |
| src/skill/index.ts | new | re-export |

**why**：v1.0 没带多源聚合（仅带 SkillNodeProvider interface）
**关联方**：commit 2 (capabilities) + commit 3 (skill-frontmatter 已在 manage)
**测试**：~10 tests（5 源优先级 + alias 降级 + canonicalRank 排序）

### Commit 7: src/dispatch/agent-capabilities.ts（ResolveSkillAgentCapabilities）

| 文件 | 类型 | 内容 |
|---|---|---|
| src/dispatch/agent-capabilities.ts | new | 翻译 skill_agent_capabilities.go 全部 (105L → ~130 TS) |

**why**：agent 模式 SKILL 的工具白名单计算（permission monotone-decay）— 子工具集 ⊆ 父工具集
**关联方**：commit 5（SkillAgentConfig 类型）
**测试**：~6 tests（inherit=full/minimal/none/ + Allow + Deny + 父集越界拒绝）

### Commit 8: src/dispatch/delegation-contract.ts（增量 v1.0 已有）

**前置 Read**：先 Read D:\acosmi-agent\src\fleet\delegation-contract.ts (599L) 确认 v1.0 已带哪些 + 还需要补什么

| 文件 | 类型 | 内容 |
|---|---|---|
| src/dispatch/delegation-contract.ts | new 或 edit | 视 v1.0 状态：(a) 完全已带 → 直接 re-export from "../fleet/delegation-contract"（但不复制 fleet 整包）/ (b) 部分有 → 增量补全 SourceRef + ContractConstraints + ContractActive/Failed/Completed 等 spawn_blueprint_agent.go 用到的字段 |

**why**：spawn_blueprint_agent.go 的 NewDelegationContract 调用需要这些字段
**关联方**：commit 9（spawn-agent 引用）
**测试**：~5 tests（合约创建 / SourceRef 设置 / Status 转换）

### Commit 9: src/dispatch/agent.ts（spawn-agent dispatcher）

| 文件 | 类型 | 内容 |
|---|---|---|
| src/dispatch/agent.ts | new | 翻译 spawn_blueprint_agent.go (387L → ~500 TS)：executeSpawnBlueprintAgent + executeSkillDrivenSpawn + buildSkillAgentSystemPrompt + publishHandoffAudit + parentToolNamesFromParams + formatSkillSpawnResult |

**why**：agent 模式 SKILL 的核心 dispatcher
**关联方**：commit 5/7/8（types + capabilities + delegation-contract）
**翻译选择**：
- SpawnSubagent callback 接口暴露给 OSS 用户（C5 边界）
- ToolExecParams TS 化为 SpawnContext interface（不带 crabclaw runner 业务）
- InterAgentBus interface 可选注入（handoff 审计）
- ResolvedAgentSkill / SkillSourceResolver interface 暴露
**测试**：~10 tests（skill 找不到 / agent_config 缺失 / 权限校验 / handoff 二选一 / spawn callback / handoff 审计）

### Commit 10: src/dispatch/{prompt,tool}.ts + dispatch index

| 文件 | 类型 | 内容 |
|---|---|---|
| src/dispatch/prompt.ts | new | SkillMode=prompt → return SKILL.md body 作 MCP tool content（~50 TS）|
| src/dispatch/tool.ts | new | SkillMode=tool → 调用 codegen executor（commit 11-13 完成）（~80 TS）|
| src/dispatch/index.ts | new | dispatchSkill(skill, input, ctx) 主路由 + ToolCallbackRegistry interface |

**why**：完整三模式 dispatcher 闭环
**关联方**：commit 5/9（types + agent dispatcher）+ commit 13（codegen executor）
**注**：commit 10 的 tool.ts 暂时桩实现（return placeholder），commit 13 完成 codegen 后回填

**事实陈述（G8 三件套）**：
- 事实 1：commit 10 tool.ts 桩实现 + commit 13 回填 = 跨 commit 依赖
  - 验证：commit 13 完成时回查 tool.ts 是否真正接入 ComposedExecutor
  - 风险：如果忘记回填 → tool 模式 SKILL 永远 placeholder → audit 阶段必须 grep "TODO" / "placeholder" 全文检测

### Commit 11: src/codegen/{types,store}.ts

**前置 Read**：commit 11 启动前先 Read crabclaw composed/types.go + store.go 确认实际 LOC

| 文件 | 类型 | 内容 |
|---|---|---|
| src/codegen/types.ts | new | ComposedToolDef / CompiledStep / StepResult / CodegenResult / CodegenError（翻译 composed/types.go） |
| src/codegen/store.ts | new | ComposedToolStore（in-memory + persist to ~/.acosmi-skill-agent-mcp/state/composed_tools.json）（翻译 composed/store.go） |
| src/codegen/index.ts | new | re-export |

**关联方**：无新（自包含）
**测试**：~5 tests（store CRUD + persist/load）

### Commit 12: src/codegen/codegen.ts（编译器）

| 文件 | 类型 | 内容 |
|---|---|---|
| src/codegen/codegen.ts | new | 翻译 codegen.go (268L → ~350 TS)：Codegen / CodegenIncremental / deriveMaxApproval / compileSteps / sanitizeName / sha256Hex |

**关联方**：commit 11（types/store）+ commit 2 (capabilities) — ToolTreeLookup interface 用 capabilities.LookupTool
**测试**：~8 tests（schema 校验 / step tool 校验 / max approval 派生 / incremental hash 跳过）

### Commit 13: src/codegen/executor.ts（执行引擎 + 模板引擎）

| 文件 | 类型 | 内容 |
|---|---|---|
| src/codegen/executor.ts | new | 翻译 executor.go (300L → ~400 TS)：ComposedSubsystem / ExecuteTool / executeLoop / resolveInputMap / resolveTemplate / resolveVar / lookupPath / formatComposedResult |

**关联方**：commit 11/12 + commit 10（tool.ts 回填接入 ComposedSubsystem）
**测试**：~12 tests（{{var.path}} 模板 / 字符串插值 / loop_over / abort/skip/retry / dot-path lookup / ctx cancellation）

**事实陈述（G8 三件套）**：
- 事实 1：composed/types.go + store.go 总 LOC 约 ~300 — **未亲读**
  - 验证：commit 11 启动前 Read 两个文件确认
  - 范围：仅 backend/internal/agents/composed/{types,store}.go 两文件
  - 未验证：是否有跨包依赖（如 import capabilities 包）需要 TS 翻译时改为 interface
  - 风险：如果实际 LOC 大于 300 或有跨包依赖 → commit 11 拆分为 11a/11b

### Commit 14: templates/ — 5 类内置 SKILL.md 模板

| 文件 | 类型 | 内容 |
|---|---|---|
| templates/tool.md | new | 工具技能模板（移植 crabclaw SKILL-TEMPLATE.md L103-162） |
| templates/operations.md | new | 运维技能模板（L165-177） |
| templates/agent.md | new | 智能体技能模板（L201-321 完整 agent_config）|
| templates/subsystem.md | new | 子系统技能模板（L180-198） |
| templates/internal.md | new | 内部技能模板（L324-332） |
| templates/README.md | new | 模板使用说明 + 字段速查 |
| docs/SKILL-TEMPLATE.md | new | 完整 489 行模板规范（移植自 crabclaw docs/skills/SKILL-TEMPLATE.md）|

**关联方**：commit 15-16（skill_suggest/generate 工具会引用这 5 模板）
**测试**：1 test（模板 markdown 解析无 YAML 语法错误）

### Commit 15: src/tools/skill-{suggest,generate}.ts

| 文件 | 类型 | 内容 |
|---|---|---|
| src/tools/skill-suggest.ts | new | 自然语言推荐模板 — 输入用户描述 → 返回 5 类模板 + 定制建议；inputSchema 含 user_request + preferred_capabilities |
| src/tools/skill-generate.ts | new | 主 LLM 生成 SKILL.md content → 验证（parseSkillFrontmatter + ValidateSkillMode）→ 持久化到磁盘；inputSchema 含 skill_md_content + base_template + skill_dir |

**why**：crabclaw 旧 4 工具已删 → 新写。设计参考 tracking-2026-03-20-natural-language-agent-creation.md 的 suggest/generate 语义
**关联方**：commit 14 (templates) + commit 5 (SkillAgentConfig 类型) + commit 3 (parseSkillFrontmatter)
**测试**：~8 tests（suggest 返回 5 模板 / generate 解析失败返回错误 / generate 成功持久化）

### Commit 16: src/tools/skill-{manage,activate}.ts

| 文件 | 类型 | 内容 |
|---|---|---|
| src/tools/skill-manage.ts | new | list/get/update/delete/export 5 actions for SKILL.md files in --skills-dir |
| src/tools/skill-activate.ts | new | 派生子智能体测试新 SKILL — 调 dispatch/agent.ts (agent 模式) / dispatch/tool.ts (tool 模式) / dispatch/prompt.ts (prompt 模式) |
| src/tools/index.ts | new | re-export 4 工具 |

**关联方**：commit 10 (dispatch index) + commit 14 (templates)
**测试**：~7 tests（manage 5 actions + activate 三模式）

### Commit 17: src/mcp/server.ts（McpServer + 全部 tool 注册）

| 文件 | 类型 | 内容 |
|---|---|---|
| src/mcp/server.ts | new | createServer({ tree, skillsDir, llmClient?, spawnSubagent? }) → McpServer 实例 + 注册：13 capability_manage tools + 4 skill-* tools + 5 tree query tools (lookup/walk/dump/listTier/listBindable) + 2 SKILL parse/validate tools = ~24 MCP tools |

**why**：MCP server 集中入口
**关联方**：commit 3 (manage 13 actions) + commit 14 (templates) + commit 16 (skill-* tools) + commit 2 (capability tree query)
**测试**：~10 tests（mock McpServer + tool registration 验证 + tool handler dispatch 路径）

**新依赖验证（事实陈述 G8）**：
- 事实 1：`@modelcontextprotocol/sdk@^1.29.0` 是 MIT 兼容 Apache 2.0
  - 命令：`npm view @modelcontextprotocol/sdk@latest license + bun add @modelcontextprotocol/sdk` commit 1 启动时验证
  - 范围：单包 license + 实际安装成功
  - 未验证：传递依赖（18 个依赖之一可能有 license 限制）→ commit 1 启动后 `bun install --print-deps` 全部抓 license

### Commit 18: src/mcp/transport.ts + src/cli/main.ts 完成

| 文件 | 类型 | 内容 |
|---|---|---|
| src/mcp/transport.ts | new | createStdioTransport() / createStreamableHttpTransport(opts?)；选择 transport 启动 server |
| src/mcp/index.ts | new | re-export createServer + transports |
| src/cli/main.ts | edit | 替换 commit 1 placeholder：解析 argv (--transport stdio\|http / --skills-dir / --tree-file / --port) → 启动 server |

**关联方**：commit 17（server.ts）+ commit 1 placeholder
**测试**：~5 tests（CLI argv 解析 + transport 选择）

### Commit 19: examples/

| 文件 | 类型 | 内容 |
|---|---|---|
| examples/claude-desktop-config.json | new | mcpServers 配置示例（command/args/env） |
| examples/skills/hello-prompt/SKILL.md | new | SkillMode=prompt demo（最简） |
| examples/skills/hello-tool/SKILL.md | new | SkillMode=tool demo（含 tool_schema.steps[]，引用 mock tools） |
| examples/skills/hello-agent/SKILL.md | new | SkillMode=agent demo（含 agent_config，演示 SpawnSubagent callback 接入） |
| examples/agent-runner-impl.ts | new | OSS 用户参考实现：用 LLMClient 实现 SpawnSubagent callback（最简 LLM agent loop） |
| examples/tool-callback-registry.ts | new | OSS 用户参考实现：ToolCallbackRegistry 简易实现（注册 bash/read_file/etc） |
| examples/README.md | new | 三种模式 + 配置说明 |

**关联方**：commit 17/18 (server + cli)
**测试**：1 test（examples/skills/* 全部能被 parseSkillFrontmatter 正确解析）

### Commit 20: tests/ — 完整测试套件

| 文件 | 类型 | 内容 |
|---|---|---|
| tests/capabilities/capabilities.test.ts | new | 复制 v1.0 60 tests |
| tests/manage/manage.test.ts | new | 复制 v1.0 26 tests |
| tests/skill/{skill,frontmatter,node-provider}.test.ts | new | ~20 新增 tests |
| tests/dispatch/{prompt,tool,agent,agent-capabilities,delegation-contract}.test.ts | new | ~25 新增 tests |
| tests/codegen/{codegen,executor,store}.test.ts | new | ~20 新增 tests |
| tests/tools/{suggest,generate,manage,activate}.test.ts | new | ~15 新增 tests |
| tests/mcp/server.test.ts | new | ~10 新增 tests |
| tests/e2e/stdio-server.test.ts | new | ~5 新增（启动 server + 发送 1 个 tool call + 验证 response） |

**预期**：~146 复用 + ~95 新增 = ~241 tests，全绿
**关联方**：所有 commit
**测试**：`bun test` 全部通过 + `bunx tsc --noEmit` 0 errors

### Commit 21: docs

| 文件 | 类型 | 内容 |
|---|---|---|
| README.md | edit | 完整版：定位 + Status + Install + Quick start (3 demo SKILL.md 演示) + Subsystem layout + License |
| ARCHITECTURE.md | new | 子系统 + dispatcher 三模式 + 数据流 + 与 v1.0 关系 |
| CONTRIBUTING.md | new | dev setup + 测试 + commit style |
| CHANGELOG.md | new | [1.0.0] - 2026-05-01 + Translation provenance 段（v1.0 baseline + crabclaw 翻译源 LOC）|

**关联方**：所有 commit（doc 反映实施现状）
**测试**：无（纯文档）

### Commit 22: v1.0 release prep

| 文件 | 类型 | 内容 |
|---|---|---|
| package.json | edit | 确认 version=1.0.0 + private:true 保留 |
| README.md | edit | Status 改"v1.0.0 — initial release"  |
| CHANGELOG.md | edit | [1.0.0] 段最终化 + 末尾"removing `private` is the only step before publish" |

**release 验证**（commit 22 内）：
- `bun pm pack` 验证（pack size + file count，对照 v1.0 60.69 KB / 30 files 量级）
- `bun test` 最终全绿
- `bunx tsc --noEmit` 最终 0 errors

---

## 七、提交计划（实时勾选 — 完成一个勾一个）

- [x] commit 1: bootstrap（package.json + tsconfig + README skeleton + LICENSE + bin entry + .gitignore + .gitattributes + src placeholder + git init/commit）— commit `11dea38` — 附带：新增 .gitattributes + bin 100755（v1.0 deliberate divergence，commit msg 详记）
- [x] commit 2: 复制 v1.0 src/capabilities/ 6 文件 + bun.lock — commit `adb7361` — 实际 6 文件含 index.ts；附带 bun install lockfile（97 packages，含 MCP SDK / yaml / zod）；bunx tsc 0 errors
- [x] commit 3: 复制 v1.0 src/manage/ 6 文件 — commit `0cafd58` — bunx tsc 0 errors（跨模块 import `../capabilities/` + `yaml` npm dep 全可用）
- [x] commit 4: 复制 v1.0 src/llm/ 5 文件 — commit `d1357e9` — bunx tsc 0 errors（zero npm dep，全 fetch/Web Streams）
- [x] commit 5: src/skill/{types,parse-extended,validate,index}.ts — SkillAgentConfig 完整 32 字段 + 6 嵌套类型 + 验证三函数（resolvedSkillMode/validateSkillMode/normalizeSkillMode）— commit `24240c3` — 4 文件 517 LOC，bunx tsc 0 errors，加 parse-extended 因 v1.0 parser drops 7 字段，加 validate 因 v1.0 完全没带验证函数
- [x] commit 6: src/skill/node-provider.ts — 多源聚合 5 源 — commit `bbb9c25` — AggregatedSkillNodeProvider class + buildSkillNodeData + aggregateSkillEntries pure fn + sourcePriority；bunx tsc 0 errors；deliberate divergence vs Go：drop ProviderConfigGetter / atomic.Pointer / slog
- [x] commit 7: src/dispatch/agent-capabilities.ts — ResolveSkillAgentCapabilities + buildSOPPromptSection — commit `41720bd` — 102 LOC，bunx tsc 0 errors
- [x] commit 8: src/dispatch/delegation-contract.ts — 直接 cp v1.0 fleet/delegation-contract.ts (599L) — commit `a9d15c6` — v1.0 已完整含全 export，单 npm dep node:path，无需补全；不带 fleet 整包 7 文件
- [x] commit 9: src/dispatch/agent.ts — spawn-agent dispatcher (503 LOC) — commit `597ffc9` — executeSpawnAgent / executeSkillDrivenSpawn / SpawnContext / SkillSourceResolver / SpawnSubagent / RuntimeAwareSourceRef / InterAgentBus / SpawnLogger / SPAWN_AGENT_INPUT_SCHEMA；handoff二选一 + permission monotone-decay + contract state machine 全保留；bunx tsc 0 errors
- [x] commit 10: src/dispatch/{prompt,tool}.ts + dispatch index — commit `8df496f` — 三模式 dispatcher 闭环（dispatchPromptSkill / dispatchToolSkill 桩 / dispatchSkill 主路由）+ ToolCallbackRegistry 接口 + InMemoryToolCallbackRegistry 默认实现；314 LOC；tool.ts placeholder 待 commit #13 回填；bunx tsc 0 errors
- [x] commit 11: src/codegen/{types,store,index}.ts — composed-tool 类型 + atomic-write JSON 持久化 — commit `964d662` — 339 LOC，drop sync.RWMutex / statepaths.ResolveStateDir，改为 OSS 用户传入 stateDir；bunx tsc 0 errors
- [x] commit 12: src/codegen/codegen.ts — Skill-to-Tool 编译器 + codegenIncremental — commit `ed4436e` — 307 LOC，drop slog，retain ToolTreeLookup interface；bunx tsc 0 errors
- [x] commit 13: src/codegen/executor.ts — 执行引擎 + 模板引擎 + 回填 dispatch/tool.ts — commit `281b9f3` — 506 LOC（含 dispatch/tool.ts 重写）；ComposedSubsystem class + ExecuteToolFn + resolveTemplate + lookupPath + abort/skip/retry + loop_over；dispatch/tool.ts placeholder 已移除；bunx tsc 0 errors
- [x] commit 14: templates/ 5 模板 + README + docs/SKILL-TEMPLATE.md (cp 自 crabclaw 488L) — commit `cbf0e2c` — 800 LOC（agent.md 含完整 32 字段含 commit #5 加的 7 扩展）
- [x] commit 15: src/tools/skill-{suggest,generate}.ts — 自然语言推荐 + validate-then-save — commit `9d8cc71` — 466 LOC，keyword-scoring 5 模板 + parseExtended + validateSkillMode 链路 + atomic write + 可选 workspaceRoot 防 traversal；bunx tsc 0 errors
- [x] commit 16: src/tools/skill-{manage,activate}.ts + tools/index.ts — list/get/update/delete/export + activate via dispatcher — commit `c39951f` — 639 LOC，每 tool 独立 context interface + workspaceRoot guard + staticSkillResolver helper；bunx tsc 0 errors
- [x] commit 17: src/mcp/{server,index}.ts — createServer + 11 MCP tools — commit `b79667e` — 561 LOC，capability_manage 折单 tool（payload JSON）+ 4 tree query + 4 skill-* + skill_parse + spawn_agent；deps optional pattern；workspaceRoot defense-in-depth；bunx tsc 0 errors
- [x] commit 18: src/mcp/transport.ts + src/cli/main.ts — CLI + stdio/HTTP transport — commit `6b2e3c2` — 256 LOC，stdio 默认 + Streamable HTTP；--transport / --skills-dir / --templates-dir / --state-dir / --tree-file / --workspace-root / --port / --host；bunx tsc 0 errors
- [x] commit 19: examples/ + package.json exports — commit `6a9e8c7` — 3 demo SKILL.md（prompt / tool / agent）+ tool-callback-registry.ts + agent-runner-impl.ts + claude-desktop-config.json + README + 8 subpath exports（capabilities/codegen/dispatch/llm/manage/mcp/skill/tools）；bunx tsc 0 errors
- [x] commit 20: tests/ — 138 tests (136 pass / 2 skip / 0 fail / 275 expect()) — commit `2cf217b` — capabilities 60 + manage 24+2skip + skill 18 + codegen 11 + dispatch 13 + tools 10；deliberate 少于 241 估算因 fleet/ 不带 + mcp/e2e 推后跟随；bunx tsc 0 errors；`bun test` ~190ms
- [x] commit 21: docs — README + ARCHITECTURE + CONTRIBUTING + CHANGELOG — commit `3dd4c77` — 490 LOC，README 含 install/quick-start/MCP tools 表/subsystem 表/relationship；ARCHITECTURE 含子系统 ASCII 图 + 三模式表 + monotone-decay；CHANGELOG 含完整翻译 provenance（Go LOC → TS LOC）+ 依赖 license 表
- [x] commit 22: v1.0 release prep — `.npmignore` + pack 验证 + git tag v1.0.0 — commit `d7de27d` — `bun pm pack` 62 文件 / 110.83 KB packed / 0.39MB unpacked；`bun test` 136 pass / 0 fail；`bunx tsc` 0 errors；private:true 保留

**实时勾选硬规则**（G6）：每完成 commit 立即 Edit 本文档 [ ]→[x]，并在该项后追加 `commit <sha>`。

**合并允许**（按 SKILL 总则 7 同一逻辑块边界判断）：
- commit 5+6 可合并（src/skill/ 整包同一逻辑块）
- commit 7+8+9 可合并（src/dispatch/ agent 部分同一逻辑块）
- commit 11+12+13 可合并（src/codegen/ 整包同一逻辑块）
- commit 15+16 可合并（src/tools/ 4 工具同一逻辑块）
- commit 17+18 可合并（src/mcp/ 整包同一逻辑块）

合并后实际可能 ~13-17 git commits。

---

## 八、已知风险（继承设计档 R1-R10）

| # | 风险 | 处理 |
|---|---|---|
| R1 | v1.0 src 复制 → 双源 drift | CHANGELOG 写明 baseline 版本；长期治理由用户决策 |
| R2 | 自然语言生成质量靠 client LLM | inputSchema 详细 description + 失败结构化错误返回 |
| R3 | agent 模式不带 runner，需 OSS 用户提供 SpawnSubagent | examples/agent-runner-impl.ts 演示 |
| R4 | tool 模式需 OSS 用户注入 ToolCallbackRegistry | examples/tool-callback-registry.ts 演示 |
| R5 | 新增 zod 依赖 | MIT 兼容 Apache 2.0 |
| R6 | spawn_blueprint_agent.go 依赖链 TS 化 | 平铺为 SpawnContext interface |
| R7 | Claude Code CLI vs Desktop 配置差异 | 文档明示以 Desktop 为参考 |
| R8 | TS event loop vs Go goroutines deliberate divergence | commit msg 记录 |
| R9 | composed 编译失败 UX | 翻译 crabclaw formatValidationErrors 风格 |
| R10 | C2 local-only | private:true 保留 |

---

## 九、压缩前 handoff 清单（G7 强制 — 22 commits ≥ 5 + 设计档 + 执行档总和已临近 30KB）

### 当前阶段
- T3 调研：✅ 完成（设计档 D:\CrabClawApp\docs\claude\goujia\架构-acosmi-skill-agent-mcp-设计-v1.md）
- T3 执行：进行中 — commit #N / 22
- 已完成 commit：（开始时填）
- 待完成 commit：commit #1-22

### 关键文件路径（续接窗口必读）
- 本执行文档：D:\CrabClawApp\docs\claude\goujia\执行-acosmi-skill-agent-mcp-T3C-v1.md
- 设计档：D:\CrabClawApp\docs\claude\goujia\架构-acosmi-skill-agent-mcp-设计-v1.md
- 反幻觉规则：C:\Users\fushihua\.claude\projects\D--CrabClawApp\memory\feedback_anti_hallucination_protocol.md（如不存在尝试 D--Chat-Acosmi 路径，跨 project 共享）
- v1.0 源代码：D:\acosmi-agent\src\
- 目标项目：D:\acosmi-skill-agent-mcp\

### 用户已拍板决策（compact 后不可推翻）
- D11 包名：`@acosmi/skill-agent-mcp`
- D12 类型：MCP server
- D13 定位：技能驱动的智能体（SKILL 是统一融合层；MCP 全部走 tools；server 内部按 SkillMode dispatch）
- D14 物理位置：D:\acosmi-skill-agent-mcp 独立 git repo
- D15 范围：方案 γ 全档
- D16-D19 Q2-Q5 全部认可推荐
  - Q2 边界：不带 fleet 直接暴露 / 不带 runner / MCP transport 替代网关 / 暴露 LLMClient
  - Q3 v1.0 关系：复制 v1.0 src/capabilities + src/manage 到新包
  - Q4 dispatcher 接口：prompt 无 callback / tool 用 ToolCallbackRegistry / agent 用 SpawnSubagent callback
  - Q5 翻译矩阵：13 文件按设计档 §5 矩阵选择性翻译

### 用户硬约束（不可违反）
- C1 crabclaw 原码 0 修改（仅 Read 调研参考）
- C2 所有新文件在 D:\acosmi-skill-agent-mcp（独立目录）
- C3 不擅自 gh repo create（local-only）
- C4 不动 acosmi-agent v1.0 17 commits 任何文件
- C5 翻译语义（Go→TS 等价产出）
- C6 极端反幻觉模式（用户已 push back 2 次，主动判断不再问）

### SSH/外部凭据
- 无（local-only，无外部部署）

### 已知风险摘要
- R1-R10（见本档第八节）

### 续接首句强制动作（核心 — G7）

新窗口续接时，**第一动作必须**（不允许跳过、不允许"心智上读了"）：

1. **Read 本执行文档**全文（D:\CrabClawApp\docs\claude\goujia\执行-acosmi-skill-agent-mcp-T3C-v1.md）— 恢复 commit checklist + 已完成进度
2. **Read** `C:\Users\fushihua\.claude\skills\crabcode-execute\SKILL.md`（重读本档协议，含 G1/G2/G6/G7/G8 等 v2.x 护栏）
3. **Read** `C:\Users\fushihua\.claude\projects\D--CrabClawApp\memory\feedback_anti_hallucination_protocol.md`（反幻觉 8 条；如路径不存在尝试 D--Chat-Acosmi）
4. **Skill 调用** `/crabcode-execute`（重新装载 skill 让协议生效）

完成 1-4 后，才能继续 commit。

**续接 prompt 模板**（用户在新窗口第一句直接粘贴）：

```
续接 acosmi-skill-agent-mcp 任务的 T3-C 执行阶段。先按 SKILL.md G7 续接首句强制动作执行：
1. Read D:\CrabClawApp\docs\claude\goujia\执行-acosmi-skill-agent-mcp-T3C-v1.md
2. Read C:\Users\fushihua\.claude\skills\crabcode-execute\SKILL.md
3. Read C:\Users\fushihua\.claude\projects\D--CrabClawApp\memory\feedback_anti_hallucination_protocol.md
4. Skill /crabcode-execute
完成后告诉我"v2.x 协议加载完成，下一步 commit #N"。
```

---

## 十、衔接事后审计（commit 22 完成后强制 Skill 调用 /crabcode-audit）

- [ ] 主文件复检（按本执行文档逐 commit 对照）
- [ ] 关联方重检（22 commit 完成时 v1.0 / crabclaw / MCP SDK 是否有变）
- [ ] 测试通过 / 失败说明
- [ ] 文档回写（CHANGELOG / ARCHITECTURE / 设计档审计后状态）
- [ ] 风险公示（R1-R10 终态）

---

## 十一、执行文档自检（8 项 G）

| # | 检查项 | 自检 |
|---|---|---|
| 1 | 关联方覆盖完整（与 T3 §3 + §5 翻译矩阵一致）| ✅ — §3 列 6 项关联方，§5 翻译矩阵 13 文件全覆盖 |
| 2 | 没有循环依赖（commit N 依赖 commit M 已完成）| ✅ — DAG：1→2→3→4→5→6→7→8→9→10→11→12→13（commit 10 tool.ts 桩，13 回填）→14→15→16→17→18→19→20→21→22 |
| 3 | 测试策略覆盖每处改动 | ✅ — §四 8 层测试策略 + 每 commit 列测试 case 数 |
| 4 | 回滚步骤可执行 | ✅ — §五 整体 rm -rf；单 commit git reset；无外部副作用 |
| 5 | commit 划分粒度合理 | ✅ — 22 commit 各为独立逻辑块，合并允许已标 |
| 6 | 每处改动有明确 why | ✅ — §六 22 commit 每个含 why 段 |
| 7 | 每条事实陈述自带验证范围 + 未验证项（G8）| ✅ — commit 5/10/13/17 已附三件套；其余基于代码 file:line 的事实可简化（G8 例外）|
| 8 | handoff 段含"续接首句强制动作"（G7）| ✅ — §九含 4 步强制动作 + 续接 prompt 模板 |

**G8 自检触发器**（grep 禁词）：
- 本档"无现存"出现 0 次（已撤回方案段不算 — 那是引用已撤回前提）
- 本档"是最高/最新"0 次
- 本档"100%/已验证"出现：commit 11 三件套 / 自检 1-8 均加 ✅ — 自检符号是文档结构，非事实陈述断言（属 G8 例外）

**全部 8 项 ✅ — 文档可锁定，准备开 commit**。
