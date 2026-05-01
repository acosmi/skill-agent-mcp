// DelegationContract — main agent's structured authorization for
// sub-agents. Translated from
// crabclaw/backend/internal/agents/runner/delegation_contract.go.
//
// Translated:
// - DelegationContract data shape + state machine (pending/active/etc).
// - ResourceBudget (max bash calls / time / tokens with increment helpers).
// - ScopeEntry + ContractConstraints (read/write/exec permissions, no_network,
//   no_spawn, sandbox_required, max_bash_calls, allowed_commands,
//   can_dispatch_to, escalation_chain, max_tokens).
// - ThoughtResult + AuthRequest + ThoughtHelpRequest (sub-agent reply
//   structure).
// - parseThoughtResult: lenient JSON parsing for sub-agent string replies.
// - formatForSystemPrompt: contract → markdown for prompt injection.
// - CapabilitySet + validateMonotonicDecay: permission monotone-decay.
//
// NOT translated (out of framework scope):
// - ApplyConstraints(ToolExecParams) — depends on the runner's
//   ToolExecParams type which is outside the framework's surface.
//   Framework users implement their own ToolExecParams equivalent and
//   wire constraints in their own runner.
// - ContractPersistence interface — VFS-specific. Framework users
//   provide their own persistence (e.g. via fleet/persistence.ts atomic-
//   write helpers).
//
// External dependencies dropped: google/uuid → crypto.randomUUID()
// (built-in); pathutil.Clean → node:path posix/native normalize.

import * as path from "node:path";

// ── Constants ───────────────────────────────────────────────────────────

export const MAX_TASK_BRIEF_LEN = 500;
export const MAX_SUCCESS_CRITERIA_LEN = 300;
export const MAX_SCOPE_ENTRIES = 20;
export const MAX_ALLOWED_COMMANDS = 50;
export const MAX_RESULT_LEN = 10_000;
export const MAX_RESUME_HINT_LEN = 300;
export const MAX_REASONING_SUMMARY = 500;
export const MAX_SCOPE_VIOLATIONS = 20;
export const MAX_CAN_DISPATCH_TO = 20;

export const CONTRACT_VFS_BASE = "_system/contracts";
export const CONTRACT_DIR_ACTIVE = `${CONTRACT_VFS_BASE}/active`;
export const CONTRACT_DIR_SUSPENDED = `${CONTRACT_VFS_BASE}/suspended`;
export const CONTRACT_DIR_COMPLETED = `${CONTRACT_VFS_BASE}/completed`;
export const CONTRACT_DIR_FAILED = `${CONTRACT_VFS_BASE}/failed`;

// ── Types ───────────────────────────────────────────────────────────────

export type ContractStatus =
  | "pending"
  | "active"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

export type ScopePermission = "read" | "write" | "execute";

export interface ScopeEntry {
  path: string;
  permissions: ScopePermission[];
}

export interface ContractConstraints {
  noNetwork: boolean;
  noSpawn: boolean;
  sandboxRequired: boolean;
  maxBashCalls?: number;
  allowedCommands?: string[];
  /** Dispatch permission matrix — agent IDs allowed to dispatch to. "*" = wildcard. */
  canDispatchTo?: string[];
  blueprintId?: string;
  /** Stall detection threshold (ms). */
  stallThresholdMs?: number;
  maxTokens?: number;
  /** Escalation chain: [self, parent, human]. */
  escalationChain?: string[];
}

/**
 * Resource budget — implements Agent Contracts paper's budget conservation
 * (child_budget ≤ parent_remaining_budget; arXiv:2601.08815). Counters are
 * plain numbers in TS (single-threaded event loop); the increment helpers
 * exist for parity with the Go atomic API.
 */
export class ResourceBudget {
  maxBashCalls: number;
  usedBashCalls: number;
  maxTimeMs: number;
  usedTimeMs: number;
  maxTokens: number;
  usedTokens: number;

