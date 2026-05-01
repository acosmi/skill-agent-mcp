# 审计-acosmi-skill-agent-mcp-secrets-v1

> 上一档：执行-acosmi-skill-agent-mcp-secrets-v1.md（执行 v1）
> 创建：2026-05-01
> 范围：secret-profile 子系统首次实施全量审计（src + tests + docs + 集成）

---

## 一、审计 6 总则执行清单

| 总则 | 本次执行 |
|---|---|
| **G1 主文件逐行** | secrets/{types,store,provider,redact,index}.ts + secrets/sources/{env,file,index}.ts + manage/secret-profile-manage.ts 共 9 文件全部主代理亲读 ✅ |
| **G2 关联方调用图** | 见 §三调用图，覆盖 4 个调用入口 + 3 处现有文件修改 ✅ |
| **G3 举一反三** | 见 §四 — 同模式排查（profile name 拼写 / source URI 解析 / file mode 校验 / redact RegExp /g lastIndex 重置）✅ |
| **G4 子代理复核** | 本档采用主代理直审；范围 8 新文件 ≤ Audit T2 阈值，未触发 T3 抽样要求 ✅ |
| **G5 文档全量回写** | 设计档 + 执行档 + 审计档（本档）+ CHANGELOG + ARCHITECTURE.md 全部回写 ✅ |
| **G6 风险公示** | 见 §六 — 5 项已知 trade-off / 限制项明确公示 ✅ |

---

## 二、产出清单与 LOC 实测

| 文件 | 类型 |
|---|---|
| docs/jiagou/架构-secrets-v1.md | 设计文档 |
| docs/jiagou/执行-secrets-v1.md | 执行文档 |
| docs/jiagou/审计-secrets-v1.md | 审计文档 |
| src/secrets/types.ts | 接口 / 类型 |
| src/secrets/store.ts | 存储 |
| src/secrets/sources/env.ts | source adapter |
| src/secrets/sources/file.ts | source adapter |
| src/secrets/sources/index.ts | 工厂 + barrel |
| src/secrets/provider.ts | 主入口 |
| src/secrets/redact.ts | 输出脱敏 |
| src/secrets/index.ts | barrel |
| src/manage/secret-profile-manage.ts | MCP tool |
| tests/secrets/store.test.ts | unit |
| tests/secrets/sources.test.ts | unit |
| tests/secrets/provider.test.ts | unit |
| tests/secrets/redact.test.ts | unit |
| tests/manage/secret-profile-manage.test.ts | unit |
| tests/skill/skill.test.ts +secret_refs 段 | unit (扩展) |
| tests/codegen/codegen.test.ts +redact 段 | integration (扩展) |

实施 phase：P1-P10 全部 completed。

---

## 三、关联方调用图（G2）

### 3.1 启动期数据流（host bootstrap）

```
host
  → loadComposedToolStore(stateDir)              [既有, 未改]
  → loadSecretProfileStore(stateDir)             [新, src/secrets/store.ts]
       → fs.readFile(secretProfilesPath(stateDir))
       → JSON.parse → isStoreData() guard → version check
  → const provider = new DefaultSecretProvider(store)   [src/secrets/provider.ts]
  → for a of defaultSourceAdapters():
       provider.registerSourceAdapter(a)         [src/secrets/sources/index.ts]
       [defaults: EnvSecretSource + FileSecretSource]
  → createServer 注入 secretProvider + secretProfileStore
       → registerSecretProfileManage(server, options)  [src/mcp/server.ts]
            [gating: 仅当两者都提供时注册 MCP tool]
            → server.registerTool("secret_profile_manage", ...)
```

### 3.2 SKILL 创作期校验流（save 时）

```
skill_generate / skill_manage update（既有 MCP tool）
  → parseExtendedSkillFrontmatter(content)            [src/skill/parse-extended.ts]
       → resolveCrabClawMetadata(fm)                  [src/manage/skill-frontmatter.ts]
            → NEW: fm.secret_refs / metadataObj.secret_refs → meta.secretRefs
  → validateSkillMode(meta, { source: content, secretProvider })
       T1: findLiteralSecret(content)                 [src/secrets/redact.ts]
            命中 → return code: literal_secret_rejected
       T2: for ref of meta.secretRefs:
            secretProvider.hasProfile(ref) === false
            → return code: missing_secret_profile, field: secret_refs[i]
       structural rules (既有 mode 互斥) → return null on success
```

