// CapabilityTree class translated from
// crabclaw/backend/internal/agents/capabilities/capability_tree.go.
//
// commit 2: data structure + basic ops (clone, walk, lookup family).
// commit 3: derivation methods (D1-D9 pipelines from the Go original) +
// module-level helpers (tierIndex). Sub-agent registry, providers, and
// SKILL.md injection live in subagent-tree.ts and providers.ts respectively.

import type {
  CapabilityNode,
  CapabilitySpec,
  IntentKeywords,
  NodeDisplay,
  ToolSummaryEntry,
} from "./types.ts";
import { INTENT_PRIORITY_TO_TIER, VALID_TIERS } from "./types.ts";

/**
 * The top-level container holding all capability nodes. It provides lookup,
 * traversal, and derivation methods.
 *
 * The tree replaces a flat array of CapabilitySpec with a hierarchy carrying
 * Runtime / Prompt / Routing / Permissions / SkillBinding / Display / Policy
 * metadata. All downstream consumers (prompt builder, intent router, tool
 * policy, display config, skill binding, frontend mirrors) derive from this
 * tree via derivation pipelines.
 */
export class CapabilityTree {
  /** Flat index of all nodes keyed by ID. */
  readonly nodes: Map<string, CapabilityNode>;

  /** Top-level node IDs (direct children of the virtual root). */
  rootChildren: string[];

  constructor() {
    this.nodes = new Map();
    this.rootChildren = [];
  }

  // ── Basic tree operations ──────────────────────────────────────────────

  /**
   * Inserts a node into the tree, updating parent/child links. Throws on
   * duplicate IDs or missing parent. On parent-missing failure the
   * just-inserted node is rolled back so the tree stays consistent.
   */
  addNode(node: CapabilityNode): void {
    if (node.id === "") {
      throw new Error("node ID must not be empty");
    }
    if (this.nodes.has(node.id)) {
      throw new Error(`duplicate node ID: ${node.id}`);
    }

    this.nodes.set(node.id, node);

    if (node.parent === "") {
      this.rootChildren.push(node.id);
      return;
    }

    const parent = this.nodes.get(node.parent);
    if (parent === undefined) {
      this.nodes.delete(node.id);
      throw new Error(
        `parent node "${node.parent}" not found for "${node.id}"`,
      );
    }
    parent.children.push(node.id);
  }

