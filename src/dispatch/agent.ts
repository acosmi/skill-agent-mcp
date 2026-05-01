// Agent-mode SKILL dispatcher.
//
// Translates crabclaw runner/spawn_blueprint_agent.go (387 LoC) into the
// MCP-server world. The single MCP tool `spawn_agent` collapses to one
// uniform handler: callers pass a SKILL name + free-form task, and the
// dispatcher resolves the SKILL.md, builds a sub-agent system prompt,
// applies permission monotone-decay, and asks the host to spawn a child
// session via the SpawnSubagent callback.
//
// Three things kept the original design honest and we preserve them:
//   1. Handoff二选一 — when the caller supplies `handoffReason` AND the
//      target SKILL already has an active subscriber on the inter-agent
//      bus, we deliver the task as a directive rather than spawning a
//      duplicate child.
//   2. Permission monotone-decay — sub-agent tool whitelist is computed
//      via `resolveSkillAgentCapabilities`, never bypassing the parent's
//      set.
//   3. Contract state machine — DelegationContract walks pending →
//      active → completed/failed via `transitionStatus` so any
//      observability layer can subscribe to status changes.
//
// Deliberate divergence from Go:
//   - ToolExecParams (a runner-internal struct full of registry / queue
//     handles) becomes `SpawnContext`, an explicit interface the MCP
//     server hands to the dispatcher. Everything that was implicit
//     (Registry, AgentChannel, Bus) is now an explicit field, so the
//     dispatcher has no hidden dependencies on the host runtime.
//   - `slog.Info` is dropped. OSS users observe via SpawnContext.logger
//     (optional injection) or by intercepting the bus events.
//   - `agentType` rewrite (`"skill"` → `"blueprint"`) is removed; the
//     historical compatibility shim made sense in crabclaw's gateway
//     closure but bleeds into OSS surface for no reason. SpawnContext
//     receives runtimeKind directly.

import { resolveSkillAgentCapabilities } from "./agent-capabilities.ts";
import {
  type AgentSourceRef,
  type ContractConstraints,
  DelegationContract,
} from "./delegation-contract.ts";
import type { SkillAgentConfig } from "../skill/types.ts";

// ── External interfaces (host injects implementations) ────────────

/** A SKILL name + parsed agent_config + raw markdown body. */
export interface ResolvedAgentSkill {
  skillName: string;
  agentConfig: SkillAgentConfig;
  /** SKILL.md body (after frontmatter). Appended to the system prompt. */
  skillBody: string;
}

/** Looks up SKILLs by name. Hosted by the MCP server. */
export interface SkillSourceResolver {
  /** Returns undefined if the SKILL is missing or not in agent mode. */
  resolveAgentSkill(skillName: string): ResolvedAgentSkill | undefined;
  /** Names of all skill_mode=agent SKILLs known to the host. */
  listAgentSkills(): readonly string[];
}

/**
 * Optional inter-agent message bus. Powers handoff二选一 — when the target
 * SKILL has an active subscriber, the dispatcher delivers the task as a
 * directive instead of spawning a duplicate child.
 */
export interface InterAgentBus {
  publishHandoff(
    fromSourceId: string,
    toSourceId: string,
    task: string,
    context: unknown,
  ): void;
  hasActiveSubscriber(sourceId: string): boolean;
}

/** Extended AgentSourceRef carrying runtime_kind alongside the v1.0 type/id pair. */
export interface RuntimeAwareSourceRef extends AgentSourceRef {
  /** "skill" / "coder" / "media" — mirrors crabclaw's RuntimeKind field. */
  runtimeKind?: string;
}

/** Sub-agent thought reply (re-exported from delegation-contract.ts). */
export type {
  ThoughtArtifacts,
  ThoughtResult,
} from "./delegation-contract.ts";

import type { ThoughtResult as ThoughtResultType } from "./delegation-contract.ts";

/** Outcome the SpawnSubagent callback returns to the dispatcher. */
export interface SubagentRunOutcome {
  status: string;
  error?: string;
  thoughtResult?: ThoughtResultType;
}

/** Parameters passed to the host SpawnSubagent callback. */
export interface SpawnSubagentParams {
  contract: DelegationContract;
  task: string;
  systemPrompt: string;
  timeoutMs: number;
  /** Short label for logs / display (e.g. "coder-1a2b3c"). */
  label: string;
  /** Optional channel name for the spawned sub-agent. */
  channel?: string;
  /** "skill" / "coder" / "media" / etc. */
  agentType: string;
  sourceRef: RuntimeAwareSourceRef;
  /**
   * Tool whitelist for the sub-agent (undefined = no filter; empty array
   * = no tools at all). Computed via permission monotone-decay.
   */
  subAgentAllowedTools?: readonly string[];
}