注：当前 v1.1.0 的 SKILL save 路径并没有把 `source + secretProvider` 透传给 `validateSkillMode`。这是**有意为之** — 仅落地接口、测试、文档；既有 host 维持向后兼容。host 升级到 v1.2.0 后**主动**调用：

```
const err = validateSkillMode(meta, { source, secretProvider });
```

来开启 T1+T2 校验。已在 §六风险表中明确公示。

### 3.3 运行期密钥流（tool-mode SKILL 执行）

```
MCP tool call
  → dispatchSkill → dispatchToolSkill
       → ComposedSubsystem 处理 step 序列              [src/codegen/executor.ts]
            → resolveInputMap(step.inputMap, varMap)  [既有]
                 NB: varMap 仅含 input + step.outputAs；密钥从未进入
            → ExecuteToolFn 调到 host 注册的工具实现
                 → host's http_request impl:
                      const auth = await secretProvider.resolveProfile(input.auth_profile)
                           store.get(name) — profile_not_found?
                           parseSourceUri — invalid_source_uri?
                           adapters.get(prefix) — source_unsupported?
                           adapter.read(suffix) — source_read_failed?
                           shapeAuth(type, raw, username) — bearer/basic/raw
                      fetch(url, headers: auth.headers)
            → formatComposedResult([...])
                 → redactSecrets(out)                 [src/secrets/redact.ts]
                      Authorization header 字面 → ***
                      sk- / ghp_ / AKIA → ***
       → return text 给 MCP 客户端
```

**关键不变量**（4 道关，按"是否默认强制"拆分）：

**架构层面强制（无需 host 配合）：**
3. 密钥不进 varMap（架构层面 — 工具实现内部 resolve）
4. 输出经 redactSecrets 兜底（formatComposedResult 末尾自动跑）
（POSIX）FileSecretSource 双层 mode 校验（lstat 链接 + stat 目标都必须 600）

**Opt-in 强制（仅当 host 用 `validateSkillMode(meta, opts)` 二参签名时启用）：**
1. SKILL.md 不能含字面密钥（validate T1）— 默认 **不** 跑，由 host 主动启用
2. `secret_refs` 引用必须存在（validate T2）— 默认 **不** 跑，由 host 主动启用

详见 §六 R1 风险公示与 §九.1 后续工作。

### 3.4 secret_profile_manage MCP tool 数据流

```
client → MCP tool call("secret_profile_manage", payload)
  → McpServer 路由到 registerSecretProfileManage 的 handler
       → 入口函数处理 payload + ctx                   [src/manage/secret-profile-manage.ts]
            → JSON.parse → action 路由
                 register: validate name 正则 + type ∈ bearer/basic/raw +
                           findLiteralSecret(source) 检查 + literal: 前缀 gating
                           → store.set + saveSecretProfileStore
                 list: store.values() + stripSecrets()
                 get: store.get(name) + stripSecrets()
                 remove: store.delete(name) + saveSecretProfileStore
                 test: provider.resolveProfile(name)
                       → success: kind + ok=true（永不返回 headers / value）
                       → fail: ok=false + code + redactSecrets(err.message)
```

---

## 四、举一反三排查（G3）

排查"同模式同坑"6 处，全部已防御 / 无问题：

### 4.1 RegExp /g lastIndex 状态泄露

`redact.ts` 的 `PATTERN_ENTRIES` 数组里全部是 `/g` 正则。`/g` 正则的 `lastIndex` 在 `.test()` / `.exec()` 后**保留状态**，下次调用从 lastIndex 起始。如果跨调用复用同一个 RegExp 对象（PATTERN_ENTRIES 是 module-level 常量），第二次调用可能从中间位置开始扫描，产生假阴性。

