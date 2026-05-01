# SKILL.md 编写标准

> Crab Claw 技能元数据规范。SKILL.md 的 frontmatter 是能力树的声明式数据源——
> 写错元数据 = 工具对用户不可见。本文件以 `frontmatter.go` / `capability_tree.go` 生产代码为准。

---

## 核心原则

1. **元数据驱动能力树** — SKILL.md frontmatter 通过 `InjectSkillNodes` + `InjectSkillKeywords` 注入能力树。字段缺失或错误会导致意图路由失配、工具不可见
2. **用户语言优先** — `description` 和 `intent_keywords` 用用户会说的话写，不用内部术语
3. **最低权限原则** — `min_tier` 选能正确触发的最低层级，不要默认 `task_multimodal`
4. **Description 即发现** — LLM 通过 description 决定是否使用工具，前 50 字决定匹配率

---

## 元数据全字段参考

### 数据流

```
SKILL.md frontmatter
  → ParseFrontmatter() → CrabClawSkillMetadata
    → buildSkillNodeData() → SkillNodeData
      → InjectSkillNodes() / InjectSkillKeywords()
        → CapabilityNode (能力树节点)
```

### 字段映射表

按注入目标分组。**加粗字段为本次审计发现的高频缺陷项**。

#### 路由层（决定工具是否对用户可见）

| YAML 字段 | 注入目标 | 类型 | 重要性 | 说明 |
|-----------|---------|------|--------|------|
| **`intent_keywords.zh`** | `Routing.IntentKeywords.ZH` | []string | **必填** | 中文意图关键词，意图路由的唯一数据源 |
| **`intent_keywords.en`** | `Routing.IntentKeywords.EN` | []string | **必填** | 英文意图关键词 |
| `intent_patterns` | `Routing.IntentKeywords.Patterns` | []string | 可选 | 含 `{var}` 占位符的模式，如 `"配置{platform}"` |
| **`min_tier`** | `Routing.MinTier` | string | **必填** | 最低意图层级门槛，设太高 = 工具被过滤 |
| **`intent_priority`** | `Routing.IntentPriority` | int | 推荐 | 多工具竞争时的优先级（0~30） |
| `exclude_from` | `Routing.ExcludeFrom` | []string | 可选 | 排除的意图层级 |

#### 权限层

| YAML 字段 | 注入目标 | 类型 | 说明 |
|-----------|---------|------|------|
| `approval_type` | `Perms.ApprovalType` | string | none / plan_confirm / exec_escalation / data_export |
| `security_level` | `Perms.MinSecurityLevel` | string | allowlist / sandboxed / full |
| `file_access` | `Perms.FileAccess` | string | none / global_read / read / scoped_read / scoped_write |
| `scope_check` | `Perms.ScopeCheck` | string | none / workspace / mount_required |
| `escalation_hints.*` | `Perms.EscalationHints.*` | object | 提权详情（仅 approval_type 非 none 时） |

#### 运行时层

| YAML 字段 | 注入目标 | 类型 | 说明 |
|-----------|---------|------|------|
| `enabled_when` | `Runtime.EnabledWhen` | string | 运行时可用条件表达式 |

#### 提示词层

| YAML 字段 | 注入目标 | 类型 | 说明 |
|-----------|---------|------|------|
| `summary` | `Prompt.Summary` | string | 英文一行摘要，注入系统提示词 |
| `sort_order` | `Prompt.SortOrder` | int | 提示词中的排序（越小越前） |
| `usage_guide` | `Prompt.UsageGuide` | string | 使用指南，注入提示词 |

#### 展示层

| YAML 字段 | 注入目标 | 类型 | 说明 |
|-----------|---------|------|------|
| `emoji` | `Display.Icon` | string | 单个 emoji，gen_frontend 转换为 icon |
| `title` | `Display.Title` | string | 前端显示名 |
| `verb` | `Display.Verb` | string | 动作动词 (Search/Send/Inspect) |
| `label` | `Display.Label` | string | 短标签 |
| `detail_keys` | `Display.DetailKeys` | string | 日志关键参数名，逗号分隔 |

#### 策略层

| YAML 字段 | 注入目标 | 类型 | 说明 |
|-----------|---------|------|------|
| `policy_groups` | `Policy.PolicyGroups` | []string | 策略分组 |
| `profiles` | `Policy.Profiles` | []string | 适用 profile: minimal/coding/messaging/full |
| `wizard_group` | `Policy.WizardGroup` | string | 向导分组 |

#### 仅文档层（不注入能力树）

