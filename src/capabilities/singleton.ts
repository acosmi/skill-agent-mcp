// Default tree singleton + RCU updates + Tree* derivation helpers.
// Translated from crabclaw capability_tree.go (DefaultTree section) +
// tree_migrate.go (GenerateTreeFromRegistry hooks).
//
// OSS framework re-design vs Go original:
// - Go DefaultTree() lazily initialises from a hardcoded
//   GenerateTreeFromRegistry that bakes in 17 CrabClaw groups + 4
//   sub-agent tool nodes + dynamic group definitions + applyToolPromptSegments
//   + applyCompatPolicyLabels. None of that is portable.
// - The TS port instead exposes setTreeBuilder() — users supply their
//   own factory function. Frameworks that need a CrabClaw-style default
//   tree can register their builder once at boot. Frameworks that build
//   trees per-request bypass the singleton entirely (CapabilityTree is
//   a regular class).
// - RCU semantics preserved via clone() + atomic re-assignment of the
//   cached tree reference. TS event loop ensures readers between awaits
//   see a stable snapshot.
// - The sync.Mutex / atomic.Pointer machinery from Go is dropped — TS is
//   single-threaded.

import type {
  CapabilityNode,
  SubagentEntry,
  ToolIntentHint,
} from "./types.ts";
import { VALID_TIERS } from "./types.ts";
import { CapabilityTree } from "./capability-tree.ts";

/** A factory that produces the default capability tree on first access. */
export type TreeBuilder = () => CapabilityTree;

let treeBuilder: TreeBuilder | undefined;
let cached: CapabilityTree | undefined;

/**
 * Register the factory used to build the default tree on first access.
 * Calling this resets the cached tree (subsequent defaultTree() calls
 * rebuild via the new builder). Pass undefined to clear the builder
 * (rare — useful for tests).
 */
export function setTreeBuilder(builder: TreeBuilder | undefined): void {
  treeBuilder = builder;
  cached = undefined;
}

/**
 * Returns the lazily-initialised default capability tree. Throws if no
 * builder has been registered via setTreeBuilder().
 */
export function defaultTree(): CapabilityTree {
  if (cached !== undefined) return cached;
  if (treeBuilder === undefined) {
    throw new Error(
      "default tree not initialised — call setTreeBuilder(builder) before defaultTree()",
    );
  }
  cached = treeBuilder();
  return cached;
}

/**
 * Read-copy-update mutation primitive. Caller receives a deep copy of
 * the current snapshot, mutates it freely, and returns. The new
 * snapshot atomically replaces the cached tree; concurrent readers
 * still hold the old snapshot until they re-call defaultTree().
 *
 * Mirrors Go UpdateDefaultTree's contract — the lock-free read path
 * remains stable across writes.
 */
export function updateDefaultTree(
  mutate: (next: CapabilityTree) => void,
): void {
  const next = defaultTree().clone();
  mutate(next);
  cached = next;
}

/**
 * Force the next defaultTree() call to rebuild from the registered
 * builder. Equivalent to Go's RebuildDefaultTreeWithSkills + Reset for
 * tests. Idempotent.
 */
export function rebuildDefaultTree(): void {
  cached = undefined;
}

/** Test-only: clear the cached tree. */
export function resetDefaultTreeForTesting(): void {
  cached = undefined;
}

// ── Tree* module-level derivation helpers ───────────────────────────

/** Tool names in the canonical display sort order. */
export function treeToolOrder(): string[] {
  return defaultTree()
    .sortedToolSummaries()
    .map((e) => e.name);
}

/** Tool name → prompt summary. */
export function treeToolSummaries(): Map<string, string> {
  return defaultTree().toolSummaries();
}

/** Group name → member tool names (for tool_policy / scope checks). */
export function treePolicyGroups(): Map<string, string[]> {
  return defaultTree().policyGroups();
}

