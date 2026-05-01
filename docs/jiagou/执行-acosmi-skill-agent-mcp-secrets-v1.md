# 执行-acosmi-skill-agent-mcp-secrets-v1

> 上一档：架构-acosmi-skill-agent-mcp-secrets-v1.md（设计 v1）
> 用户拍板：决策 1 强制声明 + 启动校验；决策 2 首发 env+file，扩展点留 SecretSourceAdapter
> 创建：2026-05-01
> 目标：在 v1.1.0 基础上引入 secret-profile 子系统（v1.2.0 minor release）

---

## 一、术语切割（继承设计档 §一）

见设计档 §一。

---

## 二、关联方完整列表

**外部输入（只读，不修改）**：
- `src/codegen/store.ts:107-203` — atomic write + 0o600 + load/save 范式（抄）
- `src/manage/manage-tool.ts:50-148` — 13-action 范式（抄成 5-action）
- `src/manage/skill-frontmatter.ts:215-358` — `resolveCrabClawMetadata` 解析范式
- `src/skill/validate.ts:38-139` — `validateSkillMode` 结构性校验范式
- `src/skill/parse-extended.ts` — 嵌套字段解析范式
- `src/codegen/executor.ts:369-391` — `formatComposedResult` 注入点
- `src/mcp/server.ts:86-102` — `createServer` + `register*` gating 范式
- `src/index.ts` + `package.json` exports — 公共表面扩展

**新建（输出）**：
- `src/secrets/{types,store,provider,redact,index}.ts` (5)
- `src/secrets/sources/{env,file,index}.ts` (3)
- `src/manage/secret-profile-manage.ts` (1)
- `tests/secrets/{store,sources,provider,redact}.test.ts` (4)
- `tests/manage/secret-profile-manage.test.ts` (1)
- `docs/jiagou/审计-acosmi-skill-agent-mcp-secrets-v1.md` (1)

**修改（增量）**：
- `src/skill/types.ts` — `ExtendedSkillMetadata.secretRefs?: string[]`
- `src/manage/skill-frontmatter.ts` — `CrabClawSkillMetadata.secretRefs` + parse
- `src/skill/parse-extended.ts` — 把 secret_refs 提到 ExtendedSkillMetadata（如已在 base 即透传）
- `src/skill/validate.ts` — 加 T1 字面密钥拒 + T2 secret_refs 完整性
- `src/skill/index.ts` — barrel 增量
- `src/codegen/executor.ts` — `formatComposedResult` 末尾追加 redact 调用
- `src/mcp/server.ts` — `CreateServerOptions.secretProvider` + `registerSecretProfileManage`
- `src/index.ts` — 加 `export * from "./secrets/index.ts"`
- `package.json` — `exports."./secrets"` 子路径
- `ARCHITECTURE.md` — subsystem map 增加 secrets/
- `CHANGELOG.md` — v1.2.0 unreleased 条目

**关联方影响验证**：
- C1：v1.0 / crabclaw 0 修改 ✅
- C2：所有新文件在 D:\acosmi-skill-agent-mcp ✅
- C3：纯 local；不动 git remote
- C4：既有公共 API 全部向后兼容（设计档 §八）✅
- C5：纯 TS 内增；不引入 native module

---

## 三、Commit 计划（每 commit 一个原子单元 + why + 回滚）

### Commit 1（P2）— `src/secrets/types.ts`

| 字段 | 内容 |
|---|---|
| **file** | `src/secrets/types.ts`（新建）|
| **old** | 不存在 |
| **new** | `SecretProvider / SecretSourceAdapter / SecretProfile / ResolvedAuth / SecretProfileStoreData / SECRET_PROFILE_STORE_VERSION / SECRET_PROFILES_FILENAME / SecretError` |
| **why** | 接口先行；后续 store / provider / sources 都依赖类型 |
| **关联方** | 无（纯类型定义，零运行时副作用）|
| **测试** | 类型验证由 tsc 兜底；无独立测试 |
| **回滚** | 删除文件即可（被 import 后的回滚由后续 commit 一并 revert）|

### Commit 2（P3）— `src/secrets/store.ts`

