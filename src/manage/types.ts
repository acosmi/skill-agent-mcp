// capability_manage data types. Translated from
// crabclaw/backend/internal/agents/capabilities/manage_tool.go.

import type {
  NodeDisplay,
  NodeKind,
  NodePermissions,
  NodePolicy,
  NodePrompt,
  NodeRouting,
  NodeRuntime,
  NodeSkillBinding,
} from "../capabilities/index.ts";

export interface ManageInput {
  /** Action discriminator. See manage-tool.ts for the canonical list. */
  action: string;
  /** Node ID (tree path); also used as subtree root for the tree action. */
  nodeId?: string;
  /** Max depth for tree action (0 = unlimited). */
  depth?: number;
  /** Intent tier for generate_prompt / generate_allowlist. */
  tier?: string;
  /** Validation level: 1 / 2 / 3 (0 = all). */
  level?: number;
  /** Required for propose_register. */
  nodeSpec?: ProposeNodeSpec;
  /** Partial fields for propose_update / routing / binding. */
  updates?: unknown;
  /** Patch ID for apply_patch / revert_patch. */
  patchId?: string;
  /** Approval flag for apply_patch / revert_patch. */
  approved?: boolean;
}

export interface ManageResult {
  action: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// ── TreePatch ─────────────────────────────────────────────────────────

export type PatchOpKind = "add" | "replace" | "remove";

export interface PatchOperation {
  op: PatchOpKind;
  path: string;
  /** Sub-structure key for "replace": "prompt" / "routing" / etc. */
  field?: string;
  /** New value (object, not JSON string). */
  value?: unknown;
  /** Previous value, kept for revert. */
  old?: unknown;
}

export type PatchStatus = "proposed" | "applied" | "reverted";

export interface TreePatch {
  id: string;
  action: "register" | "update" | "routing" | "binding" | "revert";
  description: string;
  operations: PatchOperation[];
  /** ISO 8601 timestamp. */
  createdAt: string;
  /**
   * Nanosecond resolution for tie-break on Windows where time.Now() has
   * ~15ms granularity. 0 indicates a legacy patch loaded from disk —
   * dependency checks fall back to createdAt comparison.
   */
  createdAtNano: number;
  status: PatchStatus;
}

export interface ProposeNodeSpec {
  name: string;
  parent: string;
  kind: NodeKind;
  runtime?: NodeRuntime;
  prompt?: NodePrompt;
  routing?: NodeRouting;
  perms?: NodePermissions;
  skills?: NodeSkillBinding;
  display?: NodeDisplay;
  policy?: NodePolicy;
}

// ── Result payloads ───────────────────────────────────────────────────

export interface ValidationIssue {
  level: 1 | 2 | 3;
  nodeId?: string;
  message: string;
}

export interface ValidationResult {
  level1Pass: boolean;
  level2Pass: boolean;
  level3Pass: boolean;
  issues: ValidationIssue[];
}

export interface TreeNodeView {
  id: string;
  name: string;
  kind: NodeKind;
  minTier?: string;
  summary?: string;
  dynamic?: boolean;
  children?: TreeNodeView[];
}

export interface DiagnoseResult {
  inventory: string;
  checks: string[];
}

export interface SubTreeInfo {
  agentType: string;
  groupId: string;
  toolCount: number;
  toolNames: string[];
  registered: boolean;
}