| YAML 字段 | 类型 | 说明 |
|-----------|------|------|
| `name` | string | 技能名（必填，kebab-case，与目录名一致） |
| `description` | string | 技能描述（必填，≤120 字符） |
| `tools` | string | 绑定工具名（逗号分隔字符串，**禁止 YAML 列表**） |
| `category` | string | 目录分类: tools / operations / subsystems / meta / claude |
| `tree_id` | string | 能力树节点路径: `{group}/{tool_name}` |
| `tree_group` | string | 能力树分组名 |
| `related_tools` | []string | 关联工具（最多 5 个） |
| `scene_hint` | string | LLM 路由提示（最多 150 字节） |

---

## 模板

### 工具技能（完整模板）

```yaml
---
name: my-tool
description: "工具中文全名：能力1、能力2、能力3。当用户需要做X/Y/Z时触发此技能。"
tools: tool_name
metadata:
  # ---- 树定位 ----
  category: tools
  tree_id: "group/tool_name"
  tree_group: "group"
  emoji: "🔧"

  # ---- 路由（重中之重）----
  min_tier: "task_light"
  intent_keywords:
    zh: ["用户会说的话", "口语同义词", "核心动词", "场景关键词"]
    en: ["what user would say", "synonym", "core verb", "scenario keyword"]
  intent_priority: 10
  exclude_from: ["task_delete"]

  # ---- 权限 ----
  approval_type: "none"
  enabled_when: "always"
  security_level: "sandboxed"
  file_access: "none"
  scope_check: "none"

  # ---- 策略 ----
  policy_groups: ["group:system"]
  profiles: ["full"]
  sort_order: 10

  # ---- 提示词 ----
  summary: "English one-line summary of all capabilities"
  usage_guide: "用户场景化使用说明"

  # ---- 路由辅助 ----
  related_tools:
    - related_tool_1
  scene_hint: "用此工具做X→用那个工具做Y→不要用此工具做Z"

  # ---- 展示 ----
  title: "Display Name"
  verb: "Action"
  detail_keys: "key_param"
---

# 工具名 — 中文标题

## 工作流

1. 步骤一
2. 步骤二

## 常见陷阱

- 陷阱一
```

### 运维技能

```yaml
---
name: my-workflow
description: "E2E 工作流：从A到B到C的完整流程。"
tools: primary_tool, secondary_tool
metadata:
  category: operations
  emoji: "📋"
  tree_id: "group/primary_tool"
  tree_group: "group"
---
```

### 子系统技能

```yaml
---
name: my-subsystem
description: "子系统委托指南。复杂X任务委托子智能体，简单Y任务直接执行。"
tools: spawn_xxx_agent
metadata:
  category: subsystems
  tree_id: "subagents/spawn_xxx_agent"
  tree_group: "subagents"
  min_tier: "task_write"
  approval_type: "plan_confirm"
  emoji: "💻"
  intent_keywords:
    zh: ["委托", "子智能体", "复杂任务"]
    en: ["delegate", "sub-agent", "complex task"]
  intent_priority: 10
  scene_hint: "复杂任务委托→简单任务直接执行"
---
```

### 智能体技能（工厂生产用）

当 `spawn_agent(skill_name="xxx")` 被调用时，工厂通过 `SkillSourceResolver` 读取此技能的 `agent_config`，构建子智能体的系统提示词和委托合约。

