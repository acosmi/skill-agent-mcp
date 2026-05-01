# acosmi-skill-agent-mcp 设计 v1

> 状态：T3 A 阶段调研规划档（v1，待用户拍板 Q1 范围 + Q2-Q5 设计决策后进 C 阶段）
> 创建：2026-05-01
> 上一档位：rootcause（事实清单完成 + 撤回 2 错误方向）
> 包名：`@acosmi/skill-agent-mcp`（npm scope，对称 v1.0 `@acosmi/agent`）
> 物理位置：D:\acosmi-skill-agent-mcp（新独立目录 / 独立 git repo / local-only）

---

## 一、术语切割（防 execute 阶段语义漂移 / G8 强制）

| 术语 | 真实语义 | 不代表的语义 |
|---|---|---|
| **acosmi-agent v1.0** | npm 包 `@acosmi/agent` v1.0.0，**已完工**（D:\acosmi-agent，17 commits）| 不是本次实施目标；本档**不修改 v1.0**任何文件 |
| **acosmi-skill-agent-mcp** | 本档目标 — 新建 npm 包 `@acosmi/skill-agent-mcp` + MCP server 实现 | 不是 acosmi-agent v1.1；是**独立** sibling 包 |
| **能力树（capability tree）** | crabclaw 7 维节点结构 + 派生管道；v1.0 已带 100% | 不是 SKILL.md 列表；不是 agent 蓝图 |
| **SKILL** | SKILL.md 文件（frontmatter 元数据 + Markdown body），**统一封装层**（异质能力的统一格式）| 不是某具体执行模式（prompt/tool/agent 是 SkillMode 字段值，不是"SKILL 类型"）|
| **SkillMode** | SKILL.md frontmatter 字段（`prompt`/`tool`/`agent` 三选一），决定 server 内部 dispatch 路径 | **不**对应 MCP 协议三类型（prompts/tools/resources）；**对外统一走 MCP tools** |
| **dispatcher** | acosmi-skill-agent-mcp **server 内部**根据 SkillMode 把 tool call 路由到 prompt/tool/agent 真正执行的代码 | 不是 MCP 协议层；不是 LLM runner main loop |
| **agent runtime** | 完整的 LLM 推理循环（接收 tool_use → 执行 → 喂回 → 循环到 stop）— crabclaw 在 attempt_runner.go 几千行 | acosmi-skill-agent-mcp **不**自带完整 agent runtime；agent 模式 SKILL 的 LLM 循环由 OSS 用户提供 LLMClient + 自实现，或不支持 |
| **"技能驱动智能体"** | SKILL.md 是**异质能力统一封装层** + 用户编写 SKILL.md → MCP server 暴露给外部 LLM 客户端调用 | 不是"crabclaw 4 蓝图工具"（已废）；不是"完整 agent runtime in MCP server" |

---

## 二、已撤回方案（试错痕迹存档 — 反幻觉 §1+§8 + M5 强制）

| 撤回方案 | 错在哪条事实 | 哪条用户消息触发 | 新方案如何避开 |
|---|---|---|---|
| **A. SKILL → MCP prompts/tools/agents 三类映射**（v0 假设：按 SkillMode 拆分到 MCP 协议三类型）| `frontmatter.go:97` 显示 SkillMode 是 server 内部 dispatch 信号（"prompt"/"tool"/"agent"），不是 MCP 协议表面的分类。SKILL **本身**就是统一封装层，对外**全部走 MCP tools**，server 内部按 SkillMode dispatch 才是正解 | 用户："你搞错了？能力树第一道关就是要绑定技能..."（强信号 — SKILL 是统一融合层）| 全部 SKILL → 同一形态 MCP tool；server 内部用 dispatcher pattern 按 SkillMode 路由到 prompt-handler / tool-step-executor / agent-spawner 三个实现 |
| **B. 抄 crabclaw 90 个 SKILL.md 作样本带过去**（v0 假设：把 crabclaw skills 复制为 OSS 框架内置）| crabclaw 93 SKILL.md 是 **crabclaw 项目本地运行时**实例（如 dingtalk/wecom/argus 这些 crabclaw 业务能力）；OSS 框架要的是**模板规范**让用户写自己的 SKILL.md | 用户："crabclaw的90 个 SKILL.md是本地在用的，你要看下内置的技能模板和自然语言按照技能模板生成技能"| 只翻译 `docs/skills/SKILL-TEMPLATE.md` 模板规范 + 写"自然语言→SKILL.md 生成"工具，让 OSS 用户写自己的 SKILL.md（acosmi-skill-agent-mcp 仓里仅放 examples/ 1-2 个 demo SKILL.md，不放业务 skill）|
| **C. 翻译 crabclaw 4 蓝图工具（agent_blueprint_suggest/generate/manage/activate）+ 8 内置 YAML 蓝图**（rootcause 阶段事实 C 假设它们仍在）| 子代理 A3 调研发现：4 工具 + 8 YAML 蓝图已被 **2026-04-23 根因修复整体清除**，统一并入 `spawn_blueprint_agent.go` 单工具聚合（387 LOC）+ 8 蓝图改为 SKILL.md 动态注册 | A3 子代理报告："旧蓝图 YAML 基础设施已完全清除，原因见 spawn_blueprint_agent.go L3-9 根因注释"| 不再翻译已废 4 工具；改为：(i) 翻译 spawn_blueprint_agent.go 单工具 + ResolveSkillAgentCapabilities (105 LOC) (ii) 写"自然语言→SKILL.md 生成"工具替代旧 suggest/generate 体验 |

