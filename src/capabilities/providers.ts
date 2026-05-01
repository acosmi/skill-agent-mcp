// SkillKeywordProvider / SkillNodeProvider — pluggable interfaces for
// SKILL.md frontmatter injection. Translated from
// crabclaw/backend/internal/agents/capabilities/capability_tree.go (provider
// + injection sections).
//
// In Go, providers communicate with the capability tree via interfaces to
// avoid circular imports between capabilities/ and skills/. Same intent
// here. The actual SKILL.md parser lives in src/manage/ (commit 11-12).

import type {
  CapabilityNode,
  IntentKeywords,
  NodeDisplay,
  NodePermissions,
  NodePolicy,
  NodePrompt,
  NodeRouting,
  SkillNodeData,
} from "./types.ts";
import type { CapabilityTree } from "./capability-tree.ts";

// ── Keyword provider ────────────────────────────────────────────────────

/**
 * Provides intent_keywords from SKILL.md frontmatter. Implemented by the
 * skills subsystem and registered before the tree is first built.
 */
export interface SkillKeywordProvider {
  /** treeId → IntentKeywords */
  loadSkillKeywords(): Map<string, IntentKeywords>;
}

let skillKeywordProvider: SkillKeywordProvider | undefined;

export function registerSkillKeywordProvider(p: SkillKeywordProvider): void {
  skillKeywordProvider = p;
}

export function getSkillKeywordProvider(): SkillKeywordProvider | undefined {
  return skillKeywordProvider;
}

// ── Full node provider ──────────────────────────────────────────────────

/**
 * Provides full SKILL.md frontmatter declarations (7 dimensions) for tool
 * nodes. Implemented by the skills subsystem and registered before the
 * tree is first built.
 */
export interface SkillNodeProvider {
  /** treeId → SkillNodeData (7-dim) */
  loadSkillNodes(): Map<string, SkillNodeData>;

  /** Optional: number of bundled (vs user/managed) nodes loaded last call. */
  lastBundledNodeCount?(): number;
}

let skillNodeProvider: SkillNodeProvider | undefined;

export function registerSkillNodeProvider(p: SkillNodeProvider): void {
  skillNodeProvider = p;
}

export function getSkillNodeProvider(): SkillNodeProvider | undefined {
  return skillNodeProvider;
}

// ── lastInjectedNodeCount ───────────────────────────────────────────────

let _lastInjectedNodeCount = 0;

/**
 * Number of SKILL.md nodes loaded on the last injectSkillNodes call. Used
 * by the singleton self-check (commit 13) and diagnostics.
 */
export function lastInjectedSkillNodeCount(): number {
  return _lastInjectedNodeCount;
}

// ── Tree-construction guard ─────────────────────────────────────────────

let _treeConstructing = false;

/**
 * Set to true while the default tree is being constructed. Used by skill
 * providers to detect and avoid recursive defaultTree() calls during
 * injectSkillNodes (Go uses sync.Once detection; TS uses a flag).
 */
export function setTreeConstructing(v: boolean): void {
  _treeConstructing = v;
}

export function isTreeConstructing(): boolean {
  return _treeConstructing;
}

// ── Injection ───────────────────────────────────────────────────────────

/**
 * Loads SKILL.md-declared nodes from the registered provider and injects
 * them into the tree. Override semantics:
 * - Existing node: SKILL.md non-zero fields override hardcoded values.
 * - Missing node: created and attached to data.treeGroup as parent.
 *
 * Safe behaviour: missing parent group → log warning and skip the node;
 * never throw. Matches Go original's slog.Warn semantic.
 */
export function injectSkillNodes(tree: CapabilityTree): void {
  if (skillNodeProvider === undefined) {
    console.warn(
      "injectSkillNodes: no provider registered — SKILL.md nodes will NOT be injected",
    );
    _lastInjectedNodeCount = 0;
    return;
  }
  const nodeMap = skillNodeProvider.loadSkillNodes();
  _lastInjectedNodeCount = nodeMap.size;

  for (const [treeId, data] of nodeMap) {
    const existing = tree.lookup(treeId);
    if (existing !== undefined) {
      mergeNodeData(existing, data);
      continue;
    }
    if (data.treeGroup === "") {
      console.warn(
        `injectSkillNodes: no treeGroup for new node ${treeId}`,
      );
      continue;
    }
    const parent = tree.lookup(data.treeGroup);
    if (parent === undefined) {
      console.warn(
        `injectSkillNodes: parent group not found for ${treeId} (group=${data.treeGroup})`,
      );
      continue;
    }
    const node = buildNodeFromSkillData(treeId, data);
    try {
      tree.addNode(node);
    } catch (err) {
      console.warn(`injectSkillNodes: addNode failed for ${treeId}:`, err);
    }
  }
}

