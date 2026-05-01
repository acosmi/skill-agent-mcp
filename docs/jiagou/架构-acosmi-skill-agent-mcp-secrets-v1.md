# acosmi-skill-agent-mcp · secrets 子系统设计 v1

> 状态：T3 A 阶段调研规划档（设计）
> 创建：2026-05-01
> 上一档位：v1.1.0 已发布（双兼容架构 + HTTP transport 落档完成）
> 目标：在 `@acosmi/skill-agent-mcp` v1.2.0 引入 **secret-profile 子系统**，使 SKILL 可以引用上游 API 密钥但 **密钥本身永不进入 SKILL 文件 / varMap / 框架内存生命周期**

---

## 一、术语切割（防 execute 阶段语义漂移）

| 术语 | 真实语义 | 不代表的语义 |
|---|---|---|
| **secret profile** | 一条命名的"密钥从哪取"的元数据描述（如 `{type: "bearer", source: "env:OPENAI_API_KEY"}`），存在 `secret_profiles.json` | **不是密钥本身**；profile 文件公开也只暴露"我们用了哪些来源"，不暴露真实 key |
| **secret_profiles.json** | 宿主 stateDir 下的 user-private（0o600）JSON 索引文件，记录 profile name → source 描述 | 不存密钥值；不接收 raw key 写入 |
| **profile name** | SKILL frontmatter / step input 里出现的那个引用名（如 `openai_default`）| 不是 profile 的元数据；只是个 string handle |
| **SecretProvider** | 框架公开的接口，承担 "profile name → ResolvedAuth" 的一次解析 | 不持有密钥（每次 resolve 现取现用 + 即时 GC）|
| **SecretSource** | 单一密钥取值机制（env / file / 后续 keychain / vault），实现 `SecretSourceAdapter` 接口 | 不是 profile 本身；profile 只是声明用了哪个 source |
| **ResolvedAuth** | 已加工成可用形式的鉴权对象（如 `{kind: "bearer", headers: {Authorization: "Bearer ..."}}`），由具体 tool 拿去用 | 不直接暴露 raw token，已包装成 header 形态 |
| **secret_refs** | SKILL frontmatter 新增字段（`string[]`），声明该 SKILL 会引用哪些 profile name | 不放密钥；只放 name |
| **redact** | 输出脱敏 pass，对 `formatComposedResult` 字符串扫常见 token pattern 替换为 `***` | 不是加密；是字符串替换 |

---

## 二、决策依据（基于 v1.1.0 代码事实）

### 2.1 决策 1：`secret_refs` 强制声明 + 启动期校验

**事实链：**

- `src/dispatch/agent-capabilities.ts:44-81` 已有同款先例 — `agent_config.allow/deny` 是**声明式 + 监管不变量**（monotone-decay：sub-agent 永远拿不到 parent 没有的工具）
- `src/skill/validate.ts:38-139` 的所有规则都在创作期/更新期跑（`skill_generate / skill_manage update` 调用 `validateSkillMode`）
- "可选模式"等于把错误推迟到首次执行才暴露，跟项目"能在静态期拒就静态期拒"的风格不一致

**结论：** SKILL frontmatter 必须显式声明 `secret_refs: [openai_default, ...]`。校验有两层：
1. **静态层（启动 / save 时）**：`validateSkillMode` 校验 `secret_refs` 中每个 name 都在 `secret_profiles.json` 里
2. **运行层（resolve 时）**：`SecretProvider.resolveProfile(name)` 也校验 name 在已注册集合里（兜底，防 manage tool / store 外部直接改了 SKILL 文件）

### 2.2 决策 2：source 首发 `env + file`，留 `SecretSourceAdapter` 扩展点

**事实链：**

- `package.json` 当前 deps 仅 `@modelcontextprotocol/sdk + express + yaml + zod`，**零原生模块**
- 最近 commit `dbdb33a` 刚落地 Node + Bun **双 bin 兼容**；引入 native module（如 keytar）会破坏这一点
- `ARCHITECTURE.md` L122-131 明确"deliberately ships zero built-in tools" + "provider-agnostic"