```yaml
---
name: my-agent
description: "子智能体角色描述 — 一句话说明它能做什么"
metadata:
  category: agents
  skill_mode: agent                    # [必填] 标记为智能体技能
  tree_id: "subagents/spawn_xxx"       # [推荐] 如有对应的 spawn 工具
  tree_group: "subagents"
  emoji: "🤖"

  # ---- 智能体配置（工厂核心数据源）----
  agent_config:
    # -- 身份（注入系统提示词的 # Role / Goal / Backstory）--
    role_title: "角色名称"             # [必填] 注入: "# Role: {role_title}"
    role_goal: "角色目标"              # [推荐] 注入: "Goal: {role_goal}"
    role_backstory: "角色背景和行为准则"  # [推荐] 注入提示词正文

    # -- 运行时 --
    runtime_kind: skill                # [必填] skill(通用) / coder(编程) / media(媒体)
    inherit: minimal                   # full(继承父全部) / minimal(最小集) / none(空白)
    model: ""                          # 覆盖模型，空=继承父
    think_level: "medium"              # 思考深度: low / medium / high

    # -- 工具权限（白名单或黑名单，二选一）--
    allow:                             # 白名单模式：只允许列出的工具
      - read_file
      - write_file
      - bash
    # deny:                            # 黑名单模式：禁止列出的工具
    #   - spawn_media_agent

    # -- 安全约束 --
    no_network: false                  # 禁止网络访问
    no_spawn: true                     # 禁止派生子智能体
    sandbox_required: false            # 强制沙箱执行
    allowed_commands: []               # bash 命令白名单（空=不限制）
    max_bash_calls: 50                 # bash 调用上限

    # -- 资源预算 --
    max_tokens_per_session: 100000     # 单会话 token 上限
    max_concurrent: 3                  # 最大并行实例数

    # -- 记忆 --
    memory_scope: "session"            # session / persistent / shared
    memory_isolation: "session"        # 记忆隔离级别

    # -- 健壮性 --
    stall_threshold_ms: 180000         # 卡死检测阈值（毫秒）
    max_retry: 2                       # 最大重试次数
    escalation_chain:                  # 升级链
      - self                           # 先自行重试
      - parent                         # 再交给父智能体
      - human                          # 最终交给人类

    # -- 调度与频道（可选）--
    can_dispatch_to: []                # 允许派生的目标技能列表
    respond_to: []                     # 响应的频道类型
    listen_only: []                    # 仅监听的频道（不回复）
    max_sessions_per_day: 0            # 每日会话上限（0=不限）

    # -- 质量门禁（可选）--
    review_gate:
      enabled: false                   # 是否启用结果审查
      reviewer: "llm"                  # llm / rule / human
      max_rounds: 3                    # 最大审查轮次
      auto_approve_tiers:              # 自动通过的意图层级
        - task_light

    # -- 高级（按需）--
    # shared_read: []                  # 共享记忆读取路径
    # shared_write: []                 # 共享记忆写入路径
    # snapshot_rollback: false         # 启用快照回滚
    # composed_tools: []               # 组合工具绑定列表
    # triggers:                        # 自动触发（cron/event/message_match）
    # sop: []                          # 标准操作程序步骤
---

# 角色名 — 子智能体

## 能力

- 能力 1
- 能力 2

## 约束

- 约束 1
```

**agent_config 字段流向**:
```
SKILL.md agent_config
  → SkillAgentConfig (frontmatter.go)
    → ResolvedAgentSkill (spawn_blueprint_agent.go)
      → buildSkillAgentSystemPrompt():
          "# Role: {role_title}\nGoal: {role_goal}\n{role_backstory}\n---\n{SKILL.md body}"
      → ContractConstraints: no_network, no_spawn, sandbox_required, max_bash_calls, allowed_commands
      → ResourceBudget: max_tokens_per_session
```

**runtime_kind 路由**:

| 值 | 实际运行时 | 使用场景 |
|----|-----------|---------|
| `skill` | 通用 SkillAgent | 研究、数据分析、内容创作 |
| `coder` | OpenCoder (spawn_coder_agent) | 多文件编程、重构、调试 |
| `media` | MediaAgent (spawn_media_agent) | 热点发现、平台发布 |

**inherit 权限继承**:

| 值 | 含义 | 适用场景 |
|----|------|---------|
| `full` | 继承父智能体全部工具 | 信任子智能体（如 coder） |
| `minimal` | 仅基础读写工具 | 通用工人、外部集成 |
| `none` | 空白工具集，仅 allow 列出的 | 高安全要求 |

### 内部技能（无工具绑定）

```yaml
---
name: my-internal
description: "内部规范，仅供子智能体参考。"
metadata:
  category: claude
  emoji: "📄"
---
```

---

## 字段编写规则

### intent_keywords（意图路由的唯一数据源）

**黄金法则：用户会怎么说？**

不是你怎么命名工具，而是用户想用这个工具时嘴里说的话。

必须覆盖 5 类词：

| 类别 | 说明 | 示例 (cron) |
|------|------|-------------|
| 核心动词 | 工具的主要动作 | 定时, schedule |
| 口语同义词 | 日常用语 | 提醒, 闹钟, reminder, alarm |
| 场景触发词 | 触发场景的特征词 | 每天, 每小时, every hour |
| 工具原名 | 工具自身名称 | cron |
| 错误表述 | 用户可能的非标准说法 | 每隔, 定个闹钟 |

数量指引：zh 5~15 个, en 5~10 个。zh 偏口语, en 偏规范。

反模式：

| 错误 | 后果 | 正确做法 |
|------|------|---------|
| 不写 intent_keywords | 意图路由完全失配，工具不可见 | **必须写** |
| 只写技术术语 | 用户不会说 "CDP" 来找浏览器 | 加 "打开网站", "网页截图" |
| 只覆盖一种语义 | bash 只写"删除"→60%功能不可达 | 覆盖"运行/执行/安装/编译" |
| 关键词太泛 | "任务"会匹配太多工具 | 用"定时任务"限定范围 |
| 字段名写错 | `keywords:` 不被识别 | 必须用 `intent_keywords:` |
| zh/en 不对称 | en 只有 1 个词 | 至少 3~5 个英文词 |

### min_tier（意图层级门槛）

决策树：