/**
 * SpawnSubagent callback — implemented by the host. Must respect
 * `params.subAgentAllowedTools` and surface failures via the returned
 * `SubagentRunOutcome.error`. Throwing is allowed but the dispatcher
 * will treat any throw as `Status="failed"` and surface the message.
 */
export type SpawnSubagent = (
  params: SpawnSubagentParams,
  signal?: AbortSignal,
) => Promise<SubagentRunOutcome>;

/**
 * Everything the dispatcher needs from the host. Construct one of
 * these inside the MCP server and reuse for the lifetime of the
 * server process.
 */
export interface SpawnContext {
  /** Parent session identifier (typed by host). */
  parentSessionId: string;
  /** Parent delegation contract; undefined for root agents. */
  parentContract?: DelegationContract;
  /** Optional channel name for the spawned sub-agent. */
  agentChannel?: string;
  /**
   * Tool names available to the parent agent. Used to compute the
   * sub-agent's allowed tool list via permission monotone-decay.
   * Empty array means "parent has no tools" (the sub-agent will too).
   */
  parentToolNames: readonly string[];
  skillResolver: SkillSourceResolver;
  spawnSubagent: SpawnSubagent;
  /** Optional handoff bus. */
  interAgentBus?: InterAgentBus;
  /** Optional structured logger. */
  logger?: SpawnLogger;
}

/** Minimal logger surface so OSS users can plug in pino / winston / console. */
export interface SpawnLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn?(message: string, fields?: Record<string, unknown>): void;
  error?(message: string, fields?: Record<string, unknown>): void;
}

// ── MCP tool input shape ───────────────────────────────────────────

export interface SpawnAgentInput {
  skillName: string;
  task: string;
  /** Defaults to 60_000 ms when omitted or non-positive. */
  timeoutMs?: number;
  /**
   * Non-empty marks this spawn as a "task handoff" semantically; the
   * dispatcher records an audit event on the inter-agent bus (when
   * supplied) and applies the handoff二选一 routing rule.
   */
  handoffReason?: string;
  handoffContext?: unknown;
}

/**
 * JSON Schema for the `spawn_agent` MCP tool. The MCP server registers
 * this directly with `McpServer.registerTool`.
 */
export const SPAWN_AGENT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    skill_name: {
      type: "string",
      description:
        "Agent skill name to spawn (must be a SKILL.md with skill_mode=agent)",
    },
    task: {
      type: "string",
      description: "Task description for the sub-agent (≤500 chars)",
    },
    timeout_ms: {
      type: "integer",
      description: "Sub-agent timeout in milliseconds (default 60000)",
    },
    handoff_reason: {
      type: "string",
      description:
        "Optional. Set to a short reason when this spawn is semantically a handoff — records an audit event; omit for plain spawn.",
    },
    handoff_context: {
      type: "object",
      description:
        "Optional. Extra context to include in the handoff audit event (ignored if handoff_reason is empty).",
    },
  },
  required: ["skill_name", "task"],
} as const;

// ── Dispatcher entry point ─────────────────────────────────────────

/**
 * Top-level handler for the `spawn_agent` MCP tool. Returns a
 * human-readable string the MCP server forwards back to the calling
 * LLM as `text` content.
 *
 * Errors are NOT thrown — they are returned as `[spawn_agent] …`
 * messages so the LLM can read them like any other tool reply. The
 * MCP server doesn't need to catch.
 */
export async function executeSpawnAgent(
  input: SpawnAgentInput,
  context: SpawnContext,
  signal?: AbortSignal,
): Promise<string> {
  if (!input.skillName) return "[spawn_agent] skill_name is required";
  if (!input.task) return "[spawn_agent] task is required";

  const resolved = context.skillResolver.resolveAgentSkill(input.skillName);
  if (!resolved) {
    return `[spawn_agent] Agent skill ${JSON.stringify(input.skillName)} not found`;
  }

  return executeSkillDrivenSpawn(input, resolved, context, signal);
}

/**
 * Skill-driven sub-agent spawn (the equivalent of crabclaw's
 * executeSkillDrivenSpawn). Exposed for tests + advanced users that
 * already have a `ResolvedAgentSkill` in hand.
 */
