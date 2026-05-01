// Unit tests for the capabilities subsystem.
// Translated from crabclaw capability_tree_test.go's tests that don't
// depend on generateTreeFromRegistry.

import { describe, expect, it } from "bun:test";
import {
  CapabilityTree,
  buildNodeFromSkillData,
  dedup,
  getSkillKeywordProvider,
  getSkillNodeProvider,
  injectSkillKeywords,
  injectSkillNodes,
  isTreeConstructing,
  lastInjectedSkillNodeCount,
  mergeKeywords,
  mergeNodeData,
  registerSkillKeywordProvider,
  registerSkillNodeProvider,
  registerSubAgentTree,
  resetSubAgentTreeRegistryForTesting,
  setTreeConstructing,
  subAgentTreeFor,
  tierIndex,
  type CapabilityNode,
  type IntentKeywords,
  type SkillKeywordProvider,
  type SkillNodeData,
  type SkillNodeProvider,
  type SubAgentToolDef,
  type SubAgentToolProvider,
} from "../../src/capabilities/index.ts";

// ── Helpers ────────────────────────────────────────────────────────────

function mkTool(
  id: string,
  name: string,
  parent: string,
  opts: Partial<CapabilityNode> = {},
): CapabilityNode {
  return { id, name, kind: "tool", parent, children: [], ...opts };
}

function mkGroup(
  id: string,
  name: string,
  parent: string = "",
  opts: Partial<CapabilityNode> = {},
): CapabilityNode {
  return { id, name, kind: "group", parent, children: [], ...opts };
}

function mkSubagent(
  id: string,
  name: string,
  parent: string,
  opts: Partial<CapabilityNode> = {},
): CapabilityNode {
  return { id, name, kind: "subagent", parent, children: [], ...opts };
}

function makeEmptySkillNodeData(
  treeGroup: string,
  opts: Partial<SkillNodeData> = {},
): SkillNodeData {
  return {
    treeGroup,
    name: "",
    enabledWhen: "",
    summary: "",
    sortOrder: 0,
    usageGuide: "",
    intentHints: {},
    minTier: "",
    excludeFrom: [],
    intentPriority: 0,
    minSecurityLevel: "",
    fileAccess: "",
    approvalType: "",
    scopeCheck: "",
    bindable: false,
    icon: "",
    title: "",
    label: "",
    verb: "",
    detailKeys: "",
    policyGroups: [],
    profiles: [],
    wizardGroup: "",
    toolInputSchema: null,
    toolDescription: "",
    ...opts,
  };
}

/**
 * Builds a small representative tree without generateTreeFromRegistry.
 *
 * Layout (15 nodes total):
 *   fs (group)
 *     ├─ read_file (tool, task_light)
 *     └─ write_file (tool, task_write, intent_priority=10, excludeFrom=[task_delete])
 *   runtime (group)
 *     └─ bash (tool, task_light, intent_priority=30, intent_keywords zh/en/patterns)
 *   ui (group)
 *     └─ browser (tool, task_light)
 *   dynamic (group)
 *     ├─ remote_mcp (group, dynamic, prefix="remote_")
 *     └─ local_mcp (group, dynamic, prefix="mcp_")
 *   subagents (group)
 *     └─ spawn_agent (subagent, task_write, excludeFrom=[task_delete])
 *   subagent_trees (group)
 *     └─ media (group)
 *         └─ trending_topics (tool, scope="media")
 */