**M5 重启论证**：
- 撤回 A → SKILL 是统一融合层，MCP 全部走 tools
- 撤回 B → 内置仅模板规范不带业务 SKILL
- 撤回 C → 跟随 crabclaw 现状（spawn_agent 单工具）+ 自然语言生成是新增不是翻译

---

## 三、调研结论（基于 rootcause + A1-A5 七项事实）

### 3.1 v1.0 现状边界（A2 索引 + rootcause 事实 G）

| 子模块 | LOC | acosmi-skill-agent-mcp 可复用程度 |
|---|---|---|
| `src/capabilities/` (5 文件 1406 LOC) | CapabilityTree 7 维 + SkillNodeProvider + 23 派生方法 | **直接 import 复用**（peerDep 或 npm depend）|
| `src/manage/` (6 文件 1873 LOC) | capability_manage 13 actions + parseSkillFrontmatter + TreePatch + gen-frontend | **直接 import 复用**；MCP server 包装 13 actions 为 13 tools |
| `src/llm/` (4 文件 782 LOC) | LLMClient interface + Anthropic/OpenAI/Ollama 3 adapter | **可选直接复用**；agent 模式 SKILL dispatcher 需要 LLMClient |
| `src/fleet/` (7 文件 2100 LOC) | AgentFleetManager + Budget + CircuitBreaker + StallDetector + DelegationContract | **可选**：MCP server 角色下不一定需要（fleet 管的是 host 进程内部 sub-agents；MCP server 没有这个语义除非自带 agent runtime）|
| `src/cli/` (1 文件 199 LOC) | offline 命令（skill parse / validate / manage）| **不复用**；acosmi-skill-agent-mcp 自有 CLI（MCP server entry）|

**关键事实**：v1.0 `package.json` 仅 `yaml@2.8.3` 一个 dep，**`exports` 字段尚未配置子路径导入**（仅 `.` 默认）。直接 `import { X } from "@acosmi/agent"` 当前会拿到全部 export（v1.0 `src/index.ts` 是 2 行 placeholder，需先在 v1.0 完善 export 才能精细复用）。

### 3.2 MCP TypeScript SDK 关键事实（A1 调研）

| 事实 | 来源 |
|---|---|
| 包名：`@modelcontextprotocol/sdk@^1.29.0`（**MIT**，与 Apache 2.0 兼容）| npm registry / mintlify build-server 文档 |
| 主入口：`@modelcontextprotocol/sdk/server/mcp.js` (`McpServer` 类)| 官方 server.md |
| Tool 注册：`server.registerTool(name, { description, inputSchema }, handler)` | 官方示例 |
| **inputSchema 用 Zod v3 shape 对象**（不是 `z.object()`，是裸 `{ field: z.X() }`）| build-server 文档明示 `zod@3` |
| Handler 返回：`{ content: [{ type: "text", text: "..." }], isError?: boolean }` | 官方示例 |
| Transport：`StdioServerTransport`（默认）+ `StreamableHTTPServerTransport`（远程推荐，已替代 deprecated SSE）| server-concepts 文档 |
| Resource / ResourceTemplate API 存在（`server.registerResource`）| 官方示例 |
| Prompt API 存在（`server.registerPrompt`）| 官方示例 |
| 错误模式：tool handler 内 `try/catch + { isError: true, content: [...] }`（让 LLM 自愈）| 官方示例 |
| 参考实现：`modelcontextprotocol/servers` monorepo（**Apache 2.0**，84.9k stars，monorepo `src/<server-name>/` 各独立 npm 发布）| GitHub README |