export async function executeSkillDrivenSpawn(
  input: SpawnAgentInput,
  skill: ResolvedAgentSkill,
  context: SpawnContext,
  signal?: AbortSignal,
): Promise<string> {
  const cfg = skill.agentConfig;
  if (!cfg) {
    return `[spawn_agent] Skill ${JSON.stringify(input.skillName)} has no agent_config`;
  }

  const runtimeKind = cfg.runtimeKind || "skill";

  const sourceRef: RuntimeAwareSourceRef = {
    id: input.skillName,
    type: "skill",
    runtimeKind,
  };

  // Build constraints from agent_config
  const constraints: ContractConstraints = {
    noNetwork: cfg.noNetwork ?? false,
    noSpawn: cfg.noSpawn ?? false,
    sandboxRequired: cfg.sandboxRequired ?? false,
  };
  if (cfg.allowedCommands && cfg.allowedCommands.length > 0) {
    constraints.allowedCommands = [...cfg.allowedCommands];
  }
  if (cfg.canDispatchTo && cfg.canDispatchTo.length > 0) {
    constraints.canDispatchTo = [...cfg.canDispatchTo];
  }
  if (cfg.maxBashCalls !== undefined && cfg.maxBashCalls > 0) {
    constraints.maxBashCalls = cfg.maxBashCalls;
  }
  if (cfg.maxTokensPerSession !== undefined && cfg.maxTokensPerSession > 0) {
    constraints.maxTokens = cfg.maxTokensPerSession;
  }
  if (cfg.stallThresholdMs !== undefined && cfg.stallThresholdMs > 0) {
    constraints.stallThresholdMs = cfg.stallThresholdMs;
  }
  if (cfg.escalationChain && cfg.escalationChain.length > 0) {
    constraints.escalationChain = [...cfg.escalationChain];
  }

  // Resolve timeout BEFORE contract construction so contract.timeoutMs
  // matches the value the spawn caller actually uses (pre-fix the contract
  // always carried the default 60_000 while spawn used input.timeoutMs —
  // formatForSystemPrompt then exposed an inconsistent value to sub-agents).
  let timeoutMs = 60_000;
  if (input.timeoutMs !== undefined && input.timeoutMs > 0) {
    timeoutMs = input.timeoutMs;
  }

  // Build contract
  let contract: DelegationContract;
  try {
    contract = new DelegationContract({
      taskBrief: input.task,
      successCriteria: "",
      scope: [],
      constraints,
      issuedBy: context.parentSessionId,
      sourceRef,
      timeoutMs,
    });
  } catch (err) {
    return `[spawn_agent] Failed to create contract: ${errMsg(err)}`;
  }

  // Dispatch permission check — parent contract limits children
  if (
    context.parentContract &&
    !context.parentContract.canDispatchTo(input.skillName)
  ) {
    return `[spawn_agent] Dispatch to ${JSON.stringify(input.skillName)} denied by parent contract`;
  }

  const systemPrompt = buildSkillAgentSystemPrompt(skill, contract);

  context.logger?.info("spawn_agent: launching skill agent", {
    skillName: input.skillName,
    runtimeKind,
    task: truncateRunes(input.task, 80),
    contractId: contract.contractId,
    isHandoff: !!input.handoffReason,
  });

  // Handoff二选一 — deliver to active subscriber when present, else spawn.
  if (
    input.handoffReason &&
    context.interAgentBus &&
    context.interAgentBus.hasActiveSubscriber(input.skillName)
  ) {
    const fromId = parentSourceId(context.parentContract);
    context.interAgentBus.publishHandoff(
      fromId,
      input.skillName,
      input.task,
      input.handoffContext,
    );
    context.logger?.info(
      "spawn_agent: handoff delivered to active peer (no spawn)",
      { skill: input.skillName, from: fromId },
    );
    return `[spawn_agent] Handoff delivered to active peer ${JSON.stringify(input.skillName)} (no new instance spawned)`;
  }

  // No active subscriber → spawn + audit (when handoff_reason is set)
  publishHandoffAudit(
    context.interAgentBus,
    context.parentContract,
    input.handoffReason,
    input.skillName,
    input.task,
    input.handoffContext,
  );

  // Compute sub-agent tool whitelist when any of inherit/allow/deny is set.
  let allowedTools: string[] | undefined;
  if (
    cfg.inherit ||
    (cfg.allow && cfg.allow.length > 0) ||
    (cfg.deny && cfg.deny.length > 0)
  ) {
    allowedTools = resolveSkillAgentCapabilities(cfg, context.parentToolNames);
    context.logger?.info("spawn_agent: skill capabilities resolved", {
      skill: input.skillName,
      inherit: cfg.inherit,
      allowCount: cfg.allow?.length ?? 0,
      denyCount: cfg.deny?.length ?? 0,
      allowedOutCount: allowedTools.length,
    });
  }

  // Pending → Active before handing off to the host
  contract.transitionStatus("active");

  let outcome: SubagentRunOutcome;
  try {
    outcome = await context.spawnSubagent(
      {
        contract,
        task: input.task,
        systemPrompt,
        timeoutMs,
        label: `${input.skillName}-${contract.contractId.slice(0, 8)}`,
        ...(context.agentChannel !== undefined && {
          channel: context.agentChannel,
        }),
        agentType: runtimeKind,
        sourceRef,
        ...(allowedTools !== undefined && {
          subAgentAllowedTools: allowedTools,
        }),
      },
      signal,
    );
  } catch (err) {
    contract.transitionStatus("failed");
    return `[spawn_agent] Sub-agent spawn failed: ${errMsg(err)}`;
  }

  if (outcome.error || outcome.status === "failed") {
    contract.transitionStatus("failed");
  } else {
    contract.transitionStatus("completed");
  }
  return formatSkillSpawnResult(input.skillName, contract, outcome);
}

