# 审计-acosmi-skill-agent-mcp-T3C-2026-05-01

> T3-C 执行完成后的 13 项强制审计。
> 主代理执行（无子代理委派 — 本任务全程主代理直接 Read/Grep/Bash）。
> 目标仓：D:\acosmi-skill-agent-mcp（22 commits + tag v1.0.0）

---

## 审计强度

T3 完整审计（13 项 + 关联方全量重检）。

## 验证矩阵（13 项 audit）

| # | Audit 项 | 验证命令 | 结果 |
|---|---------|---------|------|
| 1 | 主文件复检（22 commit 核心翻译准确性） | `git log --oneline` + 抽样 Read 关键文件 | ✅ 22 commits 类型规范（feat/chore/test/docs）+ scope 清晰 + why-driven msg；spot check spawn_blueprint_agent.go → dispatch/agent.ts 翻译保留 387L Go 7 大功能（spawnInput / publishHandoffAudit / SkillSourceResolver / executeSpawnBlueprintAgent / executeSkillDrivenSpawn / buildSkillAgentSystemPrompt / formatSkillSpawnResult） |
| 2 | 关联方重检（agent.ts 字段名 camelCase 一致） | `Grep "SourceID\|sourceID\|contract\.SourceRef" src/` | ✅ 0 matches — 全用 v1.0 camelCase（contract.sourceRef.id / contract.contractId / runtimeKind），无 Go PascalCase 误用 |
| 3 | 测试覆盖度（136 pass 关键路径） | `bun test` | ✅ 136 pass / 2 skip / 0 fail / 275 expect / ~204ms across 6 files；覆盖 capabilities 60 + manage 24 + skill 18 + codegen 11 + dispatch 13 + tools 10 |
| 4 | 文档完整性（README + ARCHITECTURE + CHANGELOG 反映实施） | `grep "v1\.0\.0\|136 pass\|110\.83\|62 files\|@acosmi/skill-agent-mcp" docs` | ✅ 数字一致：v1.0.0 / 136 pass / @acosmi/skill-agent-mcp / 8 子路径 / private:true |
| 5 | Deliberate divergence commit msg 记录 | `git log --grep="Deliberate divergence"` | ✅ 7 commits 含"Deliberate divergence"段（codegen 3 + dispatch 2 + skill 1 + bootstrap 1）；v1.0 verbatim copy 3 commits（capabilities/manage/llm）正确不含（零修改） |
| 6 | C1-C6 用户硬约束（始终保持） | git log + ls 验证 | ✅ C1 crabclaw 0 修改（git log --since="2026-05-01" backend/ 空）/ C2 全新文件在 D:\acosmi-skill-agent-mcp / C3 不擅自 gh repo create / C4 v1.0 17 commits 0 修改（git log --since="2026-05-02" 空）/ C5 翻译语义 / C6 极端反幻觉模式 |
| 7 | dispatch/tool.ts placeholder 已被 commit #13 回填 | `grep "placeholder\|TODO\|stub" src/dispatch/` | ✅ 0 matches in dispatch/ — commit #10 桩代码完全被 commit #13 重写 |
| 8 | 7 extended fields 在 parse-extended.ts 真解析 | `grep "stall_threshold_ms\|max_retry\|escalation_chain\|snapshot_rollback\|triggers\|sop\|review_gate" parse-extended.ts` | ✅ 全 7 字段在 L61-82 真解析（4 标量 + 3 嵌套对象）；嵌套类型 6 个（AgentTriggers/CronTrigger/MessageMatch/EventTrigger/SOPStep/ReviewGate）独立 parser 函数 |
| 9 | permission monotone-decay allow 越界拒绝 test 覆盖 | `grep "allow cannot escape\|monotone-decay" tests/dispatch.test.ts` | ✅ tests/dispatch/dispatch.test.ts:38-44 测试 `allow:["forbidden"]` parent:["a","b"]` → expect [] |
| 10 | examples imports 与 package.json 8 子路径 exports 对齐 | `grep "@acosmi/skill-agent-mcp/" examples/` | ✅ 7 imports 全部使用 8 已定义子路径（capabilities/codegen/dispatch/llm/manage/mcp/skill/tools），无未定义 |
| 11 | tests/manage.test.ts 2 skip tests 适当 | Read line 313-318 | ✅ describe.skip + 详细注释解释（v1.0 examples-path 不一致 + 同 parser/dispatcher 已被新 fixtures 覆盖） |
| 12 | .gitattributes + bin 100755 正确 | `git ls-files --stage bin/ .gitattributes` | ✅ bin/acosmi-skill-agent-mcp 100755 + .gitattributes 100644（commit #1 deliberate divergence vs v1.0 100644 + 缺 .gitattributes） |
| 13 | ComposedSubsystem on_error=retry 真 2 次重试 | Read executor.ts L189 | ✅ `for (let attempt = 0; attempt < 2; attempt++)` — 与 Go `for retry := 0; retry < 2` 1:1 匹配（initial + 2 = 3 总尝试） |

---

## 关联方调用图（已验证）

```
McpServer (createServer)
  ├─→ executeManageTool (capability_manage)
  ├─→ tree.toRegistry / toolsForTier (tree_*)
  ├─→ executeSkillSuggest → templates/<name>.md (skill_suggest)
  ├─→ executeSkillGenerate → parseExtendedSkillFrontmatter + validateSkillMode + atomic write (skill_generate)
  ├─→ executeSkillManage (skill_manage list/get/update/delete/export)
  ├─→ executeSkillActivate → dispatchSkill (skill_activate)
  │     ├─→ dispatchPromptSkill (mode=prompt)
  │     ├─→ dispatchToolSkill → ComposedSubsystem.executeTool (mode=tool)
  │     │     └─→ resolveTemplate / lookupPath (template engine)
  │     │     └─→ ToolCallbackRegistry.get → ExecuteToolFn (host-supplied)
  │     └─→ executeSkillDrivenSpawn (mode=agent)
  │           ├─→ resolveSkillAgentCapabilities (monotone-decay)
  │           ├─→ buildSkillAgentSystemPrompt
  │           ├─→ DelegationContract (transitionStatus pending→active→completed/failed)
  │           ├─→ publishHandoffAudit + InterAgentBus.hasActiveSubscriber (handoff二选一)
  │           └─→ SpawnSubagent callback (host-supplied)
  ├─→ parseExtendedSkillFrontmatter + validateSkillMode (skill_parse)
  └─→ executeSpawnAgent (spawn_agent)
        └─→ executeSkillDrivenSpawn (same as skill_activate agent path)