/**
 * Whether a tool name is skill-bindable per the default tree. Returns
 * true for tools whose Skills.Bindable=true and for tools matching a
 * dynamic group prefix (dynamic tools inherit group bindability).
 */
export function isTreeBindable(toolName: string): boolean {
  const tree = defaultTree();
  const node = tree.lookupByToolHint(toolName);
  if (node?.skills?.bindable === true) return true;
  if (tree.matchesDynamicGroup(toolName) !== undefined) return true;
  return false;
}

/** Whether a tool name exists in the tree (static or dynamic group match). */
export function isInTreeOrDynamic(toolName: string): boolean {
  const tree = defaultTree();
  return (
    tree.lookupByToolHint(toolName) !== undefined ||
    tree.matchesDynamicGroup(toolName) !== undefined
  );
}

/**
 * Sub-agent delegation entries (D2 derivation) — used by the prompt
 * builder's "Delegation guidance" section.
 */
export function treeSubagentDelegationEntries(): SubagentEntry[] {
  const tree = defaultTree();
  const entries: SubagentEntry[] = [];
  tree.walk((n) => {
    if (n.kind !== "subagent") return true;
    entries.push({
      name: n.name,
      summary: n.prompt?.summary ?? "",
      delegation: n.prompt?.delegation ?? "",
      usageGuide: n.prompt?.usageGuide ?? "",
    });
    return true;
  });
  return entries;
}

/**
 * tier → compact "groupName: groupIntro; ..." string for groups that
 * contain at least one tool at that tier. D8 derivation for the
 * intentGuidance prompt section.
 */
export function treeIntentGroupSummaries(): Map<string, string> {
  const tree = defaultTree();
  const result = new Map<string, string>();
  for (const tier of VALID_TIERS) {
    const allowed = tree.allowlistForTier(tier);
    if (allowed.size === 0) continue;
    const groupIntros = new Map<string, string>();
    for (const toolName of allowed.keys()) {
      const node = tree.lookupByName(toolName);
      if (node === undefined) continue;
      const parent = tree.lookup(node.parent);
      if (
        parent !== undefined &&
        parent.kind === "group" &&
        parent.prompt?.groupIntro !== undefined &&
        parent.prompt.groupIntro !== ""
      ) {
        groupIntros.set(parent.name, parent.prompt.groupIntro);
      }
    }
    if (groupIntros.size === 0) continue;
    const names = [...groupIntros.keys()].sort();
    const parts = names.map((n) => `${n}: ${groupIntros.get(n)!}`);
    result.set(tier, parts.join("; "));
  }
  return result;
}

/**
 * Tool-level intent hints for a given tier (D10 derivation). Used by
 * the intent router to assemble per-tier guidance text. Returns entries
 * sorted by (sortOrder asc, toolName asc) for deterministic rendering.
 */
export function treeIntentHintsForTier(tier: string): ToolIntentHint[] {
  const tree = defaultTree();
  const out: ToolIntentHint[] = [];
  for (const n of tree.nodes.values()) {
    if (n.kind === "group" || isSubAgentScoped(n)) continue;
    const hints = n.prompt?.intentHints;
    if (hints === undefined || Object.keys(hints).length === 0) continue;
    let hint = hints[tier];
    if (hint === undefined || hint === "") {
      hint = hints["*"];
    }
    if (hint === undefined || hint === "") continue;
    out.push({
      toolName: n.name,
      hint,
      sortOrder: n.prompt?.sortOrder ?? 0,
    });
  }
  out.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.toolName.localeCompare(b.toolName);
  });
  return out;
}

/**
 * Whether a node's runtime is scoped to a sub-agent (i.e. not visible to
 * the main agent). Inline copy of capability-tree.ts's private helper —
 * kept module-local here to avoid widening that file's public surface.
 */
function isSubAgentScoped(n: CapabilityNode): boolean {
  return (
    n.runtime !== undefined &&
    n.runtime.subagentScope !== undefined &&
    n.runtime.subagentScope !== ""
  );
}