**结论：**
- v1.2.0 首发：`EnvSecretSource`（读 `process.env`）+ `FileSecretSource`（读文件 + 校验 `stat.mode & 0o077 === 0`）
- 扩展点：`SecretSourceAdapter` 接口；外部 sibling 包（计划中的 `@acosmi/skill-secrets-keychain` / `@acosmi/skill-secrets-vault`）实现接口后通过 `DefaultSecretProvider` 的 `registerSourceAdapter(prefix, adapter)` 注册
- file 路径 mode 校验：rejects world/group readable（标准 K8s tmpfs secret mount 兼容）

### 2.3 决策 3：复用 `composed_tools.json` 持久化范式

`src/codegen/store.ts:175-203` 的 atomic write（tmp + rename，`mode: 0o600`） + 单一 `stateDir` 已经是项目内成熟范式。`secret_profiles.json` 直接抄。

---

## 三、子系统位置（subsystem map 增量）

```
┌──────────────────────────────────────────────────────────────┐
│                       MCP SDK (1.29)                         │
└──────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌──────────────────────────────────────────────────────────────┐
│                       src/mcp/                               │
│   createServer registers secret_profile_manage tool when     │
│   options.secretProvider is supplied (gating pattern)        │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     src/manage/                              │
│   secret-profile-manage.ts (5 actions: register / list /     │
│     remove / test / get) — 永远不收发原始密钥                │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     src/secrets/                  ← 新增     │
│   types.ts          : SecretProvider/Adapter/Profile 接口    │
│   store.ts          : SecretProfileStore (0o600 + atomic)    │
│   provider.ts       : DefaultSecretProvider                  │
│   sources/env.ts    : EnvSecretSource                        │
│   sources/file.ts   : FileSecretSource (mode 校验)           │
│   sources/index.ts  : DefaultSourceAdapterMap                │
│   redact.ts         : redactSecrets() — Bearer/Basic 脱敏    │
│   index.ts          : barrel export                          │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     src/codegen/executor.ts                  │
│   formatComposedResult 末尾追加 redact pass（双保险）        │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     src/skill/                               │
│   types.ts:    ExtendedSkillMetadata.secretRefs?: string[]   │
│   parse-extended.ts: 解析 secret_refs                        │
│   validate.ts: 加 missing_secret_profile / 字面 token 拒收   │
└──────────────────────────────────────────────────────────────┘
```

---

## 四、核心接口设计

### 4.1 `SecretProvider`（src/secrets/types.ts）

```ts
export interface SecretProvider {
  /** 解析 profile name 到可用的鉴权对象。失败时抛 SecretError。 */
  resolveProfile(name: string): Promise<ResolvedAuth>;

  /** 列出已注册的 profile name（不返回 source 细节，不返回密钥）。 */
  listProfileNames(): string[];

  /** 检查 name 是否在已注册集合（用于 SKILL 启动校验）。 */
  hasProfile(name: string): boolean;
}

export interface SecretSourceAdapter {
  /** Source URI 前缀（如 "env" / "file" / "keychain"）。 */
  readonly prefix: string;
  /**
   * 读取 source 后缀部分（如 "env:FOO" 中的 "FOO"），返回 raw secret 字符串。
   * 实现需保证不在错误 message 中泄露密钥本身。
   */
  read(suffix: string): Promise<string>;
}

export type ResolvedAuth =
  | { kind: "bearer"; headers: { Authorization: string } }
  | { kind: "basic"; headers: { Authorization: string } }
  | { kind: "raw"; value: string };  // 罕见场景兜底，不推荐

export interface SecretProfile {
  /** profile name，如 "openai_default"。 */
  name: string;
  /** 鉴权类型："bearer" / "basic" / "raw"。 */
  type: "bearer" | "basic" | "raw";
  /** Source URI："env:OPENAI_API_KEY" / "file:/run/secrets/openai" 等。 */
  source: string;
  /** 可选：basic 类型用，标识 username 部分（password 走 source）。 */
  username?: string;
  /** ISO 8601 注册时间戳。 */
  createdAt: string;
}

export interface SecretProfileStoreData {
  version: number;
  profiles: Record<string, SecretProfile>;
  updatedAt: string;
}

export const SECRET_PROFILE_STORE_VERSION = 1;
export const SECRET_PROFILES_FILENAME = "secret_profiles.json";

export interface SecretError extends Error {
  code:
    | "profile_not_found"
    | "source_unsupported"
    | "source_read_failed"
    | "file_mode_insecure"
    | "literal_secret_rejected";
}
```

### 4.2 SKILL frontmatter 扩展

