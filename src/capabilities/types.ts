// Capability tree data types translated from
// crabclaw/backend/internal/agents/capabilities/{capability_tree,registry}.go.
//
// All types here are pure data shapes — behaviour lives on the CapabilityTree
// class in capability-tree.ts. Splitting types from class avoids circular
// imports between providers and the tree itself.

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * NodeKind classifies the type of node in the capability tree.
 * - "group":    grouping node (e.g. "fs", "web", "sessions")
 * - "tool":     leaf tool node (e.g. "bash", "read_file")
 * - "subagent": sub-agent entry (e.g. "spawn_media_agent", "spawn_agent")
 */
export type NodeKind = "group" | "tool" | "subagent";

// ── 7-dimension sub-structures ──────────────────────────────────────────────

/**
 * NodeRuntime carries runtime metadata for a capability.
 * For dynamic tool groups (Argus, Remote MCP, Local MCP), dynamic=true and
 * namePrefix/discoverySource/providerId/listMethod describe the discovery
 * contract.
 */
export interface NodeRuntime {
  owner: string;
  enabledWhen: string;
  dynamic: boolean;

  namePrefix?: string;
  discoverySource?: string;
  providerId?: string;
  listMethod?: string;

  /**
   * Marks a tool as belonging to a specific sub-agent type. Non-empty (e.g.
   * "media") excludes the tool from main-agent derivation methods and only
   * includes it when the sub-agent queries via toolsForAgentScope().
   */
  subagentScope?: string;
}

/** Locale-specific keywords for intent matching. */
export interface IntentKeywords {
  zh: string[];
  en: string[];
  /** Intent patterns with {var} placeholders (e.g. "配置{platform}"). */
  patterns?: string[];
}

/**
 * NodePrompt carries capability-related prompt metadata only. Session state,
 * operational principles, CLI compat, memory recall are NOT here.
 */
export interface NodePrompt {
  summary: string;
  sortOrder: number;
  usageGuide: string;
  delegation: string;
  groupIntro: string;

  /**
   * Subsystem narrative paragraph (Markdown) auto-injected into system prompt.
   * Groups with non-empty segment and segmentOrder>0 contribute paragraphs
   * collected by prompt builders and injected into the prompt.
   */
  segment?: string;
  segmentOrder?: number;
  segmentScope?: "main" | "subagent" | "both";
  /**
   * - "identity":   subsystem identity declaration ("you have X capability"),
   *   independent of tool visibility — injected as long as the node exists.
   * - "discipline": tool-level runtime discipline (e.g. "observe before act"),
   *   gated by tool visibility.
   * - "":           defaults to "discipline" (backward compatibility).
   */
  segmentKind?: "identity" | "discipline" | "";

  /**
   * Tool-level intent guidance per tier. Key is one of "question" /
   * "task_light" / "task_write" / "task_delete" / "task_multimodal" / "*"
   * (wildcard). Value is a one-line markdown guidance. Lookup: exact tier
   * key first, then "*" fallback.
   */
  intentHints?: Record<string, string>;
}

/** Intent routing rules. */
export interface NodeRouting {
  /** Minimum intent tier (see VALID_TIERS). */
  minTier: string;
  /** Tiers to exclude from even if minTier allows. */
  excludeFrom: string[];
  intentKeywords: IntentKeywords;
  /** Priority when multiple tools match. */
  intentPriority: number;
}

/**
 * EscalationHints provides enough information for a planner to construct a
 * pending escalation request. These are default-value hints; the actual
 * request fields are determined by the runtime escalation manager.
 */
export interface EscalationHints {
  defaultRequestedLevel: string;
  defaultTtlMinutes: number;
  defaultMountMode: string;
  needsOriginator: boolean;
  needsRunSession: boolean;
}

/**
 * NodePermissions provides permission hints for the approval chain. Hints
 * for the planner and prompt — they don't replace the runtime escalation
 * state machine.
 */
export interface NodePermissions {
  minSecurityLevel: string;
  fileAccess: string;
  approvalType: string;
  scopeCheck: string;
  escalationHints?: EscalationHints;
}

/**
 * NodeSkillBinding manages tool<->skill binding relationships only. Skill
 * installation/distribution/invocation-policy/store/VFS are managed by the
 * skill lifecycle system independently.
 */
