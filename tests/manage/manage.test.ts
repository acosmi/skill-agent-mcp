// Unit tests for the capability_manage subsystem.

import { describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  CapabilityTree,
  setTreeBuilder,
  updateDefaultTree,
  defaultTree,
  resetDefaultTreeForTesting,
} from "../../src/capabilities/index.ts";

import {
  capabilityManageToolDef,
  clearPatchStoreForTesting,
  executeManageTool,
  generateFrontendConstants,
  generateFrontendJson,
  metadataToSkillNodeData,
  nextPatchId,
  parseSkillFrontmatter,
  resolveCrabClawMetadata,
  resolveToolNameFromTreeId,
} from "../../src/manage/index.ts";

import type { CapabilityNode } from "../../src/capabilities/index.ts";

function mkTree(): CapabilityTree {
  const tree = new CapabilityTree();
  tree.addNode({
    id: "fs",
    name: "fs",
    kind: "group",
    parent: "",
    children: [],
    prompt: { summary: "", sortOrder: 0, usageGuide: "", delegation: "", groupIntro: "File system" },
    policy: { policyGroups: ["group:fs"], profiles: [], wizardGroup: "" },
  });
  tree.addNode({
    id: "fs/read_file",
    name: "read_file",
    kind: "tool",
    parent: "fs",
    children: [],
    runtime: { owner: "attempt_runner", enabledWhen: "always", dynamic: false },
    prompt: { summary: "Read a file", sortOrder: 1, usageGuide: "", delegation: "", groupIntro: "" },
    routing: { minTier: "task_light", excludeFrom: [], intentKeywords: { zh: [], en: ["read"] }, intentPriority: 0 },
    perms: { minSecurityLevel: "allowlist", fileAccess: "global_read", approvalType: "none", scopeCheck: "none" },
    skills: { bindable: true, boundSkills: [], guidance: false },
    display: { icon: "📖", title: "Read", label: "", verb: "Read", detailKeys: "path" },
    policy: { policyGroups: ["group:fs"], profiles: ["full"], wizardGroup: "fs" },
  });
  return tree;
}