| 字段 | 内容 |
|---|---|
| **file** | `src/secrets/store.ts`（新建）|
| **new** | `SecretProfileStore / loadSecretProfileStore / saveSecretProfileStore / secretProfilesPath`，仿 `src/codegen/store.ts` 的 atomic write + 0o600 + version-mismatch return-error |
| **why** | profile 元数据持久化层；与密钥本身无关，但需要 user-private 文件保护防别用户读"哪些 profile" |
| **关联方** | 仅依赖 types.ts |
| **测试** | `tests/secrets/store.test.ts` (commit 9) |
| **回滚** | 删除文件 |

### Commit 3（P4-1）— `src/secrets/sources/env.ts`

| 字段 | 内容 |
|---|---|
| **file** | `src/secrets/sources/env.ts`（新建）|
| **new** | `EnvSecretSource implements SecretSourceAdapter`，prefix `"env"`，`read(suffix)` = `process.env[suffix]`；空值抛 `source_read_failed` |
| **why** | 最简 source；满足 dev / CI 主流程 |
| **关联方** | 依赖 types.ts |
| **测试** | `tests/secrets/sources.test.ts` |

### Commit 4（P4-2）— `src/secrets/sources/file.ts`

| 字段 | 内容 |
|---|---|
| **file** | `src/secrets/sources/file.ts`（新建）|
| **new** | `FileSecretSource`，prefix `"file"`，`read(suffix)` 用 `fs.stat` 校验 mode 不是 world/group readable（`stat.mode & 0o077 !== 0` → `file_mode_insecure` 抛错），通过则 `fs.readFile(suffix, "utf-8").trimEnd()` |
| **why** | K8s tmpfs / Docker secret mount / Vault Agent sidecar 标准路径 |
| **关联方** | 依赖 types.ts，使用 `node:fs/promises` |
| **测试** | sources.test.ts 含 mode 校验 |

### Commit 5（P4-3）— `src/secrets/sources/index.ts`

| 字段 | 内容 |
|---|---|
| **file** | `src/secrets/sources/index.ts`（新建）|
| **new** | `defaultSourceAdapters()` 工厂返回 `[EnvSecretSource, FileSecretSource]`；barrel 导出 |
| **why** | 一行注入，避免每个 host 手动 register 两次 |
| **关联方** | 依赖 env.ts + file.ts |

### Commit 6（P5-1）— `src/secrets/provider.ts`

| 字段 | 内容 |
|---|---|
| **file** | `src/secrets/provider.ts`（新建）|
| **new** | `DefaultSecretProvider implements SecretProvider`，构造接 `SecretProfileStore`；维护 `Map<prefix, SecretSourceAdapter>`；`resolveProfile(name)` 走 store → 解析 source URI 前缀 → 路由 adapter → adapter.read → 包装成 ResolvedAuth；`registerSourceAdapter(adapter)` |
| **why** | 把 store + adapter 粘合，对 host 暴露唯一公共类 |
| **关联方** | types.ts + store.ts |
| **测试** | provider.test.ts |

### Commit 7（P5-2）— `src/secrets/redact.ts`

| 字段 | 内容 |
|---|---|
| **file** | `src/secrets/redact.ts`（新建）|
| **new** | `redactSecrets(text: string): string`，应用一组 RegExp（`sk-` / `ghp_` / `gho_` / `xoxb-` / `AKIA` / `Bearer xxx` / `Authorization:` 行）替换为 `***` |
| **why** | 输出脱敏兜底，防上游 API 错误体回显 token |
| **关联方** | 纯函数，零依赖 |
| **测试** | redact.test.ts |

### Commit 8（P5-3）— `src/secrets/index.ts`

| 字段 | 内容 |
|---|---|
| **file** | `src/secrets/index.ts`（新建）|
| **new** | barrel 导出全部公共表面 |
| **关联方** | 上述 7 个 commit |

### Commit 9（P9-1）— 测试覆盖（前 8 个 commit 一并跑通）

| 字段 | 内容 |
|---|---|
| **files** | `tests/secrets/{store,sources,provider,redact}.test.ts` |
| **why** | 验证 secrets/ 子系统独立工作 |
| **测试目标** | 各文件 happy + error path；全部 `bun test` 绿 |