export interface NodeSkillBinding {
  bindable: boolean;
  boundSkills: string[];
  guidance: boolean;
}

/** Tool display metadata for UI rendering. */
export interface NodeDisplay {
  icon: string;
  title: string;
  label: string;
  verb: string;
  detailKeys: string;
}

/** Tool policy grouping metadata. */
export interface NodePolicy {
  policyGroups: string[];
  profiles: string[];
  wizardGroup: string;
}

// ── CapabilityNode ──────────────────────────────────────────────────────────

/**
 * A single node in the capability tree. Group nodes contain children;
 * tool/subagent nodes are leaves carrying metadata.
 */
export interface CapabilityNode {
  id: string;
  name: string;
  kind: NodeKind;
  parent: string;
  children: string[];

  runtime?: NodeRuntime;
  prompt?: NodePrompt;
  routing?: NodeRouting;
  perms?: NodePermissions;
  skills?: NodeSkillBinding;
  display?: NodeDisplay;
  policy?: NodePolicy;
}

// ── Derived helper types ────────────────────────────────────────────────────

export interface ToolSummaryEntry {
  name: string;
  summary: string;
  sortOrder: number;
}

export interface ToolIntentHint {
  toolName: string;
  hint: string;
  sortOrder: number;
}

export interface SubagentEntry {
  name: string;
  summary: string;
  delegation: string;
  usageGuide: string;
}

/**
 * SubAgentToolDef describes a single sub-agent tool for LLM injection.
 * Local to capabilities to avoid circular dependencies with the LLM client
 * layer. Callers convert to llmclient.ToolDef at the injection site.
 */
export interface SubAgentToolDef {
  name: string;
  description: string;
  /** JSON Schema (parsed). */
  inputSchema: unknown;
}

/**
 * Parsed SKILL.md frontmatter for a single tool node. Zero-valued fields
 * mean "do not override" (preserve hardcoded fallback).
 */
export interface SkillNodeData {
  treeGroup: string;
  /** Override tool name when treeID basename differs from tool name. */
  name: string;

  // Runtime
  enabledWhen: string;

  // Prompt
  summary: string;
  sortOrder: number;
  usageGuide: string;
  intentHints: Record<string, string>;

  // Routing (intentKeywords handled separately by injectSkillKeywords)
  minTier: string;
  excludeFrom: string[];
  intentPriority: number;

  // Permissions
  minSecurityLevel: string;
  fileAccess: string;
  approvalType: string;
  scopeCheck: string;
  escalationHints?: EscalationHints;

  // Skills
  bindable: boolean;

  // Display (icon stored as emoji literal — no emojiToIconName conversion)
  icon: string;
  title: string;
  label: string;
  verb: string;
  detailKeys: string;

  // Policy
  policyGroups: string[];
  profiles: string[];
  wizardGroup: string;

  // Registry auto-registration
  toolInputSchema: unknown;
  toolDescription: string;
}

// ── Registry types (registry.go translation) ────────────────────────────────

export type CapabilityKind = "tool" | "subagent_entry";

/**
 * A single capability in the registry. The registry IIFE (in registry.ts)
 * builds the static spec list. Translated from crabclaw registry.go.
 */
export interface CapabilitySpec {
  id: string;
  kind: CapabilityKind;
  toolName: string;
  runtimeOwner: string;
  enabledWhen: string;
  promptSummary: string;
  toolGroups: string[];
  skillBindable: boolean;
}

// ── Tier order ──────────────────────────────────────────────────────────────

/**
 * Valid intent tier values in escalating order. The capability-tree's
 * tierIndex(t) returns t's position; -1 if invalid. Exported because
 * intent_router and tests need the canonical order.
 */
export const VALID_TIERS = [
  "greeting",
  "question",
  "task_light",
  "task_write",
  "task_delete",
  "task_multimodal",
] as const;

export type Tier = typeof VALID_TIERS[number];

/**
 * intentPriority → classification tier mapping. Nodes with intentPriority>0
 * have their intentKeywords routed to the corresponding tier for intent
 * classification, regardless of their minTier.
 */
export const INTENT_PRIORITY_TO_TIER: ReadonlyMap<number, string> = new Map([
  [30, "task_delete"],
  [20, "task_multimodal"],
  [10, "task_write"],
]);