**已防御**：`findLiteralSecret` 在每次 `entry.re.test` 前后都显式 `entry.re.lastIndex = 0;`。`redactSecrets` 用 `String.prototype.replace(/g)` 不走 lastIndex 路径（一次性扫描），不受影响。

测试覆盖：`tests/secrets/redact.test.ts` 的"isolates state between calls"用例。

### 4.2 Source URI 解析的 colon-in-suffix 问题

Windows 文件路径含 `:`（drive letter），`source: "file:C:\foo\bar"` 这种合法。

**已防御**：`parseSourceUri` 用 `indexOf(":")` **只切第一个** colon（`prefix = uri.slice(0, idx)` / `suffix = uri.slice(idx + 1)`）。Windows drive letter 切完留在 suffix 给 `fs.readFile` 处理。

### 4.3 File mode 校验的 Windows 退化

POSIX 上 `stat.mode & 0o077` 检测 group/other 可读位。Windows NTFS ACL 投影到 mode 时通常全 0，校验等同跳过。

**已防御**：`FileSecretSource.read` 显式 `if (process.platform !== "win32")` 条件块。Windows 平台不抛 file_mode_insecure，文档（设计档 §五.2）明确说明这是 best-effort。

### 4.4 SKILL frontmatter 字段冲突（top-level vs manifest）

既有 `resolveCrabClawMetadata` 处理 `crabclaw / pi-ai / pi` 嵌套 manifest。`secret_refs` 写哪？

**已防御**：解析时 **top-level 优先**，fallback 嵌套 manifest（与既有 `tools` 字段处理风格一致）：

```
const secretRefs =
  stringArray(fm["secret_refs"]) ?? stringArray(metadataObj["secret_refs"]);
```

允许两种写法都生效。

### 4.5 stateDir mkdir 权限

既有 `composed_tools.json` 用 `0o700` 创建 stateDir。`secret_profiles.json` 必须**复用同一个 stateDir**。

**已防御**：`saveSecretProfileStore` 用同样的 `fs.mkdir(stateDir, recursive: true, mode: 0o700)`。

### 4.6 Manage tool 的 input schema：用 zod 声明字段还是 payload-string？

既有 `capability_manage` 用 `payload: z.string()` 把 13-action 的复杂入参塞进单字段 JSON。`secret_profile_manage` 同样选择。

**已选择 payload string 风格**（src/mcp/server.ts 的 `registerSecretProfileManage`）：与既有 `capability_manage` 完全对称。

---

## 五、测试覆盖度（G4 替代）

由于本次新增子系统 ≤ T2 抽样阈值（设计档 §九 8 phase 而非 T3 ≥10 phase），主代理直接审。

| 子系统 | 覆盖 | 备注 |
|---|---|---|
| store CRUD + persistence | ✅ 7 用例 | 含 mode 0o600 验证（POSIX）、version mismatch、bad schema |
| EnvSecretSource | ✅ 5 用例 | 含值不泄漏到错误信息验证 |
| FileSecretSource | ✅ 6 用例 | 含 mode 校验、目录拒、空文件拒、不存在路径 |
| DefaultSecretProvider | ✅ 7 用例 | 三种 type 形态 + 4 种错误路径 |
| redactSecrets | ✅ 8 用例 | 含 lastIndex 状态泄漏检测 |
| findLiteralSecret | ✅ 4 用例 | 验证返回值不含 matched 字面 |
| secret_profile_manage 5 actions | ✅ 11 用例 | 含 literal-source 拒、name 正则、test 不漏密 |
| validateSkillMode T1+T2 | ✅ 6 用例 | 含向后兼容（无 opts 时 T1/T2 不跑）|
| formatComposedResult redact 集成 | ✅ 3 用例 | 含 Bearer / ghp_ 落到 markdown 的端到端 |

总计：**234 pass / 2 skip / 0 fail / 470 expect() across 15 files**（实测 `bun test` 输出）。

---

## 六、风险公示（G6）