**最佳骨架样板**：clone `modelcontextprotocol/servers` 看 `src/everything/`（最完整三类能力示例）。

### 3.3 dispatcher 三模式真实复杂度（A4 + A5 主代理亲读）

| SkillMode | dispatcher 实现 | 关键依赖 | LOC 估算 |
|---|---|---|---|
| **prompt**（默认 — 91/93 SKILL.md）| `return SKILL.md body 作 MCP tool content text` | 无 | ~50 TS |
| **tool**（`tool_schema.steps[]`）| 翻译 crabclaw `composed/codegen.go (268 LOC) + executor.go (300 LOC)` — 包含 step 序列编译 + `{{var.path}}` 模板引擎 + loop_over + abort/skip/retry 错误策略 + step 引用 tool 校验（依赖 capability tree LookupTool）| **tool execution callback registry**（OSS 用户注入 step 引用的实际 tool function）| ~1000-1300 TS |
| **agent**（`agent_config`）| 翻译 crabclaw `spawn_blueprint_agent.go (387 LOC) + ResolveSkillAgentCapabilities (105 LOC)` — DelegationContract 创建 + permission monotone-decay 校验 + system prompt 构建 + spawn callback 触发 | **SpawnSubagent callback**（OSS 用户提供 LLM agent runner main loop — acosmi-skill-agent-mcp **不带**完整 runner）+ LLMClient | ~500 TS dispatcher framework；不带 runner |

**核心设计取舍**：
- prompt 模式 = 容易，无外部依赖
- tool 模式 = 中等，需 OSS 用户注入 tool callback registry（"step 1 调 bash" → bash 怎么实现是用户定义）
- agent 模式 = 困难，需 OSS 用户提供完整 LLM agent runner（"spawn coder agent" → coder 谁跑是用户定义）→ acosmi-skill-agent-mcp 提供 dispatcher framework + 留 SpawnSubagent callback 接口让用户实现

---

## 四、Q1 范围方案（≥1 推荐 + ≥1 反方向 + 排序）

### 方案 α — 最小档（仅 SKILL 解析 + 模板规范 + MCP 包装）

**内容**：
1. 复用 v1.0 `parseSkillFrontmatter` + `metadataToSkillNodeData` + `SkillNodeProvider` + capability tree
2. 移植 `docs/skills/SKILL-TEMPLATE.md` 到 acosmi-skill-agent-mcp `docs/SKILL-TEMPLATE.md`
3. MCP server 暴露：
   - capability_manage 13 actions → 13 MCP tools
   - SKILL.md parse / validate → 2 MCP tools
   - CapabilityTree query (lookup / walk) → ~3 MCP tools
4. dispatcher：**仅 prompt 模式**（return SKILL.md body）
5. examples/ 给 1-2 个 demo SKILL.md（纯文档驱动）

**LOC 估算**：~1500 TS（大部分 wrapping）
**工时**：2-3 天
**根因覆盖率**：**0.4**（部分 — 解决"管能力树"+"读 SKILL"，**不解决"技能驱动智能体"**）
**满足用户定位"技能驱动的智能体"**：❌ 不达 — 没 tool/agent 模式 dispatch
**适合**："只想用 acosmi-agent 在 Claude Desktop 里管能力树"的用户

### 方案 β — 中档（α + Skill-to-Tool Codegen）

**内容**：α 全部 + 翻译 `composed/codegen.go + executor.go + types.go + store.go` 全套（~870 Go LOC → ~1100 TS LOC）+ tool callback registry interface + dispatcher 支持 SkillMode=tool

**LOC 估算**：~2800 TS
**工时**：5-7 天
**根因覆盖率**：**0.7**（部分 — 解决"prompt + tool 模式"，**不解决"agent 模式 spawn"**）
**满足用户定位**：⚠ 半达 — 有 tool 模式（含 step 编排）但没 agent spawn
**适合**：用户用 acosmi-skill-agent-mcp 做"组合工具引擎 + MCP 暴露"，agent spawn 留给客户端

### 方案 γ — 全档（β + agent 模式 spawn dispatcher + 自然语言→SKILL.md 生成工具）⭐ **推荐**