```

跨语言边界：无（纯 TS）。
跨进程边界：MCP transport（stdio child process / Streamable HTTP）— SDK 拥有，本仓不重写。
跨包边界：node_modules/{@modelcontextprotocol/sdk, yaml, zod} — bun.lock 锁定。

---

## 关联方影响矩阵

| 文件类别 | 影响类型 | 状态 |
|---------|--------|------|
| D:\acosmi-skill-agent-mcp/src/* (10026 LOC) | 全新建 + 翻译 + verbatim copy | 已改（22 commits） |
| D:\acosmi-skill-agent-mcp/tests/* (1948 LOC) | 全新建 + 复用 v1.0 | 已改（commit #20） |
| D:\acosmi-skill-agent-mcp/examples/* | 全新建 demo | 已改（commit #19） |
| D:\acosmi-skill-agent-mcp/templates/* + docs/SKILL-TEMPLATE.md | 5 模板 + cp crabclaw 488L | 已改（commit #14） |
| D:\acosmi-skill-agent-mcp/{README,ARCHITECTURE,CONTRIBUTING,CHANGELOG}.md | 全文档 | 已改（commit #21） |
| D:\acosmi-skill-agent-mcp/{package.json,tsconfig,LICENSE,bin/,.gitignore,.gitattributes,.npmignore,bun.lock} | 项目元数据 | 已改（commits #1, #2, #19, #22） |
| D:\acosmi-agent/* (v1.0 17 commits) | 仅 Read 作复制源 | 安全（git log --since="2026-05-02" 空） |
| D:\CrabClawApp/backend/* (crabclaw 原码) | 仅 Read 作翻译参考 | 安全（git log --since="2026-05-01" backend/ 空） |
| D:\CrabClawApp/docs/claude/goujia/{设计-..,执行-..,审计-..}.md | 立项 + 执行 + 审计文档 | 已改（本审计文档为新增） |

---

## 举一反三扫描

| 关键词 | 文件 | 是否同类问题 |
|-------|------|------------|
| `placeholder\|TODO\|stub` | src/dispatch/ | ✅ 0 matches — commit #13 完全清理 |
| `SourceID\|sourceID\|SourceRef` | src/ | ✅ 0 matches — 全 camelCase 一致 |
| `import.*from\s+['"](\.\./){4,}` | src/ | ✅ 0 matches — 无超过 3 层向上引用 |
| `@acosmi/agent` (跨包硬引用) | src/ | ✅ 0 matches — 全 verbatim 复制不依赖 |
| Go `*uint32` / `*int64` 误翻译 | src/ | ✅ 0 matches — 全用 `number \| undefined` |
| `console.log` (应用 logger) | src/ | ⚠ cli/main.ts 4 处使用（OK — CLI 输出非 protocol-bound 时可接受，stdio transport 注意已在 main.ts 注释；非 stdio 输出走 stderr） |

---

## 子代理复核

**本任务全程主代理执行**，未派子代理（任务规模适中、上下文充裕）。

无 "无问题" 抽检需求。

---

## 测试

- 命令：`cd /d/acosmi-skill-agent-mcp && bun test`
- 结果：**136 pass / 2 skip / 0 fail / 275 expect()** across 6 files (~204ms)
- 命令：`cd /d/acosmi-skill-agent-mcp && bunx tsc --noEmit`
- 结果：**0 errors**
- 命令：`cd /d/acosmi-skill-agent-mcp && bun pm pack`
- 结果：**62 files / 110.83 KB packed / 0.39 MB unpacked**

2 个 skipped tests：
- `tests/manage/manage.test.ts:318` describe.skip("examples integration") — v1.0 examples 路径不一致；同 parser/dispatcher 已被新 fixtures 覆盖（注释充分）

无 fail。无 flaky。环境健康。

---

## 额外问题

**已处置**（commit 内同时修复 + msg 注明）：
- commit #1：v1.0 漏 .gitattributes / bin 仅 100644 → 新包加 .gitattributes（强制 LF + bin/* 100755）+ commit msg 记 deliberate divergence
- commit #5：v1.0 SkillAgentConfig 缺 7 字段 → src/skill/types.ts 扩展 + parse-extended.ts 解析 + validate.ts 验证（设计档 G8 风险段已识别）
- commit #13：dispatch/tool.ts 桩接入 ComposedSubsystem.executeTool（与 commit #10 计划一致）
- commit #19：package.json 无 subpath exports → 加 8 子路径 exports（让 examples npm-style import work）
- commit #22：v1.0 漏 .npmignore → 加 .npmignore second-line guard

**待处置技术债务**（本仓后续 cycle）：
- W-OPT-1：tests/mcp/ + tests/e2e/ 测试套件未加（执行档原估 ~15 测试，commit #20 已写明推 future cycle）— 不阻塞 v1.0 release，MCP 协议层 SDK 已有 protocol-level tests
- W-OPT-2：src/skill/ disk-walking SkillSourceResolver 未提供（仅 staticSkillResolver 用于 demo+test）— 文档已明示，OSS 用户自行实现
- W-OPT-3：dist/ 未生成（build 仍是 commit #1 placeholder TODO）— src/* 直接被 bun 跑通，但若 npm publish 需先 tsc build；v1.0 cycle 私有不需要

---

## 文档回写

- `D:\CrabClawApp\docs\claude\goujia\审计-acosmi-skill-agent-mcp-T3C-2026-05-01.md` — 本审计报告（新增）
- `D:\CrabClawApp\docs\claude\goujia\执行-acosmi-skill-agent-mcp-T3C-v1.md` — 22/22 commit checklist 全部 [x] ✅
- `D:\acosmi-skill-agent-mcp\CHANGELOG.md` — v1.0.0 entry 含完整 Translation Provenance + Deliberate Divergences + Dependencies tables
- `D:\acosmi-skill-agent-mcp\ARCHITECTURE.md` — 子系统 ASCII 图 + 三模式表 + monotone-decay 算法 + 持久化策略 + "what NOT included" callouts
- 用户 memory 待用户决定是否归档（acosmi-skill-agent-mcp 与 acosmi-agent v1.0 的关系 + 22 commits + 7 deliberate divergences）

---

## 风险公示

**无 P0/P1 未解风险**。

**P2 已知（设计档 R1-R10 终态）**：
- R1 v1.0 src/ 复制 → 双源 drift：CHANGELOG 写明 baseline + Translation Provenance；长期治理由用户决策（同 v1.0 spin-off 的 R6 长期治理）
- R3 agent 模式不带 runner：examples/agent-runner-impl.ts stub + sketch 演示，OSS 用户自实现
- R4 tool 模式需 OSS 用户注入 ToolCallbackRegistry：examples/tool-callback-registry.ts 演示
- R10 C2 local-only：private:true 保留（用户决策决定何时 publish）

**P3 future cycle**（不阻塞 v1.0）：
- W-OPT-1/2/3 见上"待处置技术债务"段
- mcp + e2e 测试覆盖度后续提升
- dist/ build pipeline 待 npm publish 触发

---

## 总评

**T3-C 22 commits 全量交付 + 全 13 项 audit 通过**。

- 翻译质量：13 个翻译来源文件全部 1:1 行为保留 + camelCase 一致 + 7 处 deliberate divergence 在 commit msg 充分记录
- 用户硬约束：C1-C6 全 ✅
- 用户决策：D11-D19 全 ✅
- 已撤回方案：A/B/C 三方向继承自设计档，commit msg 全部交叉引用，未试图重启
- 测试质量：136 pass / 0 fail / 275 expect / 7 模块覆盖 / ~200ms 整套
- pack 输出：62 files / 110.83 KB packed（vs v1.0 60.69 KB），新增 ~50 KB 反映 dispatch + codegen + mcp + tools + templates + examples 新模块
- npm publish 仅差一步：删除 `package.json#private:true` + 注册 npm token（用户决策）

**结论**：v1.0 release-ready（local-only 形态），audit pass。

---

## 复核纠错（2026-05-01 后追加）

### 撤回原"audit pass"结论

上述 13 项 audit 跑出 ✅ 后，**同日下午**做了一次更深的 T3 全链路独立复核
（与原审计同一会话内重新跑，但读取代码本身而非依赖第一遍 audit 的产出），
发现原审计**遗漏 11 项实质性缺陷**，其中 3 P0 / 3 P1 / 6 P2 / 1 P3 + 1
架构纠正（去 LLM 硬编码）。

原"audit pass"结论收回。复核详见
`docs/jiagou/执行-acosmi-skill-agent-mcp-修复-2026-05-01.md`。

### 原审计为何漏

| 漏检项 | 原 audit 应当捕获的位置 | 实际为什么漏 |
|---|---|---|
| P0-1 顶层 `src/index.ts` 只有 `export {};` | audit 项 4 文档完整性 / audit 项 10 examples imports 8 子路径 | audit 检查"package.json#exports."."" 字段 = 8 子路径"和"deep-import 可用"，但**没**测过"flat import 顶层是否真有 export"——错过假设 deep-import 可达 ⊆ flat import 可达 |
| P0-2 HTTP transport.start 是 SDK no-op | audit 项 1 主文件复检 | spot-check 看了 `createStreamableHttpTransport` 工厂，工厂语义对；但**没**测过端到端 listen → 客户端连接 |
| P0-3 bin shebang 与 engines.node 不匹配 | audit 项 12 .gitattributes + bin 100755 | 验证了 mode bit 但**没**比对 shebang 与 engines 一致性 |
| P1-1 contract.timeoutMs 不一致 | audit 项 1 主文件复检 / audit 项 9 dispatch 测试 | dispatch 测试覆盖了权限 monotone-decay 但**没**覆盖 timeoutMs 流通；spot-check 没注意到两个变量不同源 |
| P1-2 sub-agent prompt 漏注入 contract | audit 项 8 7 extended fields 解析 | 关注的是 SKILL.md frontmatter 解析，没关注 prompt 拼装管线是否完整 |
| P1-3 SSE 多 tool_use 解析 | audit 没专门列项检查 LLM adapter | LLM 模块在 v1.0 verbatim copy 范畴内，原审计假设"v1.0 已审过 = 现在也对"——但**v1.0 自身就有这个 bug**，verbatim copy 把 bug 也拷过来了 |
| P2-1 ~ P2-6 6 项 P2 | audit 项 5 deliberate divergence | 关注的是"我**主动**改了什么"，没系统扫"v1.0 哪里其实是 bug 但我没动" |
| P3-1 commit #N 占位 | audit 没列项 | 这是叙述性瑕疵，原 audit 13 项里没"对外可读性" axis |
| 架构纠正 LLM 默认模型 | audit 项 4 文档完整性 | 文档里 README/ARCHITECTURE 列出 Anthropic/OpenAI/Ollama 是事实陈述 ✅，但**架构正确性**（默认模型 = framework 替用户拍板的反模式）不在 audit 范畴 |

### 修复后状态

| 维度 | T3-C 22 commits 完成时 | 复核 18 commits 完成后 |
|---|---|---|
| commits | 22 | 22 + 19（含 docs commit + 18 项修复） |
| tests | 136 pass / 2 skip / 275 expect / 6 files | **171 pass** / 2 skip / 360 expect / **10 files** |
| 顶层 import 可达 | ❌ undefined | ✅ 11 关键 export 全 truthy |
| HTTP listener | ❌ no-op | ✅ POST/GET/DELETE /mcp 真监听 + sessionId map + close handler |
| node 用户 CLI | ❌ shebang=bun 直挂 | ✅ node 默认 + bun 备选双 bin |
| Anthropic SSE 多 tool_use | ❌ partial_json id="" 串数据 | ✅ index→id 路由 |
| contract.timeoutMs | ❌ 与 spawn 用值漂移 | ✅ 同源 |
| sub-agent contract 注入 | ❌ 漏（同步 Go 端 spawn_blueprint 遗漏） | ✅ 与 spawn_media 端 1:1 |
| LLM 默认模型 | claude-sonnet-4-6 / gpt-4o 硬编码 | ✅ 100% 调用方传 |

### 教训

1. **"deep-import 可达" ≠ "flat import 可达"**：package.json#exports
   字段是 8 个子路径都对了，但 "." 字段指向的 dist/index.js 实际编译
   自只有 `export {};` 的源文件——audit 项 10 应该加一句"测顶层
   re-export 真有内容"。
2. **verbatim copy 不能跳过审计**：v1.0 的 LLM 模块复制过来时假设
   "v1.0 已审过"，但 v1.0 自身就有 SSE 解析的 bug。下次复制别人模块
   要全量重审，至少跑一遍单元测试覆盖度。
3. **audit 项要包含端到端 smoke**：13 项 audit 全是静态检查（grep /
   spot-check / 测试通过率），缺一项"端到端开 server + 发请求 +
   收响应"。本次复核的 P0-2 就靠 transport-http.test.ts 端到端测
   抓出来。
4. **"audit pass" 结论务必谨慎**：下次发 "audit pass" 之前至少自问
   "audit 项是否能覆盖 P0 类 critical（用户 install 后基础功能直接
   挂掉）的所有路径"——本次 P0-1/2/3 三项都是 critical 但都不在原
   13 项 audit 范畴。