  constructor(init: {
    maxBashCalls?: number;
    maxTimeMs?: number;
    maxTokens?: number;
  } = {}) {
    this.maxBashCalls = init.maxBashCalls ?? 0;
    this.usedBashCalls = 0;
    this.maxTimeMs = init.maxTimeMs ?? 0;
    this.usedTimeMs = 0;
    this.maxTokens = init.maxTokens ?? 0;
    this.usedTokens = 0;
  }

  /** Returns [exhausted, reason]. Reason is "" when not exhausted. */
  isExhausted(): [boolean, string] {
    if (this.maxBashCalls > 0 && this.usedBashCalls >= this.maxBashCalls) {
      return [
        true,
        `bash calls exhausted (${this.usedBashCalls}/${this.maxBashCalls})`,
      ];
    }
    if (this.maxTimeMs > 0 && this.usedTimeMs >= this.maxTimeMs) {
      return [
        true,
        `time budget exhausted (${this.usedTimeMs}ms/${this.maxTimeMs}ms)`,
      ];
    }
    if (this.maxTokens > 0 && this.usedTokens >= this.maxTokens) {
      return [
        true,
        `token budget exhausted (${this.usedTokens}/${this.maxTokens})`,
      ];
    }
    return [false, ""];
  }

  incrementBashCalls(): void {
    this.usedBashCalls++;
  }

  incrementTokens(delta: number): void {
    if (delta > 0) {
      this.usedTokens += delta;
    }
  }

  incrementTimeMs(deltaMs: number): void {
    if (deltaMs > 0) {
      this.usedTimeMs += deltaMs;
    }
  }
}

/** Light reference for the source that issued the contract. */
export interface AgentSourceRef {
  /** "blueprint" / "skill" / "nlc" / etc. */
  type: string;
  id: string;
}

// ── DelegationContract ──────────────────────────────────────────────────

const VALID_TRANSITIONS: ReadonlyMap<ContractStatus, readonly ContractStatus[]> =
  new Map([
    ["pending", ["active"] as const],
    ["active", ["suspended", "completed", "failed"] as const],
    ["suspended", ["active", "cancelled"] as const],
  ]);

export interface DelegationContractInit {
  taskBrief: string;
  successCriteria: string;
  scope: ScopeEntry[];
  constraints: ContractConstraints;
  issuedBy: string;
  parentContract?: string;
  timeoutMs?: number;
  budget?: ResourceBudget;
  sourceRef?: AgentSourceRef;
}

export class DelegationContract {
  contractId: string;
  schemaVersion = "1.0";
  parentContract: string;
  taskBrief: string;
  successCriteria: string;
  scope: ScopeEntry[];
  constraints: ContractConstraints;
  issuedBy: string;
  issuedAt: Date;
  timeoutMs: number;
  status: ContractStatus = "pending";
  budget?: ResourceBudget;
  sourceRef?: AgentSourceRef;

  constructor(init: DelegationContractInit) {
    this.contractId = crypto.randomUUID();
    this.taskBrief = init.taskBrief;
    this.successCriteria = init.successCriteria;
    this.scope = init.scope;
    this.constraints = init.constraints;
    this.issuedBy = init.issuedBy;
    this.parentContract = init.parentContract ?? "";
    this.issuedAt = new Date();
    this.timeoutMs = init.timeoutMs ?? 60_000;
    this.budget = init.budget;
    this.sourceRef = init.sourceRef;

    this.validate();
  }

  /** Throws if any field-size constraint is violated. */
  validate(): void {
    if (this.taskBrief === "") {
      throw new Error("task_brief is required");
    }
    if (runeLength(this.taskBrief) > MAX_TASK_BRIEF_LEN) {
      throw new Error(`task_brief exceeds ${MAX_TASK_BRIEF_LEN} chars`);
    }
    if (runeLength(this.successCriteria) > MAX_SUCCESS_CRITERIA_LEN) {
      throw new Error(
        `success_criteria exceeds ${MAX_SUCCESS_CRITERIA_LEN} chars`,
      );
    }
    if (this.scope.length > MAX_SCOPE_ENTRIES) {
      throw new Error(
        `scope entries (${this.scope.length}) exceeds max ${MAX_SCOPE_ENTRIES}`,
      );
    }
    const allowedCmds = this.constraints.allowedCommands;
    if (
      allowedCmds !== undefined && allowedCmds.length > MAX_ALLOWED_COMMANDS
    ) {
      throw new Error(
        `allowed_commands (${allowedCmds.length}) exceeds max ${MAX_ALLOWED_COMMANDS}`,
      );
    }
    const dispatchTo = this.constraints.canDispatchTo;
    if (dispatchTo !== undefined && dispatchTo.length > MAX_CAN_DISPATCH_TO) {
      throw new Error(
        `can_dispatch_to (${dispatchTo.length}) exceeds max ${MAX_CAN_DISPATCH_TO}`,
      );
    }
  }