**内容**：β 全部 +
1. 翻译 `spawn_blueprint_agent.go (387 LOC) + ResolveSkillAgentCapabilities (105 LOC)` → ~500 TS
2. dispatcher 支持 SkillMode=agent（接受 SpawnSubagent callback，OSS 用户实现真正的 LLM runner）
3. **新增**"自然语言→SKILL.md 生成"4 MCP tool 集（命名沿用 crabclaw 已废 4 工具的语义概念，但实现新写 — 因为 crabclaw 4 工具已被清理）：
   - `skill_suggest` — 按用户自然语言推荐内置模板（5 类）
   - `skill_generate` — LLM 生成 SKILL.md 内容 → 验证 → 持久化到磁盘
   - `skill_manage` — list/get/update/delete SKILL.md 文件
   - `skill_activate` — 派生子智能体测试新 SKILL（agent 模式）/ 直接调用（tool 模式）/ 读取（prompt 模式）
4. 内置 5 类模板放在 `templates/`（工具/运维/智能体/子系统/内部，对应 SKILL-TEMPLATE.md）
5. dispatcher 三模式全支持

**LOC 估算**：~4500 TS（含 4 工具 ~1000 + agent dispatcher ~500 + Codegen ~1100 + base wrapping ~1500 + tests ~400）
**工时**：10-14 天（2 周左右）
**根因覆盖率**：**1.0**（治本 — 三模式全覆盖 + 自然语言生成 + 内置模板，符合"技能驱动智能体"完整含义）
**满足用户定位**：✅ 完整达成
**适合**：用户用 acosmi-skill-agent-mcp 做"完整技能驱动智能体平台"的 MCP server

### 方案排序（根因覆盖率第一）

| 排名 | 方案 | 根因覆盖 | 工时 | 满足定位 | 推荐 |
|---|---|---|---|---|---|
| 1 | γ 全档 | 1.0 | 10-14d | ✅ | ⭐ **推荐** |
| 2 | β 中档 | 0.7 | 5-7d | ⚠ 半达 | 反方向 1 |
| 3 | α 最小档 | 0.4 | 2-3d | ❌ | 反方向 2 |

**推荐 γ 的理由**（不含"快/简单/改动小"）：
- 用户原文反复出现"技能驱动的智能体" + 包名三段 `skill-agent-mcp` → α/β 不达
- crabclaw 已实施完整闭环（spawn_blueprint_agent + Codegen + SKILL.md 体系），翻译路径清晰
- 工时 10-14 天 vs 之前 acosmi-agent v1.0 spin-off 17 commits 工时（用户已认可这个量级）
- 真正解决 v1.0 用户提的"框架只能看不能用"问题（agent 模式 spawn dispatcher 让 OSS 用户能写自己的 runner）

**反方向 1（β 中档）成立条件**：用户决定"agent 模式留给 v2"先发 v1，专注 prompt + tool 模式
**反方向 2（α 最小档）成立条件**：用户只想要"MCP 暴露能力树管理工具"，agent 不在范围

---

## 五、Q2-Q5 设计决策（基于事实推荐 + 用户裁决）

### Q2. MCP server 边界 — 是否带 fleet 治理 / runner / 网关 / 心跳 / cron

| 子系统 | 推荐 | 理由 |
|---|---|---|
| Fleet 治理（manager + budget + circuit + stall + persistence + delegation_contract）| **不直接暴露 MCP，但保留代码可调用** | MCP server 角色下没"内部 sub-agents"概念；但 SpawnSubagent callback 用户实现里可以用 fleet 治理（dependency injection 留口）|
| LLM runner main loop | **不带**（C5 翻译边界） | runner 是 host 进程业务逻辑；MCP server 让 client 当 runner（agent 模式 SKILL 通过 SpawnSubagent callback 让用户写）|
| 网关 / 传输层 | **MCP transport 替代**（stdio + 可选 HTTP）| 不需要自写 HTTP/WS server |
| 心跳 | **本地 StallDetector 即可，不带远程协议** | OSS 用户如有跨实例需要自己加 |
| cron / 定时任务 | **不带** | 由 OSS 用户外部 schedule（systemd timer / cron / node-cron） |
| LLMClient interface | **暴露**（v1.0 已带）+ 加 examples 演示 | agent 模式 SKILL 需要它 |

### Q3. 与 acosmi-agent v1.0 的依赖关系