| 编号 | 风险 | 现状 | 规避建议 / 后续动作 |
|---|---|---|---|
| R1 | 既有 SKILL save 路径**没有**把 `source + secretProvider` 透传给 `validateSkillMode` | 既有调用方维持单参签名 → T1/T2 检查不在 framework 层主动跑 | host 端在调用 parser 后**主动**走 `validateSkillMode(meta, opts)`；或后续 minor 把这两个参数加进 SaveSkillContext |
| R2 | `redactSecrets` 是 heuristic — 自定义内部服务 token（无 sk- / ghp_ / Bearer 前缀）会漏 | 文档 + 代码注释明确说"not cryptographic redaction" | host 可在 redactSecrets 后再过自家 filter；或在工具实现层就避免把 raw header 写进 step output |
| R3 | `FileSecretSource` mode 校验在 Windows 上等同 no-op | 已显式 platform check + 文档说明 | Windows 用户改用 `env:` 或 ACL-based 自定义 source（sibling package 场景）|
| R4 | `secret_profile_manage` MCP tool 通过 payload-string 暴露字段；没法在 zod 层做严格 enum 校验 | 与既有 `capability_manage` 风格一致；内部仍做 enum 校验 | 后续若需 LLM 端 schema-level 提示更精准，可拆成 zod-shape 字段，向后兼容 |
| R5 | `literal:` source 默认拒；启用 `allowLiteralSecretSource=true` 后由 host 决定 | 5 fail-safe 默认 + register handler 显式 `findLiteralSecret(source)` 二次扫描 | demo SKILL 用 `source=literal:DEMO_TOKEN_PLACEHOLDER`（不命中 sk-/ghp- 等 pattern）即可；生产环境绝不开 |

---

## 七、决策档对齐复核（M5 反幻觉）

| 设计档决策 | 实施实际 | 一致 |
|---|---|---|
| 决策 1：`secret_refs` 强制声明 + 启动期校验 | `validateSkillMode` 加 T2 校验 + `field: secret_refs[N]` 精确定位 | ✅ |
| 决策 2：source 首发 env+file，留 SecretSourceAdapter 扩展点 | `defaultSourceAdapters()` 返回 [Env, File]；`registerSourceAdapter(prefix, adapter)` 公开 | ✅ |
| 决策 3：复用 composed_tools.json 持久化范式 | `secret_profiles.json` 与 codegen 共用 stateDir，0o600 atomic write 抄 src/codegen/store.ts | ✅ |
| 接口分层（Provider/Adapter/Profile） | 4 个公开类型清晰分层，sibling 包仅需实现 SecretSourceAdapter | ✅ |
| 双层校验（T1 字面拒 + T2 完整性） | `validateSkillMode(meta, opts?)` 二参向后兼容 + 两 code 区分 | ✅ |
| 输出脱敏（formatComposedResult 末尾）| `formatComposedResult` `return redactSecrets(out)` | ✅ |
| 零新依赖 | `package.json` deps 未变（仅 exports 加 `./secrets`）| ✅ |
| 向后兼容 | 全套既有测试 0 改动通过；既有 host 不传 secretProvider 行为完全不变 | ✅ |

---

## 八、收尾验证

| 验证项 | 状态 |
|---|---|
| `bunx tsc --noEmit` | exit 0 ✅ |
| `bun test` | 234 pass / 0 fail ✅ |
| 现有 v1.1.0 测试 0 破坏 | ✅ |
| docs/jiagou/ 三件套 | ✅ |
| CHANGELOG Unreleased 段 | ✅ |
| ARCHITECTURE.md subsystem map | ✅ |
| package.json `./secrets` exports | ✅ |
| `src/index.ts` 顶层 re-export | ✅ |

**所有 G 总则项 + M5 决策档对齐 + R1-R5 风险已公示。**

---

## 八.A 复核审计（P11 — 独立 code-reviewer 子代理）

P1-P10 实施完成后，主代理派 `feature-dev:code-reviewer` 子代理做独立复核，对 18 个文件 + 测试做 confidence-based filtered review。

### 复核结论：3 个阻断项（已全部修复）

