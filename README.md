# @acosmi/skill-agent-mcp

🇨🇳 中文文档（默认） · [🇬🇧 English README →](./README.en.md) · [GitHub](https://github.com/acosmi/skill-agent-mcp) · [Issues](https://github.com/acosmi/skill-agent-mcp/issues)

> **以 MCP 协议对外暴露"技能驱动智能体"能力——SKILL.md 作为工具、提示词片段、
> 子智能体三种异质能力的统一融合层。**

`@acosmi/skill-agent-mcp` 把 [`@acosmi/agent`](https://github.com/acosmi/agent)
的能力树子系统包装在
[Model Context Protocol](https://modelcontextprotocol.io) 服务器后面，
让外部 LLM 客户端（Claude Desktop / Code、Cursor 等）通过**单一统一的工具
表面**发现并调用 SKILL 驱动的能力。

SKILL.md 在内部被处理为**统一融合层**：工具、提示词片段、子智能体三种模式
（`prompt` / `tool` / `agent`）使用同一份模板规范，由服务端按 `skill_mode`
字段做内部分发。对外它们一律呈现为一个 MCP 工具，调用方不必关心当前调
的是哪一种。

---

## 为什么要做这个包

LLM 客户端目前主要有两种扩展能力的方式：

1. **MCP servers** — 协议规范完善，但每个工具都要在宿主语言里手写。
2. **In-prompt tool definitions** — 灵活，但 LLM 每次对话都要重新记住
   工具名和 schema。

`@acosmi/skill-agent-mcp` 把这两者收敛：**SKILL.md 文件本身就是工具定义**，
服务端一次加载即可。同一份 SKILL.md 模板可以表达：

- **提示词片段**：零代码，纯 markdown。
- **确定性工具流水线**：组合多步调用已注册工具，输入支持模板变量替换。
- **子智能体规格**：角色、工具白名单、token/时长预算，用于派生子 LLM 会话。

MCP 协议表面保持不变：每个 SKILL 在客户端看来仍然是**一个 MCP 工具**。

---

## 核心特性

- ✅ **三种模式，一个工具表面**：prompt / tool / agent 折叠为每个 SKILL 一个 MCP 工具。
- ✅ **权限单调衰减**：子智能体永远不能获得父智能体没有的工具。
- ✅ **Skill-to-Tool 编译器**：`tool_schema.steps[]` 编译为可调用的组合工具。
- ✅ **`{{var.path}}` 模板引擎**：纯变量引用保留原始类型；混合字符串通过 `String(value)` 插值。
- ✅ **两种 transport**：stdio（Claude Desktop / Code）+ Streamable HTTP（远程，SDK 推荐替代 SSE）。
- ✅ **自然语言 SKILL 创作**：`skill_suggest` + `skill_generate` 让调用 LLM 在已知良好模板上迭代。
- ✅ **workspace-root 防越界**：拒绝写入配置根目录之外，即便客户端给出含 `..` 的恶意 `tree_id`。
- ✅ **原子写 JSON 持久化**：组合工具存储跨重启保留（tmp + rename，权限 0o600）。
- ✅ **零内置工具**：框架完全 agnostic。通过 `ToolCallbackRegistry` 注册自己的工具（自带 `InMemoryToolCallbackRegistry`）。
- ✅ **TypeScript 优先**：`bun` 运行时，`bunx tsc --noEmit` 全绿，136 测试套件（约 200ms）。

---

## 三种 SkillMode 概念入门

| 模式 | MCP 工具返回 | 典型用途 |
|------|-------------|---------|
| `prompt` | SKILL 正文原样返回（可选地在前面加用户的 query）。 | 静态操作手册、参考文档、需要由调用 LLM 原样吸收的提示词片段。 |
| `tool` | 组合流水线每步结果的 markdown 表示。 | 确定性多步工作流，组合宿主已注册的工具（例如 "fetch → transform → write"）。 |
| `agent` | `[Agent Result] …` 块，含结构化 `ThoughtResult`。 | 长期运行的自治子智能体会话，有自己的角色 + 工具白名单 + token/时长预算。 |

可以在同一个 SKILL 库里混用三种模式 — dispatcher 会根据 `skill_mode`
+ `tool_schema` / `agent_config` 字段是否存在自动解析。每种模式的模板
都在 [`templates/`](./templates) 下。

### dispatcher 的判定规则

1. 读 SKILL 的 `skill_mode` 字段，存在则用它。
2. 否则若存在 `tool_schema` → 推断为 `tool`。
3. 否则 → 回退到 `prompt`。

校验会拒绝不匹配的组合（如 `skill_mode=agent` 但缺 `agent_config`，
或 `skill_mode=tool` 但同时含 `agent_config`）。

---

## 状态

**v1.0.0** — 首个发布版。当前阶段保持本地（`package.json#private: true`），
功能层面对已记录的 surface 已闭环。后续版本会加强 `mcp/` + `e2e/` 测试
覆盖度，并加入内置的基于磁盘扫描的 `SkillResolver`。

`v1.0.0` git tag 在 `main` 分支；发布说明见
[CHANGELOG.md](./CHANGELOG.md)。

---

## 安装（本地开发）

```bash
git clone https://github.com/acosmi/skill-agent-mcp.git
cd skill-agent-mcp
bun install
bun test          # 136 pass / 2 skip / 0 fail / ~200 ms
bunx tsc --noEmit # 0 errors
```

要求 Bun ≥ 1.3 + Node ≥ 20（用于 CLI shim）。

---

## 快速开始：stdio MCP 服务器

直接用项目自带的示例 SKILL 启动（不需要任何宿主代码）：

```bash
bun bin/acosmi-skill-agent-mcp \
  --transport stdio \
  --skills-dir ./examples/skills \
  --templates-dir ./templates \
  --state-dir ./.state
```

Claude Desktop / Code 用户可直接把
[`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json)
中的 `mcpServers` 段贴入自己的客户端配置（替换里面的绝对路径）。

---

## 快速开始：Streamable HTTP 服务器

```bash
bun bin/acosmi-skill-agent-mcp \
  --transport http \
  --port 3030 \
  --skills-dir ./examples/skills
# → [acosmi-skill-agent-mcp] streamable HTTP transport ready at http://127.0.0.1:3030/mcp
```

---

## 快速开始：嵌入式调用（程序内挂载）

```ts
import { CapabilityTree, setTreeBuilder } from "@acosmi/skill-agent-mcp/capabilities";
import { ComposedToolStore } from "@acosmi/skill-agent-mcp/codegen";
import { staticSkillResolver, type SkillResolverWithBody } from "@acosmi/skill-agent-mcp/tools";
import { InMemoryToolCallbackRegistry } from "@acosmi/skill-agent-mcp/dispatch";
import { createServer, createStdioTransport } from "@acosmi/skill-agent-mcp/mcp";
import { promises as fs } from "node:fs";

// 1. 能力树 — 此处为空；生产宿主会塞入真实节点。
const tree = new CapabilityTree();
setTreeBuilder(() => tree);

// 2. SKILL 解析器 — 生产宿主走磁盘扫描；demo 用 static helper。
const skillSources: Record<string, string> = {
  "tools/demo/hello": await fs.readFile("./skills/hello/SKILL.md", "utf-8"),
};
const skillResolver: SkillResolverWithBody = staticSkillResolver(skillSources);

// 3. 工具注册表 + 组合工具存储（仅 tool-mode SKILL 需要）
const toolRegistry = new InMemoryToolCallbackRegistry();
toolRegistry.register("echo", async (input) => String(input["text"] ?? ""));

const composedStore = new ComposedToolStore();

// 4. 构造 + 连接 MCP 服务器
const server = createServer({
  tree,
  skillsDir: "./skills",
  templatesDir: "./templates",
  stateDir: "./.state",
  skillResolver,
  toolRegistry,
  composedStore,
  // spawnSubagent: ...宿主提供的 LLM loop... (仅 agent-mode SKILL 需要)
});

await server.connect(createStdioTransport());
```

完整 demo 见 [`examples/`](./examples)。

---

## 注册的 MCP 工具

`createServer()` 最多注册 11 个 MCP 工具，每个都按对应可选依赖是否
存在做开关。极简宿主拿到的工具集很小；功能完整的宿主可以打开全部。

| 工具 | 功能 | 依赖门控 |
|------|------|---------|
| `capability_manage` | 查看 / 校验 / 诊断 / 补丁 能力树（13 actions 折单工具，通过 `payload` 传 JSON） | 始终注册 |
| `tree_lookup_tool` | 按工具名解析能力树节点 ID + 运行时归属 | 始终注册 |
| `tree_dump` | 把整棵能力树以 JSON 形式导出 | 始终注册 |
| `tree_list_tier` | 列出某意图层级（greeting / task_light / 等）下的全部工具节点 | 始终注册 |
| `tree_list_bindable` | 列出所有支持 SKILL.md 绑定的节点 | 始终注册 |
| `skill_suggest` | 根据自由描述推荐最合适的 SKILL.md 模板 | 始终注册 |
| `skill_generate` | 校验后保存客户端 LLM 起草的 SKILL.md 草稿 | 始终注册 |
| `skill_manage` | 列出 / 读取 / 更新 / 删除 / 导出 SKILL.md | 始终注册 |
| `skill_activate` | 通过 dispatcher 派发一个 SKILL，验证其运行时行为 | 需 `skillResolver` |
| `skill_parse` | 解析 SKILL.md frontmatter，可选执行 SkillMode 校验 | 始终注册 |
| `spawn_agent` | 派生 agent 模式的子智能体 | 需 `skillResolver` + `spawnSubagent` |

---

## 架构（高层）

```
外部 LLM 客户端（Claude Desktop / Code · Cursor · Continue.dev · ...）
              │
              │  MCP 协议（stdio 或 Streamable HTTP）
              ▼
   ┌─────────────────────────────────────────────┐
   │  @acosmi/skill-agent-mcp · createServer()   │
   │  ├─ 注册 11 个 MCP 工具                      │
   │  └─ 内部按 skill_mode 分发                   │
   └─────────────────────────────────────────────┘
              │
              ├─→ prompt 模式 → 原样返回 SKILL body
              │
              ├─→ tool 模式  → ComposedSubsystem.executeTool
              │                 → 解析 {{var.path}} 模板
              │                 → 调用 ToolCallbackRegistry.get(toolName)
              │
              └─→ agent 模式 → resolveSkillAgentCapabilities（单调衰减）
                              → DelegationContract.transitionStatus(active)
                              → SpawnSubagent（宿主提供 LLM loop）
                              → DelegationContract.transitionStatus(completed/failed)
```

完整子系统图 + 7 维 `CapabilityNode` 形态 + `DelegationContract` 状态机
见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## 子系统结构

| 模块 | 作用 |
|------|------|
| `@acosmi/skill-agent-mcp/capabilities` | `CapabilityTree`、7 维节点类型、`setTreeBuilder`、`defaultTree`。来自 `@acosmi/agent` v1.0 的逐字复制。 |
| `@acosmi/skill-agent-mcp/manage` | 13-action `executeManageTool` 元工具（来自 v1.0）。 |
| `@acosmi/skill-agent-mcp/llm` | `LLMClient` 接口 + Anthropic / OpenAI / Ollama 三个参考适配器。 |
| `@acosmi/skill-agent-mcp/skill` | 扩展版 `SkillAgentConfig`（含 7 个 v1.0 缺失的字段）+ 多源 SKILL.md 聚合 + 校验。 |
| `@acosmi/skill-agent-mcp/dispatch` | `prompt` / `tool` / `agent` 三模式服务端分发器 + `DelegationContract` + 权限单调衰减。 |
| `@acosmi/skill-agent-mcp/codegen` | SKILL → 组合工具的编译器 + 含 `{{var.path}}` 模板引擎的执行器。 |
| `@acosmi/skill-agent-mcp/tools` | `skill_suggest` / `skill_generate` / `skill_manage` / `skill_activate` 自然语言 SKILL 工具集。 |
| `@acosmi/skill-agent-mcp/mcp` | `createServer` 工厂 + stdio / Streamable HTTP transport。 |

---

## 文档

- [`docs/SKILL-TEMPLATE.md`](./docs/SKILL-TEMPLATE.md) — SKILL.md 完整字段语法（488 行规范）。
- [`templates/`](./templates) — 五份精简骨架（按 `skill_mode` + 意图划分）。
- [`examples/`](./examples) — 三个 demo SKILL + 参考回调实现 + Claude Desktop 配置示例。
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — 子系统边界 + 数据流。
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — 开发环境 + 提交规范。
- [`CHANGELOG.md`](./CHANGELOG.md) — 版本历史。

---

## 常见问题（FAQ）

### 为什么不把这些都放进 `@acosmi/agent`？

`@acosmi/agent` v1.0 是不假设任何协议的"能力库"。把 MCP SDK + zod 强加
给所有 v1.0 消费者会是退化。把 MCP 封装放在本包里，可以让 v1.0 保持
协议中立。

### 这能在 Claude / Anthropic 之外用吗？

可以。框架完全 provider-agnostic — `LLMClient` 自带 Anthropic / OpenAI /
Ollama 三个参考适配器，且任何 MCP 兼容客户端（Cursor、Continue.dev、
自建宿主）都可通过 stdio 或 HTTP 接入。

### 为什么 `private: true`？

v1.0 周期保持 local-only。删除 `private` + 注册 npm token 是 publish 前
唯一剩下的步骤。

### 怎么写第一个 SKILL？

1. 从 [`templates/`](./templates) 选一个起点 — 或对运行中的服务器调
   `skill_suggest`。
2. 改动 frontmatter（`tree_id`、`summary`、`skill_mode`、对应模式所需字段）。
3. 保存到 `<skillsDir>/<tree_id>/SKILL.md`。
4. 用 `skill_parse` MCP 工具加 `validate=true` 校验。

### 能不能在内置 11 个 MCP 工具旁边加自己的工具？

可以 — `createServer()` 返回底层 `McpServer` 实例；直接在它上面调
`.registerTool()` 添加即可。

### 子智能体的权限是怎么强制的？

`resolveSkillAgentCapabilities()` 强制实施**单调衰减**：子智能体的
工具集永远是父集的子集。`agent_config.allow` 列表会先与父工具集求交集
再加入 — 即便声明 `allow: [forbidden_tool]`，子智能体也不会获得这个
工具。

### tool-mode SKILL 某一步失败会怎么样？

由每步的 `on_error` 决定：`abort`（默认）立即返回；`skip` 记录错误并
继续下一步；`retry` 多重试 2 次后再放弃。

---

## 路线图

| 里程碑 | 状态 | 说明 |
|--------|------|------|
| **v1.0** — 首个发布 | ✅ 已发布 | 22 commits、11 MCP 工具、136 测试套件、完整 TS surface。 |
| **v1.1** — 内置磁盘扫描的 SkillResolver | ⏳ 计划中 | 替代 demo 的 `staticSkillResolver`，递归扫描 `--skills-dir`。 |
| **v1.2** — mcp / e2e 测试覆盖度 | ⏳ 计划中 | 加 `tests/mcp/` 和 `tests/e2e/`，覆盖 mock McpServer + 子进程往返。 |
| **v1.3** — npm publish | ⏳ 计划中 | 删除 `private: true`、用 `tsc` 生成 `dist/`、注册 npm token。 |
| **v2.0** — workspace 依赖 `@acosmi/agent` | ⏳ 计划中 | 等 `@acosmi/agent` 上 npm 后，把复制的 `capabilities/` + `manage/` + `llm/` 替换为单一 peer dep。 |

---

## 致谢

- [`@acosmi/agent`](https://github.com/acosmi/agent) — 本包包装的 v1.0
  能力库。
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
  — 我们集成的 MCP TypeScript SDK。
- crabclaw 项目（私有）— 本包翻译来源的原始 Go 实现。

---

## 许可证

Apache 2.0 — 详见 [LICENSE](./LICENSE)。