新字段位置：`crabclaw / pi-ai / pi` 嵌套 manifest 节（与现有 `agent_config / tool_schema` 同级），或直接在 root frontmatter（向后兼容）。

```yaml
---
tree_id: tools/openai/chat
tools: [openai_chat]
secret_refs:
  - openai_default
skill_mode: tool
tool_schema:
  steps:
    - action: chat
      tool: http_request
      input_map:
        method: POST
        url: https://api.openai.com/v1/chat/completions
        auth_profile: openai_default       # ← 引用名，不是 key
        body: "{{ input.body }}"
---
```

**关键约束**：
- `secret_refs` 仅声明用了哪些 profile，不携带任何密钥值
- `auth_profile: openai_default` 的字段名（`auth_profile`）由具体 tool 自行约定，框架核心不规定
- 框架核心只校验"`secret_refs` 中的所有 name 都在 store 里"

### 4.3 `validateSkillMode` 新增校验

新增两类拒绝：

**T1：字面密钥拒收**（不依赖 profile 注册状态，纯静态扫描）

正则集合（命中即 `code: "literal_secret_rejected"`）：
```ts
const LITERAL_SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{20,}\b/,       // OpenAI / 通用 sk- 前缀
  /\bghp_[A-Za-z0-9]{20,}\b/,       // GitHub PAT
  /\bgho_[A-Za-z0-9]{20,}\b/,       // GitHub OAuth
  /\bxoxb-[A-Za-z0-9-]{20,}\b/,    // Slack bot
  /\bAKIA[0-9A-Z]{16}\b/,           // AWS Access Key ID
  /\bBearer\s+[A-Za-z0-9_\-\.=]{20,}/i,  // 已组装 Bearer
];
```

扫描位置：整个 frontmatter YAML 序列化后的字符串 + body 文本。命中拒收。

**T2：secret_refs 完整性校验**（需要 `SecretProvider` 已注入到 `validateSkillMode` 的可选第二参数）

```ts
validateSkillMode(meta, { secretProvider })
```
- 当 `secretProvider` 提供且 `meta.secretRefs` 非空时
- 对每个 name 调用 `secretProvider.hasProfile(name)`
- 缺失即返回 `code: "missing_secret_profile", field: "secret_refs[N]"`
- `secretProvider` 不提供时不跑此校验（向后兼容 — 不破坏既有调用方）

### 4.4 `secret_profile_manage` MCP tool（5 actions）

模仿 `src/manage/manage-tool.ts` 13-action 范式。**永远不接收 / 不返回原始密钥值**。

| action | 输入 | 输出 | 说明 |
|---|---|---|---|
| `register` | `name, type, source` (+ `username` for basic) | `{success, profile}` | 注册新 profile；`source` 字符串解析失败 / source 前缀不在 adapter map 内则拒；如果检测到 `source=literal:...` 直接拒（除非启动加 `--allow-literal-secret-source`）|
| `list` | — | `{profiles: [{name, type, source}]}` | 仅返回 name + type + source；不调 adapter，不暴露密钥 |
| `remove` | `name` | `{success, removed}` | 删除 profile；不影响实际密钥（密钥在 env / file 里）|
| `test` | `name` | `{success, kind, ok: true/false, error?: string}` | 调 `resolveProfile` 验证可达；返回鉴权 kind 但**不返回 headers / value**；只回 ok 标志 + 失败 message（脱敏后）|
| `get` | `name` | `{profile: {name, type, source}}` | 返回 profile 元数据，不调 adapter |

### 4.5 输出脱敏（`redactSecrets`）

应用点：`src/codegen/executor.ts` 的 `formatComposedResult` 在返回前最后一步。

策略：扫常见 token pattern → 替换为 `***`。**不是完美防泄漏**（上游 API 可能用别的格式回显），但能堵 90% 意外。

复用 §4.3 T1 的 `LITERAL_SECRET_PATTERNS`，加上：
```ts
/Authorization:\s*Bearer\s+\S+/gi
/Authorization:\s*Basic\s+\S+/gi
```

---

## 五、运行时数据流

### 5.1 启动期（host 初始化）

```
host bootstrap
  ├─ loadComposedToolStore(stateDir)            // 既有
  ├─ loadSecretProfileStore(stateDir)           // 新增
  ├─ const provider = new DefaultSecretProvider(store)
  ├─ provider.registerSourceAdapter(new EnvSecretSource())
  ├─ provider.registerSourceAdapter(new FileSecretSource())
  └─ createServer({ ..., secretProvider: provider })
       └─ registerSecretProfileManage(server, options) when options.secretProvider
```