| 编号 | 问题 | 子代理置信度 | 修复 |
|---|---|---|---|
| 修-1 | `src/secrets/sources/file.ts` 第 39 行用 `fs.stat`（follow symlink），符号链接本身权限未校验 — K8s secret mount 之外的本地场景对"链接是 644 但目标是 600"的诡异组合开放 | 83 | 改为 **双层 mode 校验**：先 `lstat` 检查链接条目本身（仅当 `lstat.isSymbolicLink()` 时校验链接 mode），再 `stat` 检查目标 mode。两道都必须 600（POSIX） |
| 修-2 | `src/secrets/provider.ts` `parseSourceUri` 抛 `invalid_source_uri` 时错误信息 `JSON.stringify(uri)` 含完整 URI；host 若误填字面密钥进 source 字段，错误信息会回显字面密钥 | 85 | 错误信息改为 `length=N` 形式，**不**包含 URI 内容；在 `tests/secrets/provider.test.ts` 加 "invalid_source_uri error message does NOT echo the URI value" negative test 验证 |
| 修-3 | `skill_generate / skill_manage update / skill_parse` 默认不跑 T1/T2 是 R1 公示的有意决定，但缺少"锁定该行为的负面测试" | 100 | `tests/skill/skill.test.ts` 加两个 "documented R1 behaviour" 测试，明示单参签名不跑 T1/T2 是有意为之；将来若意外开启 T1/T2 默认行为，这些测试会先 fail |

### 复核结论：4 个非阻断项（已分类处置）

| 编号 | 问题 | 处置 |
|---|---|---|
| 非阻-1 | `TEMPLATE_VAR_RE` 模块级 `/g` 正则在并发场景有概念性风险 | 当前 Bun/Node 单线程下 `String.prototype.replace` 规范保证 lastIndex reset，**实际安全**。不改。如未来迁移 Worker thread 再说 |
| 非阻-2 | `secretRefs.length > 0` 在 validate 里是冗余（parser 已 filter 空数组）| 无害冗余，不改 |
| 非阻-3 | `stripSecrets` 是 no-op，将来加敏感字段时需同步更新 | 已在函数注释里说明 "for symmetry with future fields"。如真加字段时 audit 会再走一遍 |
| 非阻-4 | `EnvSecretSource` 错误信息只暴露 var 名不暴露值（已确认安全） | 无问题 |

### 复核评分（子代理给出）

- 4 道密钥不变量：第 3、4 道完全成立；第 1、2 道是 opt-in，已在文档明示
- 与设计档对齐度：8/10 → 修复后 **9/10**（修-3 测试补齐后扣分项消除一半）
- 测试覆盖度：7.5/10 → 修复后 **8.5/10**（symlink + URI 暴露 + R1 锁定 共 5 个增量用例）

### 修复后回归

- `bunx tsc --noEmit` exit 0 ✅
- `bun test` **239 pass / 2 skip / 0 fail / 474 expect() across 15 files** ✅（增量 +5 测试，0 既有破坏）

**复核审计 closeout。可发 v1.2.0。**

---

---

## 九、后续小工作（不在 v1.2.0 必需路径）

按优先级列出，不强制本次实施完成：

1. **R1 跟进**：在 SKILL save 路径的 ctx 加可选 `secretProvider`；改 SKILL save 路径调 `validateSkillMode(meta, { source, secretProvider })`。一处改动 + 一处测试。
2. **README.md 加 secret-profile 一节**：用户级文档（不在 docs/jiagou/ 范围内）。1 段 ~80 行。
3. **examples/ 加 secret-profile 演示 SKILL.md**：纯 demo，让用户照抄。1 文件 ~30 行。
4. **`@acosmi/skill-tools-stdlib` sibling 包**：起 `http_request` 工具实现样板，注入 `SecretProvider` 句柄使用 profile-ref。**独立 npm 包**，不在 v1.2.0 范围。
5. **`@acosmi/skill-secrets-keychain` sibling 包**：keytar 适配器。独立 npm 包，对 `EnvSecretSource` 不熟的桌面应用场景。