| 选项 | 评估 | 推荐 |
|---|---|---|
| (a) `npm depend on @acosmi/agent` | v1.0 `private:true` 阻止 publish；且 `exports` 未配子路径，import 粒度差 | **当前阻塞**，需先 v1.0 配 exports |
| (b) **复制 v1.0 的 src/capabilities + src/manage 到 acosmi-skill-agent-mcp**（v1.0 仍独立）| 翻译语义符合 C5；包独立无依赖循环；维护成本 = 双源 drift（用户决策 R6 已识别）| ⭐ **推荐**（pragmatic） |
| (c) monorepo 合并 | 重大架构变更，违反 D14（独立 git repo） | ❌ 不要 |

**推荐 b 路径细节**：
- 复制 v1.0 `src/capabilities/` (1406 LOC) + `src/manage/` (1873 LOC) 到 acosmi-skill-agent-mcp 的对应目录
- LICENSE 头保留 Apache 2.0
- CHANGELOG 写明"v1.0 基线 + spin-off 增量"
- 长期治理：(i) 用户决策何时合并 v1.0 + skill-agent-mcp 为 monorepo (ii) 或 v1.0 加 exports 后 skill-agent-mcp 切到 a 路径

### Q4. dispatcher 执行体落地（每个 SkillMode 的 callback 接口）

| SkillMode | callback 接口设计 |
|---|---|
| **prompt** | 无 callback（server 内部直接 return SKILL.md body）|
| **tool** | `interface ToolCallbackRegistry { register(name, fn): void; lookup(name): ToolFn \| undefined; }` — OSS 用户在 server 启动时 register("bash", bashImpl) / register("read_file", readFileImpl) 等。Codegen 编译 step 时校验 step.tool 已 register |
| **agent** | `interface SpawnSubagent { (params: SpawnSubagentParams): Promise<SubagentRunOutcome>; }` — OSS 用户实现真正的 LLM agent runner（用 LLMClient 自己跑）|

### Q5. crabclaw → acosmi-skill-agent-mcp 选择性翻译矩阵

| crabclaw 文件 | LOC | 翻译 | acosmi-skill-agent-mcp 对应位置 |
|---|---|---|---|
| `docs/skills/SKILL-TEMPLATE.md` | 489L | ✅ 完整移植 | `docs/SKILL-TEMPLATE.md` |
| `backend/internal/agents/skills/frontmatter.go` | 1137L | ✅ 选取 SkillAgentConfig + 已被 v1.0 部分翻译的剩余字段 | `src/skill/types.ts` + `src/skill/frontmatter.ts`（增量到 v1.0 已带的）|
| `backend/internal/agents/runner/spawn_blueprint_agent.go` | 387L | ✅ 全译 | `src/dispatch/spawn-agent.ts` |
| `backend/internal/agents/runner/skill_agent_capabilities.go` | 105L | ✅ 全译 | `src/dispatch/agent-capabilities.ts` |
| `backend/internal/agents/composed/codegen.go` | 268L | ✅ 全译 | `src/codegen/codegen.ts` |
| `backend/internal/agents/composed/executor.go` | 300L | ✅ 全译 | `src/codegen/executor.ts` |
| `backend/internal/agents/composed/types.go` + `store.go` | ~300L | ✅ 全译 | `src/codegen/types.ts` + `src/codegen/store.ts` |
| `backend/internal/agents/skills/skill_node_provider.go` | 380L | ⚠ 已被 v1.0 部分翻译；增量补全多源聚合（bundled/user/managed/extra/workspace 5 源 + canonicalRank）| `src/skill/node-provider.ts` |
| `backend/internal/agents/runner/blueprint_*.go` 4 文件 | 历史已删 | ❌ 不译 | 改为新写 4 工具 `src/tools/skill-{suggest,generate,manage,activate}.ts` |
| `backend/internal/agents/skills/workspace_skills.go` | 819L | ❌ 不译（crabclaw 业务复杂度，OSS 简化版用户自己加）| 仅提供 minimal SKILL.md loader interface |
| `backend/internal/agents/runner/attempt_runner.go` | 几千行 | ❌ 不译（runner main loop 是 host 业务） | OSS 用户提供 SpawnSubagent callback 实现 |
| `backend/internal/agents/skills/skill_store_sync.go` | 376L | ❌ 不译 | OSS 用户自带 |
| `backend/internal/agents/runner/intent_router.go` | 巨大 | ❌ 不译（意图路由是 host 业务）| OSS 用户自带 |

