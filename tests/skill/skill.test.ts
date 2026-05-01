import { describe, expect, it } from "bun:test";

import {
  type AgentTriggers,
  type ExtendedSkillMetadata,
  normalizeSkillMode,
  parseExtendedSkillFrontmatter,
  resolvedSkillMode,
  type SkillAgentConfig,
  type SkillModeValidationError,
  validateSkillMode,
} from "../../src/skill/index.ts";
import {
  AggregatedSkillNodeProvider,
  aggregateSkillEntries,
  buildSkillNodeData,
  type LoadedSkillEntry,
  sourcePriority,
} from "../../src/skill/node-provider.ts";

const AGENT_SKILL = `---
tree_id: agents/demo/hello
tools: ["spawn_agent"]
summary: Hello agent demo
skill_mode: agent
agent_config:
  role_title: Demo helper
  role_goal: Greet the user
  inherit: minimal
  allow: ["read_file"]
  triggers:
    cron:
      - schedule: "0 9 * * *"
        task: morning briefing
    message_match:
      - pattern: "^@helper"
        task: handle direct mention
  sop:
    - step: read
      prompt: read first
      tools: [read_file]
    - step: summarize
      prompt: return one-line summary
  review_gate:
    enabled: true
    reviewer: llm
    max_rounds: 2
  stall_threshold_ms: 90000
  max_retry: 1
  escalation_chain: [self, parent]
  snapshot_rollback: true
---

Body.
`;

const TOOL_SKILL = `---
tree_id: tools/demo/echo
tools: ["echo"]
summary: Demo tool SKILL
skill_mode: tool
tool_schema:
  steps:
    - action: e
      tool: echo
      input_map:
        text: "{{ input.message }}"
---

Body.
`;

const PROMPT_SKILL = `---
tree_id: tools/demo/hello_prompt
tools: ["hello_prompt"]
summary: Hello world prompt
---

Hello world body.
`;

describe("parseExtendedSkillFrontmatter", () => {
  it("parses agent SKILL with all 7 extended fields", () => {
    const parsed = parseExtendedSkillFrontmatter(AGENT_SKILL);
    expect(parsed).toBeDefined();
    expect(parsed?.metadata?.skillMode).toBe("agent");
    const cfg = parsed?.metadata?.agentConfig as SkillAgentConfig;
    expect(cfg.roleTitle).toBe("Demo helper");
    expect(cfg.inherit).toBe("minimal");
    expect(cfg.allow).toEqual(["read_file"]);

    // 7 extended fields
    const triggers = cfg.triggers as AgentTriggers;
    expect(triggers.cron?.[0]?.schedule).toBe("0 9 * * *");
    expect(triggers.messageMatch?.[0]?.pattern).toBe("^@helper");
    expect(cfg.sop?.length).toBe(2);
    expect(cfg.sop?.[0]?.tools).toEqual(["read_file"]);
    expect(cfg.reviewGate?.enabled).toBe(true);
    expect(cfg.reviewGate?.maxRounds).toBe(2);
    expect(cfg.stallThresholdMs).toBe(90000);
    expect(cfg.maxRetry).toBe(1);
    expect(cfg.escalationChain).toEqual(["self", "parent"]);
    expect(cfg.snapshotRollback).toBe(true);
  });

  it("returns undefined for malformed input", () => {
    expect(parseExtendedSkillFrontmatter("no frontmatter")).toBeUndefined();
  });

  it("preserves existing v1.0 fields when extended is empty", () => {
    const parsed = parseExtendedSkillFrontmatter(PROMPT_SKILL);
    expect(parsed?.metadata?.treeId).toBe("tools/demo/hello_prompt");
    expect(parsed?.metadata?.summary).toBe("Hello world prompt");
    expect(parsed?.metadata?.agentConfig).toBeUndefined();
  });
});