### 5.2 SKILL 创作期（save 时）

```
skill_generate / skill_manage update
  └─ parseExtendedSkillFrontmatter(content)
  └─ validateSkillMode(meta, { secretProvider })   // 注入，做 T2 校验
       ├─ T1: literal_secret_rejected? → 拒
       ├─ T2: missing_secret_profile? → 拒
       └─ ok → save SKILL.md
```

### 5.3 运行期（tool-mode SKILL 触发）

```
MCP tool call
  └─ dispatchSkill → dispatchToolSkill
       └─ ComposedSubsystem.executeTool(name, inputJson)
            └─ for each step:
                 step.tool = "http_request"
                 step.inputMap → resolveInputMap(varMap)
                   stepInput = { method, url, auth_profile: "openai_default", body: ... }
                 stepInputJson = JSON.stringify(stepInput)
                 await executeToolFn("http_request", stepInputJson, signal)
                       ↓ host's http_request impl
                       ↓   const auth = await secretProvider.resolveProfile(input.auth_profile)
                       ↓   fetch(input.url, { headers: { ...auth.headers } })
                 result = ...
            └─ formatComposedResult([...]) → redactSecrets() → return text
```

**关键不变量**（按"是否默认强制"分两类）：

**架构层面强制（无需 host 配合，框架本身保证）：**
- ✅ 密钥**从未**进入 `varMap` — `resolveProfile` 在 host 工具实现内部跑，框架不接触 `ResolvedAuth`
- ✅ MCP tool 输出经 `redactSecrets` 兜底 — `formatComposedResult` 末尾自动跑
- ✅ POSIX 上 `FileSecretSource` **双层 mode 校验** — `lstat`（链接本身）+ `stat`（目标）都必须 600

**Opt-in 强制（需要 host 主动启用 — 见 §八 R1 风险公示）：**
- ⚠️ T1 字面密钥拒（防"密钥写进 SKILL 文件"）— 仅当 `validateSkillMode(meta, { source })` 二参签名调用时启用
- ⚠️ T2 `secret_refs` 完整性校验 — 仅当 `validateSkillMode(meta, { secretProvider })` 二参签名调用时启用

> v1.2.0 内置的 `skill_generate / skill_manage update / skill_parse` 路径 **不** 传 opts，因此 T1/T2 默认不跑。host 升级到 v1.2.0 时，如要兑现"密钥不进 SKILL 文件"的承诺，**必须**在自己的 SKILL save 调用前显式跑：
>
> ```ts
> const err = validateSkillMode(meta, { source: skillMdContent, secretProvider });
> ```
>
> 这是设计档明确公示的 deferred 工作（见 §八 R1 + 审计档 §九.1）— 不是 bug，是"接口先行 + 测试 + 文档先全套，host 透传留给下一个 minor"的有意决定。

---

## 六、扩展点（未来 sibling 包）

### 6.1 `@acosmi/skill-secrets-keychain`（构想）

```ts
import { KeychainSecretSource } from "@acosmi/skill-secrets-keychain";

provider.registerSourceAdapter(new KeychainSecretSource());

// 此后 source: "keychain:openai-prod" 路由到该 adapter
```

实现细节由该 sibling 包决定（可选 keytar / Win Credential Manager / macOS Keychain Services）。核心包不背原生依赖。

### 6.2 `@acosmi/skill-secrets-vault`（构想）

```ts
import { VaultSecretSource } from "@acosmi/skill-secrets-vault";

provider.registerSourceAdapter(new VaultSecretSource({ addr, token }));

// source: "vault:secret/data/openai" 路由到该 adapter
```

### 6.3 `@acosmi/skill-tools-stdlib`（前一轮已决定）

`http_request` / `cli_exec` / `sql_query` 等通用工具实现，注入 `SecretProvider` 句柄使用 profile-ref。

---

## 七、测试矩阵