---

## 六、目标项目结构（方案 γ — 推荐）

```
D:\acosmi-skill-agent-mcp\
├── package.json                  # @acosmi/skill-agent-mcp v1.0.0 / private:true（v1.0 同样策略）
├── tsconfig.json
├── README.md / ARCHITECTURE.md / CONTRIBUTING.md / CHANGELOG.md / LICENSE (Apache 2.0)
├── docs/
│   └── SKILL-TEMPLATE.md         # 移植自 crabclaw docs/skills/SKILL-TEMPLATE.md
├── bin/
│   └── acosmi-skill-agent-mcp    # MCP server entry (#!/usr/bin/env bun)
├── src/
│   ├── capabilities/             # 复制自 acosmi-agent v1.0 (1406 LOC)
│   ├── manage/                   # 复制自 acosmi-agent v1.0 (1873 LOC)
│   ├── llm/                      # 复制自 acosmi-agent v1.0 (782 LOC) — agent 模式 SKILL 需要
│   ├── skill/                    # 新写
│   │   ├── types.ts              # SkillAgentConfig 完整 30+ 字段
│   │   ├── frontmatter.ts        # 增量 v1.0 已有的 parser
│   │   ├── node-provider.ts      # 多源聚合 5 源 + canonicalRank
│   │   └── index.ts
│   ├── dispatch/                 # 新写 — 三模式 dispatcher
│   │   ├── prompt.ts             # SkillMode=prompt → return body
│   │   ├── tool.ts               # SkillMode=tool → 调 codegen executor
│   │   ├── agent.ts              # SkillMode=agent → spawn-agent dispatcher (翻译 spawn_blueprint_agent.go)
│   │   ├── agent-capabilities.ts # 翻译 ResolveSkillAgentCapabilities
│   │   ├── delegation-contract.ts # 翻译 DelegationContract（v1.0 已部分带）
│   │   └── index.ts
│   ├── codegen/                  # 翻译 crabclaw composed/ 包
│   │   ├── types.ts
│   │   ├── codegen.ts            # 翻译 codegen.go
│   │   ├── executor.ts           # 翻译 executor.go (含 {{var}} 模板引擎)
│   │   ├── store.ts              # 翻译 store.go
│   │   └── index.ts
│   ├── tools/                    # 新写 — 自然语言→SKILL 生成 4 MCP tools
│   │   ├── skill-suggest.ts
│   │   ├── skill-generate.ts
│   │   ├── skill-manage.ts
│   │   ├── skill-activate.ts
│   │   └── index.ts
│   ├── mcp/                      # 新写 — MCP server 主入口
│   │   ├── server.ts             # @modelcontextprotocol/sdk McpServer 配置 + tool 注册
│   │   ├── transport.ts          # stdio + Streamable HTTP 选择
│   │   └── index.ts
│   ├── cli/                      # MCP server entry
│   │   └── main.ts
│   └── index.ts
├── templates/                    # 内置 5 类 SKILL.md 模板
│   ├── tool.md
│   ├── operations.md
│   ├── agent.md
│   ├── subsystem.md
│   └── internal.md
├── examples/
│   ├── claude-desktop-config.json
│   ├── skills/
│   │   ├── hello-prompt/SKILL.md  # SkillMode=prompt demo
│   │   ├── hello-tool/SKILL.md    # SkillMode=tool demo (含 tool_schema.steps)
│   │   └── hello-agent/SKILL.md   # SkillMode=agent demo (含 agent_config)
│   └── README.md
└── tests/
    ├── skill/*.test.ts
    ├── dispatch/*.test.ts
    ├── codegen/*.test.ts
    ├── tools/*.test.ts
    └── mcp/*.test.ts
```

**估算**：30+ 文件 / ~4500 TS LOC / ~1500 test LOC

---

## 七、工作量分解（方案 γ — 拟 17-22 commits 与 v1.0 量级对齐）