/**
 * Loads intent_keywords from the registered keyword provider and merges
 * them into existing tree nodes. Run after injectSkillNodes — nodes must
 * exist before keywords can be merged.
 */
export function injectSkillKeywords(tree: CapabilityTree): void {
  if (skillKeywordProvider === undefined) return;
  const kwMap = skillKeywordProvider.loadSkillKeywords();
  for (const [treeId, kw] of kwMap) {
    const node = tree.lookup(treeId);
    if (node === undefined) continue;
    if (node.routing === undefined) continue;
    node.routing.intentKeywords = mergeKeywords(kw, node.routing.intentKeywords);
  }
}

// ── mergeNodeData (override mode for existing nodes) ────────────────────

/**
 * Merges non-zero fields from data onto node. Zero values mean "preserve
 * hardcoded fallback" (matches Go original's overlay semantics).
 *
 * Note for icons: emoji is stored as-is in node.display.icon. The
 * emojiToIconName conversion (if any) is the responsibility of the
 * frontend code generator (commit 14 gen_frontend), not this layer.
 */
export function mergeNodeData(node: CapabilityNode, data: SkillNodeData): void {
  // Runtime
  if (data.enabledWhen !== "") {
    node.runtime ??= { owner: "", enabledWhen: "", dynamic: false };
    node.runtime.enabledWhen = data.enabledWhen;
  }

  // Prompt
  if (data.summary !== "") {
    node.prompt ??= emptyPrompt();
    node.prompt.summary = data.summary;
  }
  if (data.sortOrder > 0) {
    node.prompt ??= emptyPrompt();
    node.prompt.sortOrder = data.sortOrder;
  }
  if (data.usageGuide !== "") {
    node.prompt ??= emptyPrompt();
    node.prompt.usageGuide = data.usageGuide;
  }
  if (Object.keys(data.intentHints).length > 0) {
    node.prompt ??= emptyPrompt();
    node.prompt.intentHints = data.intentHints;
  }

  // Routing (intentKeywords handled separately by injectSkillKeywords)
  if (data.minTier !== "") {
    node.routing ??= emptyRouting();
    node.routing.minTier = data.minTier;
  }
  if (data.excludeFrom.length > 0) {
    node.routing ??= emptyRouting();
    node.routing.excludeFrom = data.excludeFrom;
  }
  if (data.intentPriority > 0) {
    node.routing ??= emptyRouting();
    node.routing.intentPriority = data.intentPriority;
  }

  // Permissions
  if (data.minSecurityLevel !== "") {
    node.perms ??= emptyPerms();
    node.perms.minSecurityLevel = data.minSecurityLevel;
  }
  if (data.fileAccess !== "") {
    node.perms ??= emptyPerms();
    node.perms.fileAccess = data.fileAccess;
  }
  if (data.approvalType !== "") {
    node.perms ??= emptyPerms();
    node.perms.approvalType = data.approvalType;
  }
  if (data.scopeCheck !== "") {
    node.perms ??= emptyPerms();
    node.perms.scopeCheck = data.scopeCheck;
  }
  if (data.escalationHints !== undefined) {
    node.perms ??= emptyPerms();
    node.perms.escalationHints = data.escalationHints;
  }

  // Skills (bindable: true overrides only; never demote true→false)
  if (data.bindable) {
    node.skills ??= { bindable: false, boundSkills: [], guidance: false };
    node.skills.bindable = true;
  }

  // Display (icon stored as emoji literal — no conversion at this layer)
  if (data.icon !== "") {
    node.display ??= emptyDisplay();
    node.display.icon = data.icon;
  }
  if (data.title !== "") {
    node.display ??= emptyDisplay();
    node.display.title = data.title;
  }
  if (data.label !== "") {
    node.display ??= emptyDisplay();
    node.display.label = data.label;
  }
  if (data.verb !== "") {
    node.display ??= emptyDisplay();
    node.display.verb = data.verb;
  }
  if (data.detailKeys !== "") {
    node.display ??= emptyDisplay();
    node.display.detailKeys = data.detailKeys;
  }

  // Policy
  if (data.policyGroups.length > 0) {
    node.policy ??= emptyPolicy();
    node.policy.policyGroups = data.policyGroups;
  }
  if (data.profiles.length > 0) {
    node.policy ??= emptyPolicy();
    node.policy.profiles = data.profiles;
  }
  if (data.wizardGroup !== "") {
    node.policy ??= emptyPolicy();
    node.policy.wizardGroup = data.wizardGroup;
  }
}