  /**
   * Whether the contract allows dispatch to a target agent. Safe defaults:
   * unset can_dispatch_to or no_spawn → false.
   */
  canDispatchTo(targetId: string): boolean {
    if (this.constraints.noSpawn) return false;
    const list = this.constraints.canDispatchTo;
    if (list === undefined || list.length === 0) return false;
    for (const id of list) {
      if (id === "*" || id === targetId) return true;
    }
    return false;
  }

  /**
   * Validate and execute a status transition. Allowed transitions:
   *   pending → active
   *   active → suspended / completed / failed
   *   suspended → active / cancelled
   * Throws on illegal transitions.
   */
  transitionStatus(to: ContractStatus): void {
    const allowed = VALID_TRANSITIONS.get(this.status);
    if (allowed === undefined) {
      throw new Error(
        `contract ${this.contractId}: no transitions defined from status "${this.status}"`,
      );
    }
    if (!allowed.includes(to)) {
      throw new Error(
        `contract ${this.contractId}: illegal transition "${this.status}" → "${to}" (allowed: ${allowed.join(", ")})`,
      );
    }
    this.status = to;
  }

  /**
   * Serialize the contract into the markdown block injected into the
   * sub-agent's system prompt (matches Go FormatForSystemPrompt).
   */
  formatForSystemPrompt(): string {
    const lines: string[] = ["## Delegation Contract", ""];
    lines.push(`- **Contract ID**: ${this.contractId}`);
    lines.push(`- **Task**: ${this.taskBrief}`);
    if (this.successCriteria !== "") {
      lines.push(`- **Success Criteria**: ${this.successCriteria}`);
    }
    if (this.parentContract !== "") {
      lines.push(`- **Parent Contract**: ${this.parentContract} (resumed task)`);
    }
    lines.push(`- **Timeout**: ${this.timeoutMs}ms`);

    lines.push("", "### Allowed Scope", "");
    for (const s of this.scope) {
      lines.push(`- \`${s.path}\` [${s.permissions.join(", ")}]`);
    }

    lines.push("", "### Constraints", "");
    if (this.constraints.noNetwork) lines.push("- **No network access**");
    if (this.constraints.noSpawn) lines.push("- **No process spawning**");
    if (this.constraints.sandboxRequired) {
      lines.push("- **Sandbox execution required**");
    }
    if (this.constraints.maxBashCalls !== undefined) {
      lines.push(`- **Max bash calls**: ${this.constraints.maxBashCalls}`);
    }
    if (
      this.constraints.allowedCommands !== undefined &&
      this.constraints.allowedCommands.length > 0
    ) {
      lines.push(
        `- **Allowed commands**: ${this.constraints.allowedCommands.join(", ")}`,
      );
    }

    lines.push(
      "",
      "### Rules",
      "",
      "1. **Stay within scope** — accessing paths outside the allowed scope will terminate your session",
      "2. **Respect constraints** — violating constraints will terminate your session",
      "3. **Report blockers** — if you cannot complete the task within scope, return a ThoughtResult with status `needs_auth`",
      "4. **Return structured result** — your final message MUST be a valid ThoughtResult JSON",
    );

    return lines.join("\n");
  }
}

// ── ThoughtResult ───────────────────────────────────────────────────────

export type ThoughtStatus =
  | "completed"
  | "partial"
  | "blocked"
  | "needs_auth"
  | "needs_help"
  | "failed"
  | "timeout";