### Commit 10（P6-1）— SKILL frontmatter 类型 + 解析

| 字段 | 内容 |
|---|---|
| **files** | `src/manage/skill-frontmatter.ts`（修改）+ `src/skill/types.ts`（修改）|
| **old** | `CrabClawSkillMetadata` / `ExtendedSkillMetadata` 没有 secretRefs |
| **new** | 加 `secretRefs?: string[]`；`resolveCrabClawMetadata` 末尾增加：`const refs = stringArray(metadataObj["secret_refs"]); if (refs) meta.secretRefs = refs;` |
| **why** | SKILL 声明它会用哪些 profile |
| **关联方** | parse-extended.ts 通过 spread 自动透传，无需修改 |
| **测试** | tests/skill/skill.test.ts 加用例 |

### Commit 11（P6-2）— `validateSkillMode` 双层校验

| 字段 | 内容 |
|---|---|
| **file** | `src/skill/validate.ts`（修改）|
| **old** | 单参 `validateSkillMode(meta)` |
| **new** | 二参 `validateSkillMode(meta, opts?: { secretProvider?, source?: string })`；新增 `LITERAL_SECRET_PATTERNS` + `scanLiteralSecrets(source)`；新增 `code: "literal_secret_rejected" / "missing_secret_profile"` |
| **why** | T1（字面拒）+ T2（profile 完整性）|
| **关联方** | `SkillModeValidationCode` enum 加两条；现有调用方单参签名仍可用 |
| **测试** | tests/skill/skill.test.ts 加用例 |

### Commit 12（P7-1）— `secret_profile_manage` 实现

| 字段 | 内容 |
|---|---|
| **file** | `src/manage/secret-profile-manage.ts`（新建）|
| **new** | `executeSecretProfileManage(inputJson, ctx) → string` + `secretProfileManageToolDef()`；5 actions 表驱动（仿 manage-tool.ts）|
| **why** | 暴露 profile CRUD 给 MCP 客户端；永不接收 raw key |
| **关联方** | 依赖 SecretProvider + SecretProfileStore |
| **测试** | tests/manage/secret-profile-manage.test.ts |

### Commit 13（P7-2）— MCP 注册 + CreateServerOptions

| 字段 | 内容 |
|---|---|
| **file** | `src/mcp/server.ts`（修改）|
| **new** | `CreateServerOptions.secretProvider?: SecretProvider`；新增 `registerSecretProfileManage(server, options)` —— 当 secretProvider 提供时注册 `secret_profile_manage` MCP tool |
| **why** | gating 模式与既有 `skill_resolver / spawn_subagent` 一致 |
| **关联方** | createServer 主体加一行 register 调用 |
| **测试** | tests/mcp/ 现有 server 测试不破即可 |

### Commit 14（P8-1）— executor 脱敏集成

| 字段 | 内容 |
|---|---|
| **file** | `src/codegen/executor.ts`（修改）|
| **old** | `formatComposedResult` 直接返回 markdown 字符串 |
| **new** | 末尾 `return redactSecrets(out)`；从 `../secrets/redact.ts` import |
| **why** | 上游 API 错误体可能回显 Bearer，最后一道兜底 |
| **关联方** | 输出可能少量字符变化（`Bearer sk-…` → `Bearer ***`），不破坏既有调用 |
| **测试** | tests/codegen 加 1 用例验证 redact |

### Commit 15（P8-2）— 顶层导出 + package.json exports

| 字段 | 内容 |
|---|---|
| **files** | `src/index.ts`（修改）+ `package.json`（修改）|
| **new** | `src/index.ts`：`export * from "./secrets/index.ts"`；`package.json`：`exports."./secrets"` 三态条目（types/bun/import）|
| **why** | 让 host 可深度导入 `from "@acosmi/skill-agent-mcp/secrets"` |
| **关联方** | tsc/bun build 需重跑 |

### Commit 16（P10-1）— 审计文档

| 字段 | 内容 |
|---|---|
| **file** | `docs/jiagou/审计-acosmi-skill-agent-mcp-secrets-v1.md`（新建）|
| **new** | 6 条总则审计报告：主文件逐行 / 关联方调用图 / 举一反三 / 子代理复核 / 文档全量回写 / 风险公示 |