describe("validateSkillMode", () => {
  it("accepts a valid agent SKILL", () => {
    const parsed = parseExtendedSkillFrontmatter(AGENT_SKILL);
    expect(validateSkillMode(parsed!.metadata!)).toBeNull();
  });

  it("rejects agent SKILL missing role_title", () => {
    const meta: ExtendedSkillMetadata = {
      skillMode: "agent",
      agentConfig: { roleTitle: "" },
    };
    const err = validateSkillMode(meta) as SkillModeValidationError;
    expect(err.code).toBe("missing_role_title");
  });

  it("rejects agent SKILL with tool_schema", () => {
    const meta: ExtendedSkillMetadata = {
      skillMode: "agent",
      agentConfig: { roleTitle: "x" },
      toolSchema: { input: {}, output: {}, steps: [] },
    };
    const err = validateSkillMode(meta) as SkillModeValidationError;
    expect(err.code).toBe("tool_schema_with_agent");
  });

  it("rejects tool SKILL missing tool_schema", () => {
    const meta: ExtendedSkillMetadata = { skillMode: "tool" };
    const err = validateSkillMode(meta) as SkillModeValidationError;
    expect(err.code).toBe("missing_tool_schema");
  });

  it("rejects unknown runtime_kind", () => {
    const meta: ExtendedSkillMetadata = {
      skillMode: "agent",
      agentConfig: { roleTitle: "x", runtimeKind: "bogus" },
    };
    const err = validateSkillMode(meta) as SkillModeValidationError;
    expect(err.code).toBe("invalid_runtime_kind");
  });
});

describe("validateSkillMode — secret-profile checks (T1 / T2)", () => {
  // Constructed via concatenation so this very source file does NOT
  // trigger the literal-secret-rejected pattern when it's loaded.
  const LEAKY_SKILL = `---
tree_id: tools/x/leaky
tools: [leaky]
summary: contains a literal secret
skill_mode: prompt
api_token: ${"sk-" + "abcdefghijklmnopqrstuv"}
---

Body.
`;

  const REFS_SKILL = `---
tree_id: tools/openai/chat
tools: [openai_chat]
summary: openai chat with profile ref
skill_mode: prompt
secret_refs:
  - openai_default
  - github_pat
---

Body.
`;

  it("T1: rejects SKILL with sk- literal in source", () => {
    const parsed = parseExtendedSkillFrontmatter(LEAKY_SKILL);
    expect(parsed).toBeDefined();
    const err = validateSkillMode(parsed!.metadata!, {
      source: LEAKY_SKILL,
    }) as SkillModeValidationError;
    expect(err.code).toBe("literal_secret_rejected");
  });

  it("T1: passes when source omitted (back-compat)", () => {
    const parsed = parseExtendedSkillFrontmatter(LEAKY_SKILL);
    // Without `source` opts, T1 is not run; structural checks pass
    // (it's a valid prompt SKILL).
    expect(validateSkillMode(parsed!.metadata!)).toBeNull();
  });

  it("T1: documented R1 behaviour — single-arg signature is intentionally permissive", () => {
    // Locks in the deferred R1 behaviour (see docs/jiagou/审计-secrets-v1.md
    // §六 R1): the single-arg validateSkillMode(meta) signature does
    // NOT trigger T1 even when the SKILL source clearly contains a
    // literal token. Hosts wanting full literal-secret protection at
    // SKILL-save time MUST pass `{ source }`. This test fails if a
    // future change accidentally enables T1 by default — that would
    // be a breaking semantic change deserving its own commit + bump.
    const parsed = parseExtendedSkillFrontmatter(LEAKY_SKILL);
    const result = validateSkillMode(parsed!.metadata!); // no opts
    expect(result).toBeNull();
  });

  it("T2: documented R1 behaviour — single-arg signature does NOT verify secret_refs", () => {
    // Same R1 lock-in for T2: secret_refs that don't exist are not
    // flagged unless the host passes `{ secretProvider }`.
    const parsed = parseExtendedSkillFrontmatter(REFS_SKILL);
    const result = validateSkillMode(parsed!.metadata!); // no opts
    expect(result).toBeNull();
  });

  it("parses secret_refs from frontmatter", () => {
    const parsed = parseExtendedSkillFrontmatter(REFS_SKILL);
    expect(parsed?.metadata?.secretRefs).toEqual(["openai_default", "github_pat"]);
  });

  it("T2: missing profile rejected when provider supplied", () => {
    const parsed = parseExtendedSkillFrontmatter(REFS_SKILL);
    const provider = {
      hasProfile: (name: string) => name === "openai_default", // github_pat missing
    };
    const err = validateSkillMode(parsed!.metadata!, {
      secretProvider: provider,
    }) as SkillModeValidationError;
    expect(err.code).toBe("missing_secret_profile");
    expect(err.field).toBe("secret_refs[1]");
  });

  it("T2: passes when all profiles registered", () => {
    const parsed = parseExtendedSkillFrontmatter(REFS_SKILL);
    const provider = { hasProfile: () => true };
    expect(
      validateSkillMode(parsed!.metadata!, { secretProvider: provider }),
    ).toBeNull();
  });

  it("T2: not run when provider omitted (back-compat)", () => {
    const parsed = parseExtendedSkillFrontmatter(REFS_SKILL);
    expect(validateSkillMode(parsed!.metadata!)).toBeNull();
  });
});