export interface ThoughtArtifacts {
  filesModified?: string[];
  filesCreated?: string[];
  commandsRun?: string[];
}

export interface AuthRequest {
  reason: string;
  requestedScopeExtension?: ScopeEntry[];
  requestedConstraintRelaxation?: string[];
  /** "low" | "medium" | "high" */
  riskLevel: string;
}

export interface ThoughtHelpRequest {
  question: string;
  context?: string;
  options?: string[];
  /** "low" | "medium" | "high" */
  urgency?: string;
}

export interface ThoughtResult {
  result: string;
  contractId: string;
  status: ThoughtStatus;
  artifacts?: ThoughtArtifacts;
  authRequest?: AuthRequest;
  helpRequest?: ThoughtHelpRequest;
  resumeHint?: string;
  partialArtifacts?: ThoughtArtifacts;
  reasoningSummary?: string;
  iterationCount?: number;
  scopeViolations?: string[];
}

/** Validate ThoughtResult field-size constraints. Throws on violation. */
export function validateThoughtResult(t: ThoughtResult): void {
  if (runeLength(t.result) > MAX_RESULT_LEN) {
    throw new Error(`result exceeds ${MAX_RESULT_LEN} chars`);
  }
  if (
    t.resumeHint !== undefined && runeLength(t.resumeHint) > MAX_RESUME_HINT_LEN
  ) {
    throw new Error(`resume_hint exceeds ${MAX_RESUME_HINT_LEN} chars`);
  }
  if (
    t.reasoningSummary !== undefined &&
    runeLength(t.reasoningSummary) > MAX_REASONING_SUMMARY
  ) {
    throw new Error(`reasoning_summary exceeds ${MAX_REASONING_SUMMARY} chars`);
  }
  if (
    t.scopeViolations !== undefined &&
    t.scopeViolations.length > MAX_SCOPE_VIOLATIONS
  ) {
    throw new Error(
      `scope_violations (${t.scopeViolations.length}) exceeds max ${MAX_SCOPE_VIOLATIONS}`,
    );
  }
}

/**
 * Try to parse a sub-agent reply as ThoughtResult JSON. Returns undefined
 * on non-JSON or parse failure (backward-compat with plain-text replies).
 * status is the only required field; everything else is optional.
 */
export function parseThoughtResult(reply: string): ThoughtResult | undefined {
  const trimmed = reply.trim();
  if (trimmed.length === 0 || trimmed[0] !== "{") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const obj = parsed as Record<string, unknown>;

  const status = obj["status"];
  if (typeof status !== "string" || status === "") return undefined;

  // We don't validate every field here — caller can call
  // validateThoughtResult(t) for strict size checks.
  return obj as unknown as ThoughtResult;
}

// ── CapabilitySet — permission monotone-decay validation ────────────────

/** Security-level rank: deny(0) < allowlist(1) < sandboxed(2) < full(3). */
export function securityLevelRank(level: string): number {
  switch (level) {
    case "deny":
      return 0;
    case "allowlist":
      return 1;
    case "sandboxed":
      return 2;
    case "full":
      return 3;
    default:
      return 0;
  }
}

/** The agent's effective permission ceiling. */
export interface CapabilitySet {
  allowWrite: boolean;
  allowExec: boolean;
  allowNetwork: boolean;
  /** "deny" | "allowlist" | "sandboxed" | "full" */
  maxSecurityLevel: string;
  /** Empty = workspace-global; non-empty = bounded to these path roots. */
  scopePaths: string[];
}

/**
 * Derive the security-level ceiling from a contract:
 * - scope without execute or no_spawn → "deny".
 * - sandbox_required → "sandboxed".
 * - otherwise → "full".
 */
export function deriveMaxSecurityLevel(c: DelegationContract): string {
  let hasExec = false;
  for (const s of c.scope) {
    for (const p of s.permissions) {
      if (p === "execute") {
        hasExec = true;
        break;
      }
    }
    if (hasExec) break;
  }
  if (!hasExec || c.constraints.noSpawn) return "deny";
  if (c.constraints.sandboxRequired) return "sandboxed";
  return "full";
}