function buildSampleTree(): CapabilityTree {
  const tree = new CapabilityTree();

  tree.addNode(mkGroup("fs", "fs"));
  tree.addNode(mkTool("fs/read_file", "read_file", "fs", {
    runtime: { owner: "attempt_runner", enabledWhen: "always", dynamic: false },
    prompt: { summary: "Read file contents", sortOrder: 2, usageGuide: "", delegation: "", groupIntro: "" },
    routing: { minTier: "task_light", excludeFrom: [], intentKeywords: { zh: ["读取"], en: ["read"] }, intentPriority: 0 },
    skills: { bindable: true, boundSkills: [], guidance: false },
    display: { icon: "📖", title: "Read File", label: "", verb: "Read", detailKeys: "path" },
    policy: { policyGroups: ["group:fs"], profiles: ["coding"], wizardGroup: "fs" },
  }));
  tree.addNode(mkTool("fs/write_file", "write_file", "fs", {
    runtime: { owner: "attempt_runner", enabledWhen: "always", dynamic: false },
    prompt: { summary: "Create or overwrite files", sortOrder: 3, usageGuide: "", delegation: "", groupIntro: "" },
    routing: { minTier: "task_write", excludeFrom: ["task_delete"], intentKeywords: { zh: ["写入", "创建"], en: ["write", "create"] }, intentPriority: 10 },
    skills: { bindable: true, boundSkills: [], guidance: false },
    display: { icon: "✍️", title: "Write File", label: "", verb: "Write", detailKeys: "path" },
    policy: { policyGroups: ["group:fs"], profiles: ["coding"], wizardGroup: "fs" },
  }));

  tree.addNode(mkGroup("runtime", "runtime"));
  tree.addNode(mkTool("runtime/bash", "bash", "runtime", {
    runtime: { owner: "attempt_runner", enabledWhen: "always", dynamic: false },
    prompt: {
      summary: "Execute bash commands",
      sortOrder: 1,
      usageGuide: "",
      delegation: "",
      groupIntro: "",
      intentHints: { task_delete: "use bash with care" },
    },
    routing: {
      minTier: "task_light",
      excludeFrom: [],
      intentKeywords: { zh: ["删除"], en: ["delete", "rm"], patterns: ["rm {file}"] },
      intentPriority: 30,
    },
    skills: { bindable: true, boundSkills: [], guidance: false },
    policy: { policyGroups: ["group:runtime"], profiles: ["full"], wizardGroup: "runtime" },
  }));

  tree.addNode(mkGroup("ui", "ui"));
  tree.addNode(mkTool("ui/browser", "browser", "ui", {
    runtime: { owner: "attempt_runner", enabledWhen: "BrowserController != nil", dynamic: false },
    prompt: { summary: "Control web browser via CDP", sortOrder: 10, usageGuide: "", delegation: "", groupIntro: "" },
    routing: { minTier: "task_light", excludeFrom: [], intentKeywords: { zh: [], en: [] }, intentPriority: 0 },
    skills: { bindable: true, boundSkills: [], guidance: false },
    policy: { policyGroups: ["group:ui"], profiles: ["full"], wizardGroup: "" },
  }));

  tree.addNode(mkGroup("dynamic", "dynamic"));
  tree.addNode(mkGroup("dynamic/remote_mcp", "remote_mcp", "dynamic", {
    runtime: {
      owner: "attempt_runner",
      enabledWhen: "RemoteMCPBridge != nil",
      dynamic: true,
      namePrefix: "remote_",
      discoverySource: "RemoteMCPBridge.AgentRemoteTools()",
      listMethod: "AgentRemoteTools",
      providerId: "remote_mcp",
    },
  }));
  tree.addNode(mkGroup("dynamic/local_mcp", "local_mcp", "dynamic", {
    runtime: {
      owner: "attempt_runner",
      enabledWhen: "LocalMCPBridge != nil",
      dynamic: true,
      namePrefix: "mcp_",
      discoverySource: "LocalMCPBridge.AgentTools()",
      listMethod: "AgentTools",
      providerId: "local_mcp",
    },
  }));

  tree.addNode(mkGroup("subagents", "subagents"));
  tree.addNode(mkSubagent("subagents/spawn_agent", "spawn_agent", "subagents", {
    runtime: { owner: "attempt_runner", enabledWhen: "always", dynamic: false },
    prompt: { summary: "Spawn skill-driven sub-agent", sortOrder: 17, usageGuide: "", delegation: "Delegate to skill agents", groupIntro: "" },
    routing: { minTier: "task_write", excludeFrom: ["task_delete"], intentKeywords: { zh: ["派生"], en: ["spawn"] }, intentPriority: 0 },
    skills: { bindable: true, boundSkills: [], guidance: false },
  }));

  tree.addNode(mkGroup("subagent_trees", "subagent_trees"));
  tree.addNode(mkGroup("subagent_trees/media", "media", "subagent_trees"));
  tree.addNode(mkTool("subagent_trees/media/trending_topics", "trending_topics", "subagent_trees/media", {
    runtime: { owner: "media_subsystem", enabledWhen: "MediaSubsystem != nil", dynamic: false, subagentScope: "media" },
    prompt: { summary: "Discover trending topics", sortOrder: 100, usageGuide: "", delegation: "", groupIntro: "" },
    routing: { minTier: "task_light", excludeFrom: [], intentKeywords: { zh: [], en: [] }, intentPriority: 0 },
    skills: { bindable: false, boundSkills: [], guidance: false },
  }));

  return tree;
}