function emptyPrompt(): NodePrompt {
  return {
    summary: "",
    sortOrder: 0,
    usageGuide: "",
    delegation: "",
    groupIntro: "",
  };
}

function emptyRouting(): NodeRouting {
  return {
    minTier: "",
    excludeFrom: [],
    intentKeywords: { zh: [], en: [] },
    intentPriority: 0,
  };
}

function emptyPerms(): NodePermissions {
  return {
    minSecurityLevel: "",
    fileAccess: "",
    approvalType: "",
    scopeCheck: "",
  };
}

function emptyDisplay(): NodeDisplay {
  return {
    icon: "",
    title: "",
    label: "",
    verb: "",
    detailKeys: "",
  };
}

function emptyPolicy(): NodePolicy {
  return {
    policyGroups: [],
    profiles: [],
    wizardGroup: "",
  };
}

// ── buildNodeFromSkillData (create mode for new nodes) ──────────────────

/**
 * Builds a fresh CapabilityNode from SkillNodeData. Used in create mode
 * during injectSkillNodes when treeId is not already present in the tree.
 */
export function buildNodeFromSkillData(
  treeId: string,
  data: SkillNodeData,
): CapabilityNode {
  // Extract name from treeId: "fs/read_file" → "read_file"
  let name = treeId;
  const idx = treeId.lastIndexOf("/");
  if (idx >= 0) {
    name = treeId.slice(idx + 1);
  }
  if (data.name !== "") {
    name = data.name;
  }
  const node: CapabilityNode = {
    id: treeId,
    name,
    kind: "tool",
    parent: data.treeGroup,
    children: [],
  };
  mergeNodeData(node, data);
  // Ensure Runtime.Owner has a default (matches Go original).
  if (node.runtime === undefined) {
    node.runtime = {
      owner: "attempt_runner",
      enabledWhen: "",
      dynamic: false,
    };
  } else if (node.runtime.owner === "") {
    node.runtime.owner = "attempt_runner";
  }
  return node;
}

// ── Keyword merge ───────────────────────────────────────────────────────

/**
 * Merges skill-provided keywords with hardcoded ones. Skill keywords take
 * priority (prepended); hardcoded ones serve as backup. Patterns are
 * merged the same way.
 */
export function mergeKeywords(
  fromSkill: IntentKeywords,
  fromTree: IntentKeywords,
): IntentKeywords {
  const result: IntentKeywords = {
    zh: fromTree.zh,
    en: fromTree.en,
    ...(fromTree.patterns !== undefined ? { patterns: fromTree.patterns } : {}),
  };
  if (fromSkill.zh.length > 0) {
    result.zh = dedup([...fromSkill.zh, ...fromTree.zh]);
  }
  if (fromSkill.en.length > 0) {
    result.en = dedup([...fromSkill.en, ...fromTree.en]);
  }
  if (fromSkill.patterns !== undefined && fromSkill.patterns.length > 0) {
    result.patterns = dedup([
      ...fromSkill.patterns,
      ...(fromTree.patterns ?? []),
    ]);
  }
  return result;
}

/**
 * Deduplicates a string array preserving order. Empty strings are dropped
 * (matches Go original's dedup behaviour).
 */
export function dedup(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of items) {
    if (s !== "" && !seen.has(s)) {
      seen.add(s);
      result.push(s);
    }
  }
  return result;
}