| Commit | 内容 | LOC 估算 | 累计天 |
|---|---|---|---|
| 1 | bootstrap：package.json + tsconfig + README skeleton + LICENSE + bin entry | 100 | 0.5 |
| 2 | 复制 v1.0 `src/capabilities/` + 调整 imports | 1406 | 1.0 |
| 3 | 复制 v1.0 `src/manage/` + 调整 imports | 1873 | 1.5 |
| 4 | 复制 v1.0 `src/llm/` + 调整 imports | 782 | 2.0 |
| 5 | `src/skill/types.ts` — SkillAgentConfig 30+ 字段 | 350 | 2.5 |
| 6 | `src/skill/node-provider.ts` — 多源聚合 5 源 + canonicalRank | 400 | 3.0 |
| 7 | `src/dispatch/agent-capabilities.ts` — ResolveSkillAgentCapabilities | 130 | 3.5 |
| 8 | `src/dispatch/delegation-contract.ts` — 增量 v1.0 已有 | 200 | 4.0 |
| 9 | `src/dispatch/agent.ts` — spawn-agent dispatcher (翻译 spawn_blueprint_agent.go) | 500 | 5.0 |
| 10 | `src/dispatch/prompt.ts` + `src/dispatch/tool.ts` + dispatch index | 200 | 5.5 |
| 11 | `src/codegen/types.ts + store.ts` — Codegen 数据结构 | 350 | 6.5 |
| 12 | `src/codegen/codegen.ts` — Skill-to-Tool 编译器 | 350 | 7.5 |
| 13 | `src/codegen/executor.ts` — step executor + 模板引擎 + loop | 400 | 8.5 |
| 14 | `templates/` — 5 类内置 SKILL.md 模板 | 100 | 9.0 |
| 15 | `src/tools/skill-suggest.ts + skill-generate.ts` — 自然语言生成 2 工具 | 500 | 10.0 |
| 16 | `src/tools/skill-manage.ts + skill-activate.ts` — 管理与激活 2 工具 | 400 | 11.0 |
| 17 | `src/mcp/server.ts` — McpServer 配置 + 全部 tool 注册（13 capability_manage + 4 skill-* + ~5 tree query + ~2 SKILL parse/validate）| 500 | 12.0 |
| 18 | `src/mcp/transport.ts` + `src/cli/main.ts` + bin | 200 | 12.5 |
| 19 | `examples/` — claude-desktop-config + 3 demo SKILL.md | 200 | 13.0 |
| 20 | `tests/` — capabilities/manage 复用 v1.0 + 新增 dispatch/codegen/tools/mcp 4 套 ~80 tests | 1500 | 13.5-14 |
| 21 | docs：README + ARCHITECTURE + CONTRIBUTING + CHANGELOG | 600 | 14 |
| 22 | v1.0 release prep：bun pm pack 验证 | 50 | 14 |

**总计**：~4500 src LOC + ~1500 test LOC + ~600 docs；**预估 14 天工时**（与 v1.0 spin-off 17 commits 量级对齐 — 用户已认可）

实际可能合并为 ~17-19 commits（按 SKILL 总则 7 同一逻辑块边界判断）。

---

## 八、风险公示

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | v1.0 `src/capabilities` + `src/manage` 复制到 skill-agent-mcp → 双源 drift | 中 | (i) CHANGELOG 显式记录基线版本 (ii) 长期治理 = 用户决策 v1.0 加 exports 切回 a 路径 / 或合并 monorepo |
| R2 | 自然语言→SKILL.md 生成质量取决于 client 端 LLM 能力（Claude Desktop / Cursor 调 skill_generate 时它的 LLM 输出质量）| 中 | 提供详细 inputSchema description + 失败时返回结构化错误让 LLM 自动修正（沿用 crabclaw blueprint_generate 已废但有效的模式）|
| R3 | agent 模式 SKILL 在 acosmi-skill-agent-mcp 自身 server 内**不可直接执行** — 需 OSS 用户提供 SpawnSubagent callback | 中 | (i) 文档明示这一边界 (ii) examples/ 提供 `examples/agent-runner-impl.ts` 演示用 LLMClient + 简易循环实现 SpawnSubagent (iii) skill_activate 工具检测 callback 未注入时 return 友好错误 |
| R4 | tool 模式 SKILL 同理 — step 引用的 tool（bash/read_file 等）需 OSS 用户在 ToolCallbackRegistry 注册 | 中 | examples/ 提供 minimal tool registry impl |
| R5 | MCP SDK Zod v3 + v1.0 无 Zod 依赖 → 新增 dep | 低 | Zod 是 MIT，acosmi-skill-agent-mcp 加 dep 不影响 v1.0 |
| R6 | crabclaw spawn_blueprint_agent.go 依赖 `params.SpawnSubagent` + `InterAgentBus` + `params.DelegationContract` 等 ToolExecParams 链路 — TS 翻译需新建对等 SpawnContext type | 低 | 直接平铺为 TS interface，不带 crabclaw runner 业务复杂度 |
| R7 | Claude Code (CLI) 的 MCP 配置方式 vs Claude Desktop 略有不同 | 低 | 文档明示：测试以 Claude Desktop 为主，Claude Code/Cursor 用户参考各自文档 |
| R8 | 翻译过程引入 deliberate divergence — TS event loop 单线程 vs Go goroutines | 低 | 沿用 v1.0 spin-off 决定（每个 deliberate divergence 在 commit msg 记录）|
| R9 | composed/codegen 用户体验：编译失败信息友好度 | 低 | 翻译 crabclaw `formatValidationErrors` 风格（详细错误 + 可用 tool 列表 + 可用模型列表）|
| R10 | C2 硬约束（不擅自 gh repo create）→ local-only，用户后续决策何时 publish | 低 | private:true 保留；CHANGELOG 写明 "remove `private` 是 publish 的唯一前置" |