// ── CapabilityTree basic operations ──────────────────────────────────

describe("CapabilityTree basic operations", () => {
  it("addNode adds a root node", () => {
    const tree = new CapabilityTree();
    tree.addNode(mkGroup("fs", "fs"));
    expect(tree.lookup("fs")).toBeDefined();
    expect(tree.rootChildren).toContain("fs");
  });

  it("addNode adds a child under existing parent", () => {
    const tree = new CapabilityTree();
    tree.addNode(mkGroup("fs", "fs"));
    tree.addNode(mkTool("fs/read_file", "read_file", "fs"));
    expect(tree.lookup("fs")?.children).toContain("fs/read_file");
  });

  it("addNode rejects empty IDs", () => {
    const tree = new CapabilityTree();
    expect(() => tree.addNode(mkTool("", "x", ""))).toThrow("must not be empty");
  });

  it("addNode rejects duplicate IDs", () => {
    const tree = new CapabilityTree();
    tree.addNode(mkGroup("fs", "fs"));
    expect(() => tree.addNode(mkGroup("fs", "fs2"))).toThrow("duplicate");
  });

  it("addNode rolls back on missing parent (TS divergence from Go)", () => {
    const tree = new CapabilityTree();
    expect(() => tree.addNode(mkTool("orphan/x", "x", "orphan"))).toThrow("not found");
    // Verify the just-inserted node was removed (Go original would leak it).
    expect(tree.lookup("orphan/x")).toBeUndefined();
  });

  it("removeNode removes a leaf and updates parent's children", () => {
    const tree = new CapabilityTree();
    tree.addNode(mkGroup("fs", "fs"));
    tree.addNode(mkTool("fs/read_file", "read_file", "fs"));
    tree.removeNode("fs/read_file");
    expect(tree.lookup("fs/read_file")).toBeUndefined();
    expect(tree.lookup("fs")?.children).not.toContain("fs/read_file");
  });

  it("removeNode recursively removes group and descendants", () => {
    const tree = new CapabilityTree();
    tree.addNode(mkGroup("fs", "fs"));
    tree.addNode(mkTool("fs/a", "a", "fs"));
    tree.addNode(mkTool("fs/b", "b", "fs"));
    tree.removeNode("fs");
    expect(tree.lookup("fs")).toBeUndefined();
    expect(tree.lookup("fs/a")).toBeUndefined();
    expect(tree.lookup("fs/b")).toBeUndefined();
    expect(tree.rootChildren).not.toContain("fs");
  });

  it("removeNode throws on unknown ID", () => {
    const tree = new CapabilityTree();
    expect(() => tree.removeNode("unknown")).toThrow("not found");
  });

  it("lookup returns the node by ID", () => {
    const tree = buildSampleTree();
    expect(tree.lookup("fs/read_file")?.name).toBe("read_file");
  });

  it("lookupByName returns the first match", () => {
    const tree = buildSampleTree();
    expect(tree.lookupByName("read_file")?.id).toBe("fs/read_file");
  });

  it("lookupByToolHint excludes group nodes", () => {
    const tree = buildSampleTree();
    expect(tree.lookupByToolHint("read_file")?.kind).toBe("tool");
    expect(tree.lookupByToolHint("fs")).toBeUndefined();
  });

  it("walk visits in deterministic ID order", () => {
    const tree = buildSampleTree();
    const visited: string[] = [];
    tree.walk((n) => { visited.push(n.id); return true; });
    const sorted = [...visited].sort();
    expect(visited).toEqual(sorted);
  });

  it("walk stops early when fn returns false", () => {
    const tree = buildSampleTree();
    let count = 0;
    tree.walk(() => { count++; return count < 3; });
    expect(count).toBe(3);
  });

  it("walkSubtree visits depth-first from a root", () => {
    const tree = buildSampleTree();
    const visited: string[] = [];
    tree.walkSubtree("fs", (n) => { visited.push(n.id); return true; });
    expect(visited[0]).toBe("fs");
    expect(visited).toContain("fs/read_file");
    expect(visited).toContain("fs/write_file");
  });

  it("nodeCount returns total node count", () => {
    const tree = buildSampleTree();
    expect(tree.nodeCount()).toBe(15);
  });

  it("clone produces a deep copy independent of source", () => {
    const tree = buildSampleTree();
    const copy = tree.clone();
    const original = tree.lookup("fs/read_file");
    const cloned = copy.lookup("fs/read_file");

    expect(cloned).toBeDefined();
    expect(cloned).not.toBe(original);
    if (cloned !== undefined && cloned.policy !== undefined) {
      cloned.policy.policyGroups.push("group:mutated");
    }
    expect(original?.policy?.policyGroups).toEqual(["group:fs"]);
  });
});