### Commit 17（P10-2）— CHANGELOG + ARCHITECTURE.md

| 字段 | 内容 |
|---|---|
| **files** | `CHANGELOG.md` + `ARCHITECTURE.md` |
| **new** | CHANGELOG v1.2.0 unreleased 条目；ARCHITECTURE 增 secrets/ 子系统块 |

---

## 四、测试策略

| 层 | 文件 | 数量预估 |
|---|---|---|
| 单元 store | tests/secrets/store.test.ts | ~6 |
| 单元 sources | tests/secrets/sources.test.ts | ~6 |
| 单元 provider | tests/secrets/provider.test.ts | ~6 |
| 单元 redact | tests/secrets/redact.test.ts | ~5 |
| 单元 manage | tests/manage/secret-profile-manage.test.ts | ~7 |
| 集成 validate | tests/skill/skill.test.ts 扩展 | +4 |
| 集成 executor | tests/codegen 扩展 | +2 |

**预期增量**：~36 tests。

**通过基准**：`bun test` 全绿 + `bunx tsc --noEmit` 0 errors。

---

## 五、风险与回滚策略

| 风险 | 缓解 | 回滚动作 |
|---|---|---|
| `formatComposedResult` redact 误伤合法字符串（极端场景把碰巧匹配 sk- 的非密钥替换）| LITERAL_SECRET_PATTERNS 用 word-boundary + 长度阈值 ≥20；test 覆盖典型误伤场景 | 单独 revert commit 14 |
| `validateSkillMode` T1 拒了 demo SKILL 里有意写的明文 | demo SKILL 不应直接放真实 key；如果是占位符（`sk-DEMO_KEY_PLACEHOLDER`）满足长度阈值不会被误拒（包含 `_` 不属于 sk- 后续字符集）；测试覆盖 | 单独 revert commit 11 |
| `FileSecretSource` mode 校验在 Windows 上语义不同 | Windows 文件 mode 来自 NTFS ACL 投影，`stat.mode & 0o077` 在 Windows 通常为 0；不强校验只 best-effort；用 `process.platform === "win32"` 跳过 mode 校验 | 文档注明限制 |
| 引入 secrets/ 后 v1.2.0 minor 升级使 host 突然校验 secret_refs 缺失而失败 | 校验仅在 host 主动注入 `secretProvider` 时才跑（opt-in）；既有 host 不传 secretProvider 行为不变 | 不需要回滚 |
| MCP secret_profile_manage tool 被远程 LLM 滥用 | tool 永远不接收 raw key（schema 拒）；`literal:` source 默认拒（需 `--allow-literal-secret-source`）| 文档强提醒；test 覆盖 |

---

## 六、外部依赖（无新增）

确认：本次实施 **不引入任何 npm 新依赖**。
- `node:fs/promises` 内置
- `process.env` 内置
- 现有 `zod` 用于 MCP tool schema

---

## 七、Phase ↔ Commit 映射

| Phase（task）| Commits | 备注 |
|---|---|---|
| P1（task 1+2）| 文档不计 commit；本档 + 设计档单独提交 | 已完成 |
| P2（task 3）| Commit 1 | types |
| P3（task 4）| Commit 2 | store |
| P4（task 5）| Commit 3-5 | sources |
| P5（task 6）| Commit 6-8 | provider/redact/index |
| P6（task 7）| Commit 10-11 | SKILL 扩展 |
| P7（task 8）| Commit 12-13 | manage tool + MCP |
| P8（task 9）| Commit 14-15 | executor + 导出 |
| P9（task 10）| Commit 9 + 各 commit 同步加 test | 测试 |
| P10（task 11）| Commit 16-17 | 文档收尾 |
| 验证（task 12）| 末尾跑 typecheck + test |

---

## 八、commit message 模板

```
feat(secrets): <action> — <scope>

WHY: <一句话动机，引用决策档段号>
HOW: <一句话实现核心>

关联方：<files touched>
测试：<bun test 状态>
回滚：<单独 revert 此 commit 的影响>
```