// ── Audit + handoff ────────────────────────────────────────────────

/**
 * Publish a handoff audit event when `reason` is non-empty. Matches the
 * crabclaw publishHandoffAudit semantics 1:1; returns whether an event
 * was emitted (test-friendly).
 */
export function publishHandoffAudit(
  bus: InterAgentBus | undefined,
  parentContract: DelegationContract | undefined,
  reason: string | undefined,
  targetSkill: string,
  task: string,
  context: unknown,
): boolean {
  if (!reason || !bus) return false;
  const fromId = parentSourceId(parentContract);
  bus.publishHandoff(fromId, targetSkill, task, context);
  return true;
}

function parentSourceId(parentContract: DelegationContract | undefined): string {
  if (parentContract && parentContract.sourceRef) {
    return parentContract.sourceRef.id;
  }
  return "";
}

// ── System prompt builder ──────────────────────────────────────────

/**
 * Compose the sub-agent's system prompt from the resolved SKILL:
 * Role / Goal / Backstory + SKILL.md body. Optionally appends the
 * delegation contract (scope / constraints / timeout) so the sub-agent
 * doesn't waste tokens re-discovering its own task contract. SOP /
 * review_gate are NOT appended here — call `buildSOPPromptSection`
 * and concatenate at the call site if you want SOP injection too.
 *
 * Translated from crabclaw buildSkillAgentSystemPrompt; field order
 * preserved so existing SKILL.md authors see the same prompt layout.
 * (Crabclaw Go's spawn_blueprint_agent missed this contract injection;
 * spawn_media_agent had it. The TS port restores parity.)
 */
export function buildSkillAgentSystemPrompt(
  skill: ResolvedAgentSkill,
  contract?: DelegationContract,
): string {
  const cfg = skill.agentConfig;
  let prompt = `# Role: ${cfg.roleTitle}\n`;
  if (cfg.roleGoal) {
    prompt += `Goal: ${cfg.roleGoal}\n`;
  }
  if (cfg.roleBackstory) {
    prompt += `\n${cfg.roleBackstory}\n`;
  }
  if (skill.skillBody) {
    prompt += `\n---\n\n${skill.skillBody}\n`;
  }
  if (contract) {
    prompt += `\n---\n\n${contract.formatForSystemPrompt()}\n`;
  }
  return prompt;
}

// ── Result formatting ──────────────────────────────────────────────

export function formatSkillSpawnResult(
  skillName: string,
  contract: DelegationContract,
  outcome: SubagentRunOutcome | undefined,
): string {
  if (!outcome) {
    return `[spawn_agent] Skill ${skillName} / Contract ${contract.contractId}: no outcome returned`;
  }
  const tr = outcome.thoughtResult;
  if (tr) {
    let out = `[Agent Result]\nSkill: ${skillName}\nContract: ${contract.contractId}\nStatus: ${tr.status}\n`;
    if (tr.result) out += `\n${tr.result}\n`;
    if (tr.reasoningSummary) out += `\nReasoning: ${tr.reasoningSummary}\n`;
    if (tr.artifacts) {
      if (tr.artifacts.filesModified && tr.artifacts.filesModified.length > 0) {
        out += `\nFiles modified: ${JSON.stringify(tr.artifacts.filesModified)}\n`;
      }
      if (tr.artifacts.filesCreated && tr.artifacts.filesCreated.length > 0) {
        out += `\nFiles created: ${JSON.stringify(tr.artifacts.filesCreated)}\n`;
      }
    }
    return out;
  }
  return `[Agent Result]\nSkill: ${skillName}\nContract: ${contract.contractId}\nStatus: ${outcome.status}\nError: ${outcome.error ?? ""}\n`;
}

// ── Local helpers ──────────────────────────────────────────────────

function truncateRunes(s: string, maxLen: number): string {
  // [...s] iterates by code-point so multi-unit UTF-16 (emoji, CJK
  // surrogates) is preserved across the boundary.
  const codepoints = [...s];
  if (codepoints.length <= maxLen) return s;
  return codepoints.slice(0, maxLen).join("") + "...";
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