  /**
   * Removes a node from the tree, updating parent/child links. If the node
   * is a group, all descendants are recursively removed first.
   */
  removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (node === undefined) {
      throw new Error(`node "${id}" not found`);
    }
    for (const childId of [...node.children]) {
      this.removeNode(childId);
    }
    if (node.parent !== "") {
      const parent = this.nodes.get(node.parent);
      if (parent !== undefined) {
        parent.children = parent.children.filter((c) => c !== id);
      }
    } else {
      this.rootChildren = this.rootChildren.filter((c) => c !== id);
    }
    this.nodes.delete(id);
  }

  /** Returns a node by its ID, or undefined. */
  lookup(id: string): CapabilityNode | undefined {
    return this.nodes.get(id);
  }

  /** Returns the first node matching the given name. */
  lookupByName(name: string): CapabilityNode | undefined {
    for (const n of this.nodes.values()) {
      if (n.name === name) return n;
    }
    return undefined;
  }

  /**
   * Returns a tool/subagent node whose name matches toolHint. Used to
   * resolve plan-step tool hints to nodes.
   */
  lookupByToolHint(toolHint: string): CapabilityNode | undefined {
    for (const n of this.nodes.values()) {
      if ((n.kind === "tool" || n.kind === "subagent") && n.name === toolHint) {
        return n;
      }
    }
    return undefined;
  }

  /**
   * Visits every node in deterministic order (sorted by ID). If fn returns
   * false, traversal stops early.
   */
  walk(fn: (node: CapabilityNode) => boolean): void {
    const ids = [...this.nodes.keys()].sort();
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node === undefined) continue;
      if (!fn(node)) return;
    }
  }

  /** Visits a node and all its descendants depth-first. */
  walkSubtree(rootId: string, fn: (node: CapabilityNode) => boolean): void {
    const node = this.nodes.get(rootId);
    if (node === undefined) return;
    if (!fn(node)) return;
    for (const childId of node.children) {
      this.walkSubtree(childId, fn);
    }
  }

  /** Total number of nodes in the tree. */
  nodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Returns a deep copy. Every node and every sub-structure is reallocated
   * so mutations on the returned tree cannot leak into the original; slices
   * inside sub-structures are also copied. Primitive used by the RCU write
   * path (updateDefaultTree, apply_patch, revert_patch — commit 13).
   */
  clone(): CapabilityTree {
    const out = new CapabilityTree();
    out.rootChildren = [...this.rootChildren];
    for (const [id, n] of this.nodes) {
      out.nodes.set(id, cloneNode(n));
    }
    return out;
  }

  // ── Derivation methods (D1-D9 pipelines from capability_tree.go) ───────

  /**
   * Names of all non-dynamic tool and subagent nodes. Sub-agent scoped
   * tools are excluded (use toolsForAgentScope for those).
   */
  allStaticTools(): string[] {
    const names: string[] = [];
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      if (n.runtime?.dynamic) continue;
      if (isSubAgentScoped(n)) continue;
      names.push(n.name);
    }
    names.sort();
    return names;
  }

  /**
   * All tool and subagent names (static + dynamic groups). Sub-agent scoped
   * tools are excluded.
   */
  allTools(): string[] {
    const names: string[] = [];
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      if (isSubAgentScoped(n)) continue;
      names.push(n.name);
    }
    names.sort();
    return names;
  }

  /** Group nodes with runtime.dynamic=true. */
  dynamicGroups(): CapabilityNode[] {
    const groups: CapabilityNode[] = [];
    for (const n of this.nodes.values()) {
      if (n.kind === "group" && n.runtime?.dynamic === true) {
        groups.push(n);
      }
    }
    return groups;
  }

  /** namePrefix values from dynamic groups, sorted. */
  dynamicGroupPrefixes(): string[] {
    const prefixes: string[] = [];
    for (const g of this.dynamicGroups()) {
      const p = g.runtime?.namePrefix;
      if (p !== undefined && p !== "") prefixes.push(p);
    }
    prefixes.sort();
    return prefixes;
  }

  /**
   * All tool/subagent nodes whose minTier <= the given tier. A node with
   * no routing or empty minTier is treated as "task_multimodal" (most
   * restrictive). Sub-agent scoped tools are excluded.
   */
  toolsForTier(tier: string): CapabilityNode[] {
    const requestedIdx = tierIndex(tier);
    if (requestedIdx < 0) return [];
    const result: CapabilityNode[] = [];
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      if (isSubAgentScoped(n)) continue;
      let minTier = "task_multimodal";
      if (n.routing?.minTier !== undefined && n.routing.minTier !== "") {
        minTier = n.routing.minTier;
      }
      const nodeIdx = tierIndex(minTier);
      if (nodeIdx < 0) continue;
      if (nodeIdx > requestedIdx) continue;
      let excluded = false;
      if (n.routing !== undefined) {
        for (const ex of n.routing.excludeFrom) {
          if (ex === tier) { excluded = true; break; }
        }
      }
      if (!excluded) result.push(n);
    }
    return result;
  }

  /** Set of tool names allowed for a given intent tier. */
  allowlistForTier(tier: string): Map<string, boolean> {
    const m = new Map<string, boolean>();
    for (const n of this.toolsForTier(tier)) {
      m.set(n.name, true);
    }
    return m;
  }

  /**
   * Names of all tools with skills.bindable=true. Sub-agent scoped tools
   * are excluded (not available for blueprint/skill binding).
   */
  bindableTools(): string[] {
    const names: string[] = [];
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      if (isSubAgentScoped(n)) continue;
      if (n.skills?.bindable === true) names.push(n.name);
    }
    names.sort();
    return names;
  }

  /**
   * tool name → prompt summary. Used for D1 derivation (## Tooling section).
   * Sub-agent scoped tools are excluded.
   */
  toolSummaries(): Map<string, string> {
    const m = new Map<string, string>();
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      if (isSubAgentScoped(n)) continue;
      if (n.prompt?.summary !== undefined && n.prompt.summary !== "") {
        m.set(n.name, n.prompt.summary);
      }
    }
    return m;
  }

  /**
   * Tool summaries sorted by sortOrder for prompt generation. Sub-agent
   * scoped tools are excluded. Entries are deduplicated by name (keeping
   * the lowest sortOrder when duplicates appear via skill bindings).
   */
  sortedToolSummaries(): ToolSummaryEntry[] {
    const entries: ToolSummaryEntry[] = [];
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      if (isSubAgentScoped(n)) continue;
      const summary = n.prompt?.summary;
      if (summary === undefined || summary === "") continue;
      entries.push({
        name: n.name,
        summary,
        sortOrder: n.prompt?.sortOrder ?? 0,
      });
    }
    return sortAndDedupSummaries(entries);
  }

  /**
   * Tool summaries for a specific sub-agent scope, plus all unscoped
   * (main-agent) tools. Used by sub-agent prompt builders.
   */
  scopedToolSummaries(scope: string): Map<string, string> {
    const m = new Map<string, string>();
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      const summary = n.prompt?.summary;
      if (summary === undefined || summary === "") continue;
      const agentScope = n.runtime?.subagentScope ?? "";
      if (agentScope === "" || agentScope === scope) {
        m.set(n.name, summary);
      }
    }
    return m;
  }

  /**
   * Sorted tool summaries for a specific sub-agent scope, plus all
   * unscoped tools. Used by sub-agent prompt builders.
   */
  scopedSortedToolSummaries(scope: string): ToolSummaryEntry[] {
    const entries: ToolSummaryEntry[] = [];
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      const summary = n.prompt?.summary;
      if (summary === undefined || summary === "") continue;
      const agentScope = n.runtime?.subagentScope ?? "";
      if (agentScope === "" || agentScope === scope) {
        entries.push({
          name: n.name,
          summary,
          sortOrder: n.prompt?.sortOrder ?? 0,
        });
      }
    }
    return sortAndDedupSummaries(entries);
  }

  /**
   * group name → member tool names. Used for D5 derivation (tool_policy).
   * Sub-agent scoped tools are excluded.
   */
  policyGroups(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      if (isSubAgentScoped(n)) continue;
      if (n.policy === undefined) continue;
      for (const pg of n.policy.policyGroups) {
        const arr = groups.get(pg) ?? [];
        arr.push(n.name);
        groups.set(pg, arr);
      }
    }
    for (const [g, members] of groups) {
      members.sort();
      groups.set(g, members);
    }
    return groups;
  }

  /** tool name → NodeDisplay for tools with display metadata. D7 derivation. */
  displaySpecs(): Map<string, NodeDisplay> {
    const m = new Map<string, NodeDisplay>();
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      if (n.display !== undefined) m.set(n.name, n.display);
    }
    return m;
  }

  /**
   * wizardGroup → tool names. D8 derivation (wizard-v2 skill groups).
   * Sub-agent scoped tools are excluded.
   */
  wizardGroups(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      if (isSubAgentScoped(n)) continue;
      const wg = n.policy?.wizardGroup;
      if (wg !== undefined && wg !== "") {
        const arr = groups.get(wg) ?? [];
        arr.push(n.name);
        groups.set(wg, arr);
      }
    }
    for (const [g, members] of groups) {
      members.sort();
      groups.set(g, members);
    }
    return groups;
  }

  /**
   * Aggregates all intent keywords from tools available at a given tier.
   * D4 derivation. Sub-agent scoped tools are excluded via toolsForTier.
   */
  intentKeywordsForTier(tier: string): IntentKeywords {
    const nodes = this.toolsForTier(tier);
    const zhAll: string[] = [];
    const enAll: string[] = [];
    const seen = new Set<string>();
    for (const n of nodes) {
      if (n.routing === undefined) continue;
      for (const kw of n.routing.intentKeywords.zh) {
        const key = "zh:" + kw;
        if (!seen.has(key)) { zhAll.push(kw); seen.add(key); }
      }
      for (const kw of n.routing.intentKeywords.en) {
        const key = "en:" + kw;
        if (!seen.has(key)) { enAll.push(kw); seen.add(key); }
      }
    }
    return { zh: zhAll, en: enAll };
  }

  /**
   * All intent keywords that classify user prompts into the given tier.
   * Only nodes with explicit intentPriority>0 contribute. D4 derivation.
   */
  classificationKeywords(tier: string): string[] {
    const keywords: string[] = [];
    const seen = new Set<string>();
    for (const n of this.nodes.values()) {
      if (n.kind === "group" || n.routing === undefined) continue;
      if (isSubAgentScoped(n)) continue;
      if (n.routing.intentPriority <= 0) continue;
      const classifTier = INTENT_PRIORITY_TO_TIER.get(n.routing.intentPriority);
      if (classifTier === undefined || classifTier !== tier) continue;
      for (const k of n.routing.intentKeywords.zh) {
        if (!seen.has(k)) { keywords.push(k); seen.add(k); }
      }
      for (const k of n.routing.intentKeywords.en) {
        if (!seen.has(k)) { keywords.push(k); seen.add(k); }
      }
    }
    return keywords;
  }

  /** Intent pattern templates for a given tier (D4 derivation). */
  classificationPatterns(tier: string): string[] {
    const patterns: string[] = [];
    const seen = new Set<string>();
    for (const n of this.nodes.values()) {
      if (n.kind === "group" || n.routing === undefined) continue;
      if (isSubAgentScoped(n)) continue;
      if (n.routing.intentPriority <= 0) continue;
      const classifTier = INTENT_PRIORITY_TO_TIER.get(n.routing.intentPriority);
      if (classifTier === undefined || classifTier !== tier) continue;
      const pats = n.routing.intentKeywords.patterns;
      if (pats === undefined) continue;
      for (const p of pats) {
        if (!seen.has(p)) { patterns.push(p); seen.add(p); }
      }
    }
    return patterns;
  }

  /**
   * Checks if a tool name matches any dynamic group's namePrefix. Returns
   * the matching group node, or undefined.
   */
  matchesDynamicGroup(toolName: string): CapabilityNode | undefined {
    for (const g of this.dynamicGroups()) {
      const p = g.runtime?.namePrefix;
      if (p !== undefined && p !== "" && toolName.startsWith(p)) return g;
    }
    return undefined;
  }

  /**
   * All tool/subagent nodes whose runtime.subagentScope matches scope. Used
   * by sub-agents to discover their own tools.
   */
  toolsForAgentScope(scope: string): CapabilityNode[] {
    const result: CapabilityNode[] = [];
    for (const n of this.nodes.values()) {
      if (n.kind === "group") continue;
      if (n.runtime?.subagentScope === scope) result.push(n);
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  /**
   * Converts the tree back to a flat CapabilitySpec[] for backward
   * compatibility (D9 derivation — ensures existing code that reads
   * Registry still works after migration to the tree).
   */
  toRegistry(): CapabilitySpec[] {
    const specs: CapabilitySpec[] = [];
    this.walk((n) => {
      if (n.kind === "group") return true;
      const spec: CapabilitySpec = {
        id: n.id,
        kind: n.kind === "subagent" ? "subagent_entry" : "tool",
        toolName: n.name,
        runtimeOwner: n.runtime?.owner ?? "",
        enabledWhen: n.runtime?.enabledWhen ?? "",
        promptSummary: n.prompt?.summary ?? "",
        toolGroups: n.policy?.policyGroups ?? [],
        skillBindable: n.skills?.bindable ?? false,
      };
      specs.push(spec);
      return true;
    });
    return specs;
  }
}

// ── Module-level helpers ────────────────────────────────────────────────

/**
 * Returns the position of a tier in the escalating order, or -1 if invalid.
 * Exported for use by the intent router (commit 17) and tests.
 */
export function tierIndex(tier: string): number {
  for (let i = 0; i < VALID_TIERS.length; i++) {
    if (VALID_TIERS[i] === tier) return i;
  }
  return -1;
}

/** True if the node belongs to a sub-agent scope. */
function isSubAgentScoped(n: CapabilityNode): boolean {
  return (
    n.runtime !== undefined &&
    n.runtime.subagentScope !== undefined &&
    n.runtime.subagentScope !== ""
  );
}

/**
 * Sort by (sortOrder asc, name asc) and dedupe by name. Skill bindings can
 * produce multiple entries with the same tool name; keep the first (lowest
 * sortOrder) entry per name.
 */
function sortAndDedupSummaries(entries: ToolSummaryEntry[]): ToolSummaryEntry[] {
  entries.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
  const seen = new Set<string>();
  const deduped: ToolSummaryEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    deduped.push(e);
  }
  return deduped;
}