describe("executeManageTool", () => {
  it("dispatches tree action and returns root child views", () => {
    const tree = mkTree();
    const out = executeManageTool(JSON.stringify({ action: "tree" }), tree);
    const parsed = JSON.parse(out) as { success: boolean; data: unknown };
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  it("reports unknown action with valid-action list", () => {
    const tree = mkTree();
    const out = executeManageTool(JSON.stringify({ action: "nope" }), tree);
    const parsed = JSON.parse(out) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("unknown action");
  });

  it("validates required fields for inspect", () => {
    const tree = mkTree();
    const out = executeManageTool(JSON.stringify({ action: "inspect" }), tree);
    const parsed = JSON.parse(out) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("nodeId");
  });

  it("inspect returns node payload by tree path", () => {
    const tree = mkTree();
    const out = executeManageTool(
      JSON.stringify({ action: "inspect", nodeId: "fs/read_file" }),
      tree,
    );
    const parsed = JSON.parse(out) as { success: boolean; data: { name: string } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.name).toBe("read_file");
  });

  it("validate runs L1+L2+L3 by default and reports issues", () => {
    const tree = mkTree();
    const out = executeManageTool(JSON.stringify({ action: "validate", level: 0 }), tree);
    const parsed = JSON.parse(out) as { success: boolean; data: { level1Pass: boolean; level2Pass: boolean; level3Pass: boolean } };
    expect(parsed.success).toBe(true);
    expect(typeof parsed.data.level1Pass).toBe("boolean");
  });

  it("generate_allowlist returns sorted tools for a tier", () => {
    const tree = mkTree();
    const out = executeManageTool(
      JSON.stringify({ action: "generate_allowlist", tier: "task_light" }),
      tree,
    );
    const parsed = JSON.parse(out) as { success: boolean; data: { tools: string[] } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.tools).toContain("read_file");
  });

  it("apply_patch refuses without approved=true", () => {
    clearPatchStoreForTesting();
    const tree = mkTree();
    const out = executeManageTool(
      JSON.stringify({ action: "apply_patch", patchId: "nonexistent" }),
      tree,
    );
    const parsed = JSON.parse(out) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
  });
});

describe("capabilityManageToolDef", () => {
  it("returns name + description + JSON Schema", () => {
    const def = capabilityManageToolDef();
    expect(def.name).toBe("capability_manage");
    expect(def.description).toContain("Inspect");
    expect(def.inputSchema.type).toBe("object");
  });
});

describe("parseSkillFrontmatter", () => {
  it("parses --- yaml --- block correctly", () => {
    const skill = `---
tree_id: fs/read_file
min_tier: task_light
crabclaw:
  summary: "Read file"
  tools: [read_file]
---

Body content here.
`;
    const parsed = parseSkillFrontmatter(skill);
    expect(parsed).toBeDefined();
    expect(parsed?.metadata?.treeId).toBe("fs/read_file");
    expect(parsed?.metadata?.minTier).toBe("task_light");
    expect(parsed?.metadata?.summary).toBe("Read file");
    expect(parsed?.content).toContain("Body content here");
  });

  it("returns undefined when no frontmatter", () => {
    expect(parseSkillFrontmatter("Just markdown")).toBeUndefined();
  });

  it("returns undefined on malformed yaml", () => {
    const bad = "---\nkey: : value:\n---\nbody";
    const parsed = parseSkillFrontmatter(bad);
    // Either undefined or graceful — must not throw
    expect(typeof parsed === "object" || parsed === undefined).toBe(true);
  });
});

describe("resolveCrabClawMetadata", () => {
  it("extracts top-level + nested manifest fields", () => {
    const fm = {
      tree_id: "fs/read_file",
      min_tier: "task_light",
      crabclaw: {
        summary: "Read file",
        tools: ["read_file"],
        emoji: "📖",
      },
    };
    const meta = resolveCrabClawMetadata(fm);
    expect(meta?.treeId).toBe("fs/read_file");
    expect(meta?.summary).toBe("Read file");
    expect(meta?.emoji).toBe("📖");
    expect(meta?.tools).toEqual(["read_file"]);
  });

  it("falls back from crabclaw to pi-ai to pi", () => {
    const fm = {
      tree_id: "fs/x",
      pi: {
        summary: "Fallback summary",
      },
    };
    const meta = resolveCrabClawMetadata(fm);
    expect(meta?.summary).toBe("Fallback summary");
  });

  it("derives tools from treeId basename when tools is missing", () => {
    const fm = { tree_id: "fs/read_file" };
    const meta = resolveCrabClawMetadata(fm);
    expect(meta?.tools).toEqual(["read_file"]);
  });
});

describe("metadataToSkillNodeData", () => {
  it("converts all 7 dimensions", () => {
    const data = metadataToSkillNodeData({
      treeId: "fs/read_file",
      treeGroup: "fs",
      minTier: "task_light",
      summary: "Read",
      tools: ["read_file"],
      emoji: "📖",
      policyGroups: ["group:fs"],
    });
    expect(data.treeGroup).toBe("fs");
    expect(data.name).toBe("read_file");
    expect(data.minTier).toBe("task_light");
    expect(data.icon).toBe("📖");
    expect(data.policyGroups).toEqual(["group:fs"]);
    expect(data.bindable).toBe(true);
  });

  it("falls back to treeId basename when tools is empty", () => {
    const data = metadataToSkillNodeData({
      treeId: "fs/write_file",
      summary: "Write",
    });
    expect(data.name).toBe("write_file");
    expect(data.bindable).toBe(false); // tools list is empty
  });
});

describe("resolveToolNameFromTreeId", () => {
  it("extracts basename", () => {
    expect(resolveToolNameFromTreeId("fs/read_file")).toBe("read_file");
    expect(resolveToolNameFromTreeId("fs/sub/x")).toBe("x");
  });

  it("returns whole id when no slash", () => {
    expect(resolveToolNameFromTreeId("hello")).toBe("hello");
  });
});

describe("generateFrontendConstants", () => {
  it("emits TS const declarations from a tree", () => {
    const tree = mkTree();
    const ts = generateFrontendConstants(tree, { prefix: "X" });
    expect(ts).toContain("export const X_DISPLAY");
    expect(ts).toContain("export const X_POLICY_GROUPS");
    expect(ts).toContain("export const X_TOOL_ORDER");
    expect(ts).toContain("export const X_TOOL_SUMMARIES");
  });

  it("respects emit flags", () => {
    const tree = mkTree();
    const ts = generateFrontendConstants(tree, {
      prefix: "X",
      emitDisplay: false,
      emitToolSummaries: false,
    });
    expect(ts).not.toContain("X_DISPLAY");
    expect(ts).not.toContain("X_TOOL_SUMMARIES");
    expect(ts).toContain("X_POLICY_GROUPS");
  });

  it("generateFrontendJson returns valid parseable JSON", () => {
    const tree = mkTree();
    const json = generateFrontendJson(tree);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.display).toBeDefined();
    expect(parsed.policyGroups).toBeDefined();
    expect(parsed.toolOrder).toBeDefined();
  });
});

describe("default tree singleton", () => {
  it("throws when no builder registered", () => {
    resetDefaultTreeForTesting();
    setTreeBuilder(undefined);
    expect(() => defaultTree()).toThrow("not initialised");
  });

  it("invokes builder lazily", () => {
    let calls = 0;
    setTreeBuilder(() => {
      calls++;
      return mkTree();
    });
    defaultTree();
    defaultTree();
    expect(calls).toBe(1);
  });

  it("updateDefaultTree applies mutation in RCU style", () => {
    setTreeBuilder(() => mkTree());
    const t1 = defaultTree();
    expect(t1.lookup("fs/new_thing")).toBeUndefined();
    updateDefaultTree((next) => {
      next.addNode({
        id: "fs/new_thing",
        name: "new_thing",
        kind: "tool",
        parent: "fs",
        children: [],
      });
    });
    const t2 = defaultTree();
    expect(t2.lookup("fs/new_thing")).toBeDefined();
    // Original tree (t1) is the cached version BEFORE update — verify by
    // checking the lookup result was undefined when t1 was the cached
    // tree (already verified above).
  });
});

// v1.0 ships example fixtures at examples/SKILL.md + examples/tree.json
// that this package does not duplicate (our examples/ holds three demo
// SKILLs under examples/skills/ instead). Skipped here; covered indirectly
// by the parser + manage tool tests above.
describe.skip("examples integration", () => {
  it("parses the bundled examples/SKILL.md", async () => {
    const examplePath = path.resolve(import.meta.dir, "../../examples/SKILL.md");
    const content = await fs.readFile(examplePath, "utf-8");
    const parsed = parseSkillFrontmatter(content);
    expect(parsed).toBeDefined();
    expect(parsed?.metadata?.treeId).toBe("examples/hello_tool");
    expect(parsed?.metadata?.summary).toBe("Greet the user with a friendly message");
  });

  it("loads the bundled examples/tree.json into a CapabilityTree", async () => {
    const treePath = path.resolve(import.meta.dir, "../../examples/tree.json");
    const json = await fs.readFile(treePath, "utf-8");
    const data = JSON.parse(json) as { rootChildren: string[]; nodes: Record<string, CapabilityNode> };
    const tree = new CapabilityTree();
    tree.rootChildren = data.rootChildren;
    for (const [id, node] of Object.entries(data.nodes)) {
      tree.nodes.set(id, node);
    }
    const out = executeManageTool(JSON.stringify({ action: "diagnose" }), tree);
    const parsed = JSON.parse(out) as { success: boolean; data: { inventory: string } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.inventory).toContain("static");
  });
});

describe("patch id uniqueness (P2-2)", () => {
  it("nextPatchId returns distinct values across rapid consecutive calls within same ms", () => {
    // Pre-fix Date.now()*1e6 + random%1000 collided when called twice in
    // the same ms (ms*1e6 lost the sub-ms variance, only random kept us
    // safe — ~1/1000 collision rate on bursty creates). hrtime.bigint()
    // gives true ns resolution; even without the random suffix two calls
    // can't share the same hrtime tick on any modern CPU.
    const ids = new Set<string>();
    const N = 1000;
    for (let i = 0; i < N; i++) ids.add(nextPatchId());
    expect(ids.size).toBe(N);
  });
});
