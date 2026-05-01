// Public API surface for the @acosmi/agent capabilities subsystem.
// commit 2: types + CapabilityTree class.
// commit 3: + derivation methods, providers, sub-agent tree registry,
//   tier helpers.
// Subsequent commits: singleton (commit 13 — depends on
//   generateTreeFromRegistry which lands then).

// ── Types ───────────────────────────────────────────────────────────────

export type {
  CapabilityKind,
  CapabilityNode,
  CapabilitySpec,
  EscalationHints,
  IntentKeywords,
  NodeDisplay,
  NodeKind,
  NodePermissions,
  NodePolicy,
  NodePrompt,
  NodeRouting,
  NodeRuntime,
  NodeSkillBinding,
  SkillNodeData,
  SubAgentToolDef,
  SubagentEntry,
  Tier,
  ToolIntentHint,
  ToolSummaryEntry,
} from "./types.ts";

export { INTENT_PRIORITY_TO_TIER, VALID_TIERS } from "./types.ts";

// ── Tree class + helpers ────────────────────────────────────────────────

export { CapabilityTree, tierIndex } from "./capability-tree.ts";

// ── Skill providers + injection ─────────────────────────────────────────

export type { SkillKeywordProvider, SkillNodeProvider } from "./providers.ts";

export {
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
  setTreeConstructing,
} from "./providers.ts";

// ── Sub-agent tree registry ─────────────────────────────────────────────

export type { SubAgentToolProvider } from "./subagent-tree.ts";

export {
  registerSubAgentTree,
  resetSubAgentTreeRegistryForTesting,
  subAgentTreeFor,
} from "./subagent-tree.ts";

// ── Default tree singleton + Tree* helpers (commit 13) ──────────────────

export type { TreeBuilder } from "./singleton.ts";

export {
  defaultTree,
  isInTreeOrDynamic,
  isTreeBindable,
  rebuildDefaultTree,
  resetDefaultTreeForTesting,
  setTreeBuilder,
  treeIntentGroupSummaries,
  treeIntentHintsForTier,
  treePolicyGroups,
  treeSubagentDelegationEntries,
  treeToolOrder,
  treeToolSummaries,
  updateDefaultTree,
} from "./singleton.ts";