---

## 九、未做（诚实汇报）

- ❌ 未读 crabclaw `composed/types.go` + `store.go` 实际 LOC（估算 ~300）— execute 阶段需先 Read 确认
- ❌ 未确认 v1.0 `DelegationContract` 是否已带"Inherit/Allow/Deny 解析"（rootcause 报告 G 仅说"已带 DelegationContract"）— execute 阶段需查 v1.0 src/fleet/delegation-contract.ts 确认增量边界
- ❌ 未尝试 `bun add @modelcontextprotocol/sdk` 验证依赖兼容性 — execute 阶段 commit 1 启动时验证
- ❌ Claude Code (CLI) 与 MCP server 集成方式未确认 — A1 子代理报告说"未找到合规公开资料"，文档主张以 Claude Desktop 为参考
- ❌ "自然语言→SKILL.md 生成"4 工具的具体 inputSchema 未设计（execute 阶段 commit 15-16 时设计）
- ❌ 性能基准未估算（v1.0 测试 146 pass / 290 expect / 225ms，本档预期类似量级）

---

## 十、待用户拍板（Q1 + Q2-Q5）

**Q1 范围**（必拍板）：α / β / γ ⭐ 推荐 — 三选一

**Q2-Q5 设计决策**（推荐已给，您认可即可）：
- Q2 边界：本档推荐"不带 fleet 直接暴露 / 不带 runner / MCP transport 替代网关 / 本地 stall / 不带 cron / 暴露 LLMClient"
- Q3 v1.0 关系：本档推荐 "(b) 复制 v1.0 src/capabilities + src/manage 到 acosmi-skill-agent-mcp（v1.0 仍独立）"
- Q4 dispatcher 接口：prompt 无 callback / tool 用 ToolCallbackRegistry / agent 用 SpawnSubagent callback
- Q5 翻译矩阵：crabclaw 13 文件按§5 矩阵选择性翻译

**用户拍板后路径**：
- 选 γ + 认可 Q2-Q5 推荐 → 直接进 C 阶段（Skill 调 `/crabcode-execute` 写执行文档 + 增量 commit）
- 选 α/β → 缩减执行档范围（仍走 C 阶段）
- 对 Q2-Q5 任一推荐有异议 → 局部回 A 阶段调整本设计档为 v2

---

## 十一、T3 A 阶段自检（7 项）

| # | 项 | 自检 |
|---|---|---|
| 1 | 根因一句话讲清 | ✅ "v1.0 是能力库不是 agent runtime；用户要把'能跑'+'技能驱动智能体'补上，通过 MCP server 形态让外部 LLM 客户端消费" |
| 2 | 调研已按性质分级（项目内代码扫描 + MCP SDK 通用工程问题外部对照）| ✅ A1 外部 / A2-A5 内部 |
| 3 | 推荐 + ≥1 反方向已列；推荐理由不含"快/简单/改动小"| ✅ γ 推荐 + α/β 作反方向；理由 = 根因覆盖率 + 满足定位 + 工时与 v1.0 量级对齐 |
| 4 | 用户已被告知或询问 | 即将报告 |
| 5 | 已通过 crabcode-execute 完成执行文档 + 增量 commit | ⏳ 待用户拍板后 |
| 6 | 已通过 crabcode-audit 完成事后审计 | ⏳ 待 execute 完成后 |
| 7 | 风险已公示 | ✅ R1-R10 |