// ── Derivation methods ────────────────────────────────────────────────

describe("CapabilityTree derivation methods", () => {
  it("tierIndex returns position for valid tier", () => {
    expect(tierIndex("greeting")).toBe(0);
    expect(tierIndex("task_multimodal")).toBe(5);
  });

  it("tierIndex returns -1 for invalid tier", () => {
    expect(tierIndex("nonexistent")).toBe(-1);
  });

  it("allStaticTools sorts and excludes dynamic groups + subagent-scoped", () => {
    const tree = buildSampleTree();
    const tools = tree.allStaticTools();
    expect(tools).toEqual(["bash", "browser", "read_file", "spawn_agent", "write_file"]);
    expect(tools).not.toContain("trending_topics"); // subagent-scoped
  });

  it("allTools also excludes only subagent-scoped", () => {
    const tree = buildSampleTree();
    const tools = tree.allTools();
    expect(tools).toContain("bash");
    expect(tools).not.toContain("trending_topics");
  });

  it("dynamicGroups returns only groups with runtime.dynamic=true", () => {
    const tree = buildSampleTree();
    const names = tree.dynamicGroups().map((g) => g.name).sort();
    expect(names).toEqual(["local_mcp", "remote_mcp"]);
  });

  it("dynamicGroupPrefixes returns sorted prefix list", () => {
    const tree = buildSampleTree();
    expect(tree.dynamicGroupPrefixes()).toEqual(["mcp_", "remote_"]);
  });

  it("toolsForTier respects minTier escalation", () => {
    const tree = buildSampleTree();
    const questionAllowed = tree.toolsForTier("question").map((n) => n.name);
    // bash minTier=task_light is above question
    expect(questionAllowed).not.toContain("bash");

    const lightAllowed = tree.toolsForTier("task_light").map((n) => n.name);
    expect(lightAllowed).toContain("bash");
    expect(lightAllowed).toContain("read_file");
  });

  it("toolsForTier respects excludeFrom", () => {
    const tree = buildSampleTree();
    const deleteAllowed = tree.toolsForTier("task_delete").map((n) => n.name);
    // write_file has minTier=task_write but excludeFrom=[task_delete]
    expect(deleteAllowed).not.toContain("write_file");
    expect(deleteAllowed).not.toContain("spawn_agent");
  });

  it("toolsForTier returns empty for invalid tier", () => {
    const tree = buildSampleTree();
    expect(tree.toolsForTier("invalid")).toEqual([]);
  });

  it("allowlistForTier returns name set", () => {
    const tree = buildSampleTree();
    const allowed = tree.allowlistForTier("task_light");
    expect(allowed.get("bash")).toBe(true);
    expect(allowed.has("nonexistent")).toBe(false);
  });

  it("bindableTools returns sorted bindable names (excludes scoped)", () => {
    const tree = buildSampleTree();
    const bindable = tree.bindableTools();
    expect(bindable).toContain("bash");
    expect(bindable).toContain("read_file");
    expect(bindable).toEqual([...bindable].sort());
    expect(bindable).not.toContain("trending_topics");
  });

  it("toolSummaries excludes group + subagent-scoped", () => {
    const tree = buildSampleTree();
    const summaries = tree.toolSummaries();
    expect(summaries.has("read_file")).toBe(true);
    expect(summaries.has("trending_topics")).toBe(false);
    expect(summaries.has("fs")).toBe(false);
  });

  it("sortedToolSummaries sorts by sortOrder asc", () => {
    const tree = buildSampleTree();
    const orders = tree.sortedToolSummaries().map((e) => e.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("scopedToolSummaries includes scoped + unscoped", () => {
    const tree = buildSampleTree();
    const media = tree.scopedToolSummaries("media");
    expect(media.has("trending_topics")).toBe(true);
    // unscoped tools also visible
    expect(media.has("read_file")).toBe(true);
  });

  it("policyGroups maps group → sorted member names", () => {
    const tree = buildSampleTree();
    const groups = tree.policyGroups();
    expect(groups.get("group:fs")).toEqual(["read_file", "write_file"]);
    expect(groups.get("group:runtime")).toEqual(["bash"]);
  });

  it("displaySpecs returns tools with display metadata", () => {
    const tree = buildSampleTree();
    expect(tree.displaySpecs().get("read_file")?.icon).toBe("📖");
  });

  it("wizardGroups maps wizardGroup → sorted member names", () => {
    const tree = buildSampleTree();
    expect(tree.wizardGroups().get("fs")).toEqual(["read_file", "write_file"]);
  });

  it("intentKeywordsForTier deduplicates across tools", () => {
    const tree = buildSampleTree();
    const kws = tree.intentKeywordsForTier("task_write");
    expect(kws.zh).toContain("写入");
    expect(kws.en).toContain("write");
    expect(new Set(kws.zh).size).toBe(kws.zh.length);
    expect(new Set(kws.en).size).toBe(kws.en.length);
  });

  it("classificationKeywords filters by intentPriority + tier mapping", () => {
    const tree = buildSampleTree();
    // bash intentPriority=30 → task_delete
    const deleteKws = tree.classificationKeywords("task_delete");
    expect(deleteKws).toContain("删除");
    expect(deleteKws).toContain("delete");
    // write_file intentPriority=10 → task_write
    const writeKws = tree.classificationKeywords("task_write");
    expect(writeKws).toContain("写入");
  });

  it("classificationPatterns extracts patterns at correct tier", () => {
    const tree = buildSampleTree();
    expect(tree.classificationPatterns("task_delete")).toContain("rm {file}");
  });

  it("matchesDynamicGroup returns the matching group", () => {
    const tree = buildSampleTree();
    expect(tree.matchesDynamicGroup("remote_calendar")?.name).toBe("remote_mcp");
    expect(tree.matchesDynamicGroup("mcp_filesystem")?.name).toBe("local_mcp");
    expect(tree.matchesDynamicGroup("bash")).toBeUndefined();
  });

  it("toolsForAgentScope returns scope-matching tools sorted by name", () => {
    const tree = buildSampleTree();
    const tools = tree.toolsForAgentScope("media").map((n) => n.name);
    expect(tools).toEqual(["trending_topics"]);
  });

  it("toolsForAgentScope returns empty for unknown scope", () => {
    const tree = buildSampleTree();
    expect(tree.toolsForAgentScope("unknown")).toEqual([]);
  });

  it("toRegistry converts tools+subagents to flat CapabilitySpec list", () => {
    const tree = buildSampleTree();
    const specs = tree.toRegistry();
    const bash = specs.find((s) => s.toolName === "bash");
    expect(bash?.kind).toBe("tool");
    expect(bash?.runtimeOwner).toBe("attempt_runner");
    expect(bash?.skillBindable).toBe(true);

    const spawn = specs.find((s) => s.toolName === "spawn_agent");
    expect(spawn?.kind).toBe("subagent_entry");

    // groups not in registry
    expect(specs.find((s) => s.toolName === "fs")).toBeUndefined();
  });
});

// ── Skill providers ──────────────────────────────────────────────────

describe("Skill providers", () => {
  it("registerSkillKeywordProvider sets and getSkillKeywordProvider returns", () => {
    const provider: SkillKeywordProvider = {
      loadSkillKeywords: () => new Map(),
    };
    registerSkillKeywordProvider(provider);
    expect(getSkillKeywordProvider()).toBe(provider);
  });

  it("registerSkillNodeProvider + getSkillNodeProvider", () => {
    const provider: SkillNodeProvider = {
      loadSkillNodes: () => new Map(),
    };
    registerSkillNodeProvider(provider);
    expect(getSkillNodeProvider()).toBe(provider);
  });

  it("injectSkillNodes overrides existing node fields", () => {
    const tree = new CapabilityTree();
    tree.addNode(mkGroup("fs", "fs"));
    tree.addNode(mkTool("fs/read_file", "read_file", "fs", {
      prompt: { summary: "old", sortOrder: 0, usageGuide: "", delegation: "", groupIntro: "" },
    }));
    const data = makeEmptySkillNodeData("fs", { summary: "new from skill", minTier: "task_light" });
    registerSkillNodeProvider({
      loadSkillNodes: () => new Map([["fs/read_file", data]]),
    });
    injectSkillNodes(tree);
    expect(tree.lookup("fs/read_file")?.prompt?.summary).toBe("new from skill");
    expect(tree.lookup("fs/read_file")?.routing?.minTier).toBe("task_light");
  });

  it("injectSkillNodes creates new node when not present", () => {
    const tree = new CapabilityTree();
    tree.addNode(mkGroup("fs", "fs"));
    const data = makeEmptySkillNodeData("fs", { summary: "fresh tool" });
    registerSkillNodeProvider({
      loadSkillNodes: () => new Map([["fs/new_tool", data]]),
    });
    injectSkillNodes(tree);
    const node = tree.lookup("fs/new_tool");
    expect(node).toBeDefined();
    expect(node?.runtime?.owner).toBe("attempt_runner"); // default
    expect(node?.parent).toBe("fs");
  });

  it("injectSkillNodes warns and skips when parent group missing", () => {
    const tree = new CapabilityTree();
    const data = makeEmptySkillNodeData("missing-parent", { summary: "x" });
    registerSkillNodeProvider({
      loadSkillNodes: () => new Map([["missing-parent/x", data]]),
    });
    injectSkillNodes(tree);
    expect(tree.lookup("missing-parent/x")).toBeUndefined();
  });

  it("injectSkillKeywords merges into existing routing", () => {
    const tree = new CapabilityTree();
    tree.addNode(mkGroup("fs", "fs"));
    tree.addNode(mkTool("fs/read_file", "read_file", "fs", {
      routing: { minTier: "task_light", excludeFrom: [], intentKeywords: { zh: ["读"], en: ["read"] }, intentPriority: 0 },
    }));
    registerSkillKeywordProvider({
      loadSkillKeywords: () => new Map([["fs/read_file", { zh: ["浏览"], en: ["view"] }]]),
    });
    injectSkillKeywords(tree);
    const kws = tree.lookup("fs/read_file")?.routing?.intentKeywords;
    expect(kws?.zh).toContain("浏览");
    expect(kws?.zh).toContain("读");
    expect(kws?.en).toContain("view");
    expect(kws?.en).toContain("read");
  });

  it("mergeNodeData preserves zero-value fields (fallback intact)", () => {
    const node: CapabilityNode = mkTool("x/y", "y", "x", {
      prompt: { summary: "old", sortOrder: 5, usageGuide: "", delegation: "", groupIntro: "" },
    });
    const data = makeEmptySkillNodeData("x");
    mergeNodeData(node, data);
    expect(node.prompt?.summary).toBe("old");
    expect(node.prompt?.sortOrder).toBe(5);
  });

  it("mergeNodeData overrides for non-zero values", () => {
    const node: CapabilityNode = mkTool("x/y", "y", "x");
    mergeNodeData(node, makeEmptySkillNodeData("x", { summary: "new", icon: "🔥" }));
    expect(node.prompt?.summary).toBe("new");
    expect(node.display?.icon).toBe("🔥");
  });

  it("buildNodeFromSkillData defaults runtime.owner to attempt_runner", () => {
    const data = makeEmptySkillNodeData("fs", { summary: "x" });
    const node = buildNodeFromSkillData("fs/new", data);
    expect(node.runtime?.owner).toBe("attempt_runner");
  });

  it("buildNodeFromSkillData extracts name from treeId basename, name override wins", () => {
    expect(buildNodeFromSkillData("fs/read_file", makeEmptySkillNodeData("fs")).name).toBe("read_file");
    expect(buildNodeFromSkillData("fs/read_file", makeEmptySkillNodeData("fs", { name: "custom" })).name).toBe("custom");
  });

  it("mergeKeywords prepends skill keywords + dedups", () => {
    const merged = mergeKeywords(
      { zh: ["新", "重复"], en: [] },
      { zh: ["旧", "重复"], en: ["en"] },
    );
    expect(merged.zh).toEqual(["新", "重复", "旧"]);
    expect(merged.en).toEqual(["en"]);
  });

  it("mergeKeywords preserves tree fallback when skill empty", () => {
    const merged = mergeKeywords(
      { zh: [], en: [] },
      { zh: ["旧"], en: ["en"] },
    );
    expect(merged.zh).toEqual(["旧"]);
  });

  it("mergeKeywords merges patterns when skill has them", () => {
    const merged = mergeKeywords(
      { zh: [], en: [], patterns: ["pat1"] },
      { zh: [], en: [], patterns: ["pat2"] },
    );
    expect(merged.patterns).toEqual(["pat1", "pat2"]);
  });

  it("dedup removes duplicates and empty strings preserving order", () => {
    expect(dedup(["a", "b", "a", "", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("setTreeConstructing toggles isTreeConstructing", () => {
    setTreeConstructing(true);
    expect(isTreeConstructing()).toBe(true);
    setTreeConstructing(false);
    expect(isTreeConstructing()).toBe(false);
  });

  it("lastInjectedSkillNodeCount reports last load size", () => {
    registerSkillNodeProvider({
      loadSkillNodes: () => new Map([
        ["fs/a", makeEmptySkillNodeData("fs", { summary: "a" })],
        ["fs/b", makeEmptySkillNodeData("fs", { summary: "b" })],
      ]),
    });
    const tree = new CapabilityTree();
    tree.addNode(mkGroup("fs", "fs"));
    injectSkillNodes(tree);
    expect(lastInjectedSkillNodeCount()).toBe(2);
  });
});

// ── SubAgent registry ──────────────────────────────────────────────────

describe("SubAgent registry", () => {
  function makeProvider(agentType: string): SubAgentToolProvider {
    return {
      agentType: () => agentType,
      subTreeGroupId: () => `subagent_trees/${agentType}`,
      toolDefs: (): SubAgentToolDef[] => [],
      executeTool: async () => "",
    };
  }

  it("subAgentTreeFor returns undefined before registration", () => {
    resetSubAgentTreeRegistryForTesting();
    expect(subAgentTreeFor("media")).toBeUndefined();
  });

  it("registerSubAgentTree + subAgentTreeFor returns provider", () => {
    resetSubAgentTreeRegistryForTesting();
    const provider = makeProvider("media");
    registerSubAgentTree(provider);
    expect(subAgentTreeFor("media")).toBe(provider);
  });

  it("subAgentTreeFor returns undefined for unknown type", () => {
    resetSubAgentTreeRegistryForTesting();
    registerSubAgentTree(makeProvider("media"));
    expect(subAgentTreeFor("unknown")).toBeUndefined();
  });

  it("resetSubAgentTreeRegistryForTesting clears registry", () => {
    registerSubAgentTree(makeProvider("media"));
    resetSubAgentTreeRegistryForTesting();
    expect(subAgentTreeFor("media")).toBeUndefined();
  });
});