describe("resolvedSkillMode + normalizeSkillMode", () => {
  it("infers tool mode from tool_schema", () => {
    const meta: ExtendedSkillMetadata = {
      toolSchema: { input: {}, output: {}, steps: [] },
    };
    expect(resolvedSkillMode(meta)).toBe("tool");
  });

  it("defaults to prompt", () => {
    expect(resolvedSkillMode({})).toBe("prompt");
  });

  it("normalizeSkillMode stamps runtime_kind=skill", () => {
    const meta: ExtendedSkillMetadata = {
      skillMode: "agent",
      agentConfig: { roleTitle: "x" },
    };
    normalizeSkillMode(meta);
    expect(meta.agentConfig?.runtimeKind).toBe("skill");
  });
});

describe("AggregatedSkillNodeProvider", () => {
  function entry(
    source: LoadedSkillEntry["source"],
    treeId: string,
    extras: Partial<ExtendedSkillMetadata> = {},
  ): LoadedSkillEntry {
    return {
      source,
      metadata: {
        treeId,
        category: "tools",
        tools: [treeId.split("/").pop() ?? ""],
        ...extras,
      },
    };
  }

  it("source priority workspace > user > managed > extra > bundled", () => {
    expect(sourcePriority("workspace")).toBeGreaterThan(sourcePriority("user"));
    expect(sourcePriority("user")).toBeGreaterThan(sourcePriority("managed"));
    expect(sourcePriority("managed")).toBeGreaterThan(sourcePriority("extra"));
    expect(sourcePriority("extra")).toBeGreaterThan(sourcePriority("bundled"));
  });

  it("higher-priority source wins on tree_id collision", () => {
    const result = aggregateSkillEntries([
      entry("bundled", "tools/x/foo"),
      entry("user", "tools/x/foo", { summary: "user wins" }),
    ]);
    expect(result.sourcesByTreeID.get("tools/x/foo")).toBe("user");
    expect(result.nodes.get("tools/x/foo")?.summary).toBe("user wins");
  });

  it("filters out non-tools categories", () => {
    const result = aggregateSkillEntries([
      entry("bundled", "agents/y/bar", { category: "agents" }),
      entry("bundled", "tools/x/foo"),
    ]);
    expect(result.nodes.size).toBe(1);
    expect(result.nodes.has("tools/x/foo")).toBe(true);
  });

  it("alias-demotes lower-rank tree_id when tool name collides", () => {
    const result = aggregateSkillEntries([
      entry("bundled", "tools/a/echo", { tools: ["echo"] }),
      entry("user", "tools/b/echo", { tools: ["echo"] }),
    ]);
    expect(result.nodes.size).toBe(1);
    expect(result.nodes.has("tools/b/echo")).toBe(true);
    expect(result.aliases.get("tools/a/echo")).toBe("tools/b/echo");
  });

  it("provider caches loadSkillNodes result", () => {
    const provider = new AggregatedSkillNodeProvider([entry("bundled", "tools/x/foo")]);
    const a = provider.loadSkillNodes();
    const b = provider.loadSkillNodes();
    expect(a).toBe(b);
    expect(provider.lastBundledNodeCount()).toBe(1);
  });
});

describe("buildSkillNodeData", () => {
  it("derives name from tools[0] when basename differs", () => {
    const data = buildSkillNodeData({
      treeId: "tools/x/foo",
      tools: ["actual_name"],
    });
    expect(data.name).toBe("actual_name");
    expect(data.bindable).toBe(true);
  });

  it("falls back to description when summary is empty", () => {
    const data = buildSkillNodeData({ treeId: "tools/x/foo", tools: ["foo"] }, "fallback");
    expect(data.summary).toBe("fallback");
  });
});