| 层 | 文件 | 范围 |
|---|---|---|
| 单元 store | tests/secrets/store.test.ts | load / save / atomic / mode 0o600 / version 校验 |
| 单元 sources | tests/secrets/sources.test.ts | EnvSecretSource 读 process.env / FileSecretSource mode 校验 + reject world-readable |
| 单元 provider | tests/secrets/provider.test.ts | resolveProfile bearer/basic/raw / source 不存在抛 SecretError / adapter prefix 路由 |
| 单元 redact | tests/secrets/redact.test.ts | 常见 token pattern 替换 / 不影响普通文本 |
| 单元 manage tool | tests/manage/secret-profile-manage.test.ts | 5 actions 各 happy / error 路径 / literal-source 拒 |
| 集成 validate | tests/skill/skill.test.ts 扩展 | secret_refs missing → missing_secret_profile / 字面 sk- 拒 |
| 集成 executor | tests/codegen/codegen.test.ts 或新文件 | formatComposedResult 输出 Bearer 字面被 redact |

预期增量：~30 tests。

---

## 八、向后兼容性

| 改动 | 兼容性影响 |
|---|---|
| `ExtendedSkillMetadata.secretRefs?: string[]` | 新增可选字段，零影响 |
| `validateSkillMode(meta)` 加可选第二参数 | 单参签名仍可用，T2 校验仅在二参提供时跑，零影响 |
| `CreateServerOptions.secretProvider?` | 新增可选字段，零影响 |
| `secret_profile_manage` MCP tool | 新增工具，不影响既有工具 |
| `formatComposedResult` 加 redact pass | 输出可能少量字符变化（`Bearer xxx` → `Bearer ***`）；任何依赖 raw token 在 markdown 输出里的下游都是错误用法 |
| 新 stateDir 文件 `secret_profiles.json` | 不存在时正常启动（emit empty store），零影响既有 host |

**结论**：v1.2.0 全量向后兼容，可作为 minor release。

---

## 九、实施 phase（详见执行档）

| Phase | 内容 | 文件数 |
|---|---|---|
| P1 | 设计文档 + 执行文档（本档 + 下一档） | 2 docs |
| P2 | `src/secrets/types.ts` | 1 |
| P3 | `src/secrets/store.ts` | 1 |
| P4 | `src/secrets/sources/{env,file,index}.ts` | 3 |
| P5 | `src/secrets/{provider,redact,index}.ts` | 3 |
| P6 | SKILL frontmatter 扩展（types + parse + validate） | 3 修改 |
| P7 | `secret_profile_manage` + MCP server 注册 | 2 新 + 1 修改 |
| P8 | executor 脱敏 + 顶层导出 + package.json exports | 3 修改 |
| P9 | 测试覆盖 | ~6 文件 |
| P10 | 审计文档 + CHANGELOG + ARCHITECTURE.md | 1 + 2 修改 |
| P11 | 复核审计修复（FileSecretSource lstat / parseSourceUri 错误信息脱敏 / R1 锁定测试）| 3 修改 + 5 测试增量 |

预计 LOC：src ~700 + tests ~600 + docs ~600 = ~1900。

实测 LOC（落地后）：src ~1100 + tests ~900 + docs ~800 = ~2800（含 P11 复核修复）。

---

## 十、复核审计（P11 增量）

实施 P1-P10 完成后，由独立 code-reviewer 子代理对全套实施做复核审计，发现 3 个阻断项并已修：

| 编号 | 问题 | 修复 |
|---|---|---|
| 修-1 | `FileSecretSource.read` 用 `fs.stat`（follow symlink），符号链接本身权限未校验，对 K8s secret mount 之外的本地场景有轻度弱点 | 改为 `lstat + stat` 双层 mode 校验 — 链接本身 + 链接目标都必须 600（POSIX）。相关 commit 在 v1.2.0 发布前并入 |
| 修-2 | `parseSourceUri` 抛 `invalid_source_uri` 时错误信息 `JSON.stringify(uri)` 含完整 URI；如 host 误把字面密钥写进 `source` 字段，错误信息会回显 | 错误信息改为 `length=N` 形式，不 dump URI 内容；在 `tests/secrets/provider.test.ts` 加 negative test 验证 |
| 修-3 | `skill_generate / skill_manage update / skill_parse` 默认不跑 T1/T2 是 R1 公示的有意决定，但缺少"锁定行为的负面测试"，将来重构容易意外打破 | `tests/skill/skill.test.ts` 加两个 R1 lock-in 测试（标题包含 "documented R1 behaviour"），明示这是有意为之 |

修复后实测：**239 pass / 2 skip / 0 fail / 474 expect()**（增量 +5 测试，0 既有破坏）。