```
只读操作？ → question        (agents_list, memory_search, search_skills)
轻量读取？ → task_light      (read_file, glob, browser, web_search, web_fetch)
写/发送？  → task_write      (write_file, cron, message, send_email, canvas)
删除操作？ → task_delete      (bash 删除场景)
需多模态？ → task_multimodal  (image 分析需图片输入)
```

**致命错误**：把 `task_multimodal` 当"高级操作"用。这会导致用户正常请求被门槛过滤（cron 设成 task_multimodal 导致"定时提醒"完全不可达）。

### description（LLM 发现的第一信号）

公式：
```
"{中文全名}：{全部核心能力顿号列举}。当{触发场景}时触发此技能。"
```

检查清单：
- [ ] 覆盖代码中**所有 action**？（不要只写一个）
- [ ] 用了**用户语言**？（不是内部术语）
- [ ] 包含**触发场景**？（"当...时触发"）
- [ ] ≤120 字符？

正例：
```yaml
description: "定时任务与提醒管理：创建定时提醒、周期执行、管理闹钟。当需要定时提醒、周期执行时触发。"
description: "图像处理：生成(AI画图)、编辑、分析、缩放、格式转换。当需要图片处理时触发。"
```

反例：
```yaml
description: "图像分析：使用已配置的视觉模型分析图片"     # 只写了 1/5 的能力
description: "UHMS 记忆搜索：按关键词语义检索长上下文"    # 用户不懂 UHMS
description: "Shell 命令执行：审批治理、白名单强制"        # 描述治理机制不是能力
```

### intent_priority（竞争优先级）

| 值 | 含义 | 用法 |
|----|------|------|
| 0 | 默认 | 不参与竞争 |
| 5 | 低 | 通用/回退工具 (gateway, list_dir) |
| 10 | 普通 | 大多数工具 |
| 20 | 高 | 专项工具，优先于通用 (browser, argus) |
| 30 | 最高 | 危险操作，精确匹配 (bash 删除) |

### scene_hint（路由辅助，≤150 字节）

格式：`"场景A用工具X→场景B用工具Y→不要用工具Z做场景C"`

```yaml
scene_hint: "定时提醒用cron.create→周期执行用cron表达式→手动触发用cron.run"
scene_hint: "发送文件用send_media→纯文字用message→邮件用send_email"
scene_hint: "原生桌面UI操作用argus，网页DOM操作用browser"
```

---

## 取值速查

### min_tier

| 值 | 代表意图 |
|----|---------|
| `greeting` | 问候 |
| `question` | 只读查询 |
| `task_light` | 轻量操作 |
| `task_write` | 写/创建/修改/发送 |
| `task_delete` | 删除 |
| `task_multimodal` | 需多模态输入 |

### approval_type

| 值 | 场景 |
|----|------|
| `none` | read_file, search, web_search |
| `plan_confirm` | write_file, cron, spawn_coder_agent |
| `exec_escalation` | bash, gateway, browser_config |
| `data_export` | send_media |

### enabled_when

| 值 | 含义 |
|----|------|
| `always` | 始终可用 |
| `BrowserController != nil` | 浏览器已配置 |
| `UHMSBridge != nil` | 记忆系统已初始化 |
| `MediaSender != nil` | 媒体发送已配置 |
| `GatewayOpts.Enabled()` | Gateway 已启用 |
| `DingTalkAPI != nil` | 钉钉已配置 |
| `WeComAPI != nil` | 企微已配置 |
| `PlatformLoginBridge != nil` | 平台登录已配置 |

---

## Checklist

### 创建新技能

- [ ] `name` 与目录名一致（kebab-case）
- [ ] `description` 覆盖工具全部能力，用用户语言
- [ ] `tools` 值与 `CapabilityNode.Name` 完全一致（逗号分隔字符串，**不是 YAML 列表**）
- [ ] `tree_id` 格式 `{group}/{tool_name}`
- [ ] `min_tier` 按决策树选择
- [ ] `intent_keywords` zh/en 均 ≥5 个，覆盖口语同义词
- [ ] `intent_priority` 已设定
- [ ] `scene_hint` 说明何时用/何时不用/用什么替代
- [ ] `summary` 英文一行摘要
- [ ] 热加载验证：`lookup_skill my-tool` 能返回内容

### 修改现有技能

- [ ] **先读代码**确认工具实际能力（不凭 SKILL.md 猜）
- [ ] `description` 是否还覆盖全部 action？
- [ ] `intent_keywords` 是否覆盖新增能力的用户表达？
- [ ] `min_tier` 是否还合理？
- [ ] YAML 语法正确（无悬空列表项、无字段名错误）
- [ ] `go test ./internal/agents/capabilities/...` 无回归