/** Build a CapabilitySet from a DelegationContract's scope+constraints. */
export function capabilitySetFromContract(c: DelegationContract): CapabilitySet {
  let hasWrite = false;
  let hasExec = false;
  for (const s of c.scope) {
    for (const p of s.permissions) {
      if (p === "write") hasWrite = true;
      if (p === "execute") hasExec = true;
    }
  }
  return {
    allowWrite: hasWrite,
    allowExec: hasExec && !c.constraints.noSpawn,
    allowNetwork: !c.constraints.noNetwork,
    maxSecurityLevel: deriveMaxSecurityLevel(c),
    scopePaths: c.scope.map((s) => s.path),
  };
}

/**
 * Validate child ⊆ parent. Returns undefined when valid, else an error
 * message describing all violations. Implements DeepMind's permission
 * monotone-decay (arXiv:2602.11865) — permissions can shrink as
 * delegation depth grows but never expand.
 */
export function validateMonotonicDecay(
  parent: CapabilitySet,
  child: CapabilitySet,
): string | undefined {
  const violations: string[] = [];
  if (child.allowWrite && !parent.allowWrite) {
    violations.push("child requests write but parent denies it");
  }
  if (child.allowExec && !parent.allowExec) {
    violations.push("child requests exec but parent denies it");
  }
  if (child.allowNetwork && !parent.allowNetwork) {
    violations.push("child requests network but parent denies it");
  }
  if (
    securityLevelRank(child.maxSecurityLevel) >
    securityLevelRank(parent.maxSecurityLevel)
  ) {
    violations.push(
      `child security level "${child.maxSecurityLevel}" exceeds parent "${parent.maxSecurityLevel}"`,
    );
  }

  if (parent.scopePaths.length > 0 && child.scopePaths.length > 0) {
    for (const cp of child.scopePaths) {
      if (!isPathUnderAny(cp, parent.scopePaths)) {
        violations.push(
          `child scope path "${cp}" is not under any parent scope path`,
        );
      }
    }
  }
  if (parent.scopePaths.length > 0 && child.scopePaths.length === 0) {
    violations.push(
      "parent has scope constraints but child has none (implicit global access)",
    );
  }

  if (violations.length === 0) return undefined;
  return `monotonic decay violation: ${violations.join("; ")}`;
}

/**
 * Returns true if target path is under any of bases (lexical, no I/O).
 *
 * Cross-platform semantics (matches Go original's 2026-04-23 root-cause
 * fix): POSIX-style paths (starting with "/") use POSIX normalization
 * and "/" separator. Other styles (Windows / relative) use platform-
 * native separator. This avoids cross-style prefix mismatches when an
 * LLM emits a Windows path on a macOS host or vice versa.
 *
 * Edge cases:
 * - Empty target → false.
 * - Empty base → skip (no false positives from empty-prefix matching).
 * - Base ending in separator (root or drive root) → don't double-append.
 */
export function isPathUnderAny(target: string, bases: string[]): boolean {
  if (target === "") return false;

  const isPosix = target.startsWith("/");
  const cleanTarget = isPosix
    ? path.posix.normalize(target)
    : path.normalize(target);

  for (const b of bases) {
    if (b === "") continue;
    const baseIsPosix = b.startsWith("/");
    const cleanBase = baseIsPosix
      ? path.posix.normalize(b)
      : path.normalize(b);
    if (cleanTarget === cleanBase) return true;

    const sep = baseIsPosix ? "/" : path.sep;
    let prefix = cleanBase;
    if (!prefix.endsWith(sep)) {
      prefix += sep;
    }
    if (cleanTarget.startsWith(prefix)) return true;
  }
  return false;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Count Unicode code points (matches Go's `len([]rune(s))`). Surrogate
 * pairs in UTF-16 strings count as 1 character — so emoji like "✍️"
 * count as 1, not 2.
 */
function runeLength(s: string): number {
  let count = 0;
  for (const _ch of s) count++;
  return count;
}