function cloneNode(n: CapabilityNode): CapabilityNode {
  const c: CapabilityNode = {
    id: n.id,
    name: n.name,
    kind: n.kind,
    parent: n.parent,
    children: [...n.children],
  };
  if (n.runtime !== undefined) {
    c.runtime = { ...n.runtime };
  }
  if (n.prompt !== undefined) {
    c.prompt = {
      ...n.prompt,
      ...(n.prompt.intentHints !== undefined
        ? { intentHints: { ...n.prompt.intentHints } }
        : {}),
    };
  }
  if (n.routing !== undefined) {
    c.routing = {
      minTier: n.routing.minTier,
      excludeFrom: [...n.routing.excludeFrom],
      intentKeywords: {
        zh: [...n.routing.intentKeywords.zh],
        en: [...n.routing.intentKeywords.en],
        ...(n.routing.intentKeywords.patterns !== undefined
          ? { patterns: [...n.routing.intentKeywords.patterns] }
          : {}),
      },
      intentPriority: n.routing.intentPriority,
    };
  }
  if (n.perms !== undefined) {
    c.perms = {
      ...n.perms,
      ...(n.perms.escalationHints !== undefined
        ? { escalationHints: { ...n.perms.escalationHints } }
        : {}),
    };
  }
  if (n.skills !== undefined) {
    c.skills = {
      ...n.skills,
      boundSkills: [...n.skills.boundSkills],
    };
  }
  if (n.display !== undefined) {
    c.display = { ...n.display };
  }
  if (n.policy !== undefined) {
    c.policy = {
      ...n.policy,
      policyGroups: [...n.policy.policyGroups],
      profiles: [...n.policy.profiles],
    };
  }
  return c;
}
