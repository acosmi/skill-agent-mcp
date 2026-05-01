// SKILL.md frontmatter parser + metadata resolver. Translated from
// crabclaw/backend/internal/agents/skills/frontmatter.go.
//
// Scope: only the SKILL.md → SkillNodeData / SkillToolSchema conversion
// path needed by capability_manage and the SkillNodeProvider. The full
// 31-file skills package is out of scope per user decision (D5).
//
// Translation choices:
// - YAML parsing via `yaml` (npm) — ISC licensed (Apache 2.0 compatible).
//   Go original uses adrg/frontmatter (BSD-3); both produce equivalent
//   field maps.
// - Field-level type guards (typeof / Array.isArray / typeof === "object")
//   replace Go's type switch + json.Unmarshal round-trips.
// - Zero-value semantics preserved: empty strings / missing fields mean
//   "do not override hardcoded fallback" (matches mergeNodeData
//   contract in providers.ts).

import { parse as parseYaml } from "yaml";

import type {
  EscalationHints,
  SkillNodeData,
} from "../capabilities/index.ts";

// ── SkillToolSchema (Skill-to-Tool Codegen) ─────────────────────────

export interface SkillToolStep {
  /** Step name. */
  action: string;
  description: string;
  /** Atomic tool name (capability-tree node name). */
  tool: string;
  /** Parameter mapping templates. */
  inputMap: Record<string, string>;
  /** Output variable name. */
  outputAs: string;
  /** "none" / "plan_confirm" / "exec_escalation". */
  approval: string;
  /** "abort" (default) / "skip" / "retry". */
  onError: string;
  /** Optional loop variable reference. */
  loopOver: string;
}

export interface SkillToolSchema {
  /** JSON Schema for input parameters. */
  input: unknown;
  /** JSON Schema for output. */
  output: unknown;
  /** Sequential step list. */
  steps: SkillToolStep[];
}

// ── SkillAgentConfig (skill_mode=agent only) ─────────────────────────

export interface SkillAgentConfig {
  roleTitle: string;
  roleGoal?: string;
  roleBackstory?: string;
  runtimeKind?: string; // "skill" / "coder" / "media"
  inherit?: string;
  allow?: string[];
  deny?: string[];
  noNetwork?: boolean;
  noSpawn?: boolean;
  sandboxRequired?: boolean;
  allowedCommands?: string[];
  maxBashCalls?: number;
  model?: string;
  thinkLevel?: string;
  maxTokensPerSession?: number;
  maxSessionsPerDay?: number;
  maxConcurrent?: number;
  maxTokensPerDay?: number;
  memoryScope?: string;
  sharedRead?: string[];
  sharedWrite?: string[];
  memoryIsolation?: string;
  canDispatchTo?: string[];
  respondTo?: string[];
  listenOnly?: string[];
  composedTools?: string[];
}

export type SkillMode = "prompt" | "tool" | "agent";

/** Parsed CrabClaw skill metadata extracted from SKILL.md frontmatter. */
export interface CrabClawSkillMetadata {
  treeId?: string;
  treeGroup?: string;
  minTier?: string;
  approvalType?: string;
  enabledWhen?: string;
  securityLevel?: string;
  intentPriority?: number;

  emoji?: string;
  homepage?: string;
  skillKey?: string;
  primaryEnv?: string;
  os?: string[];
  tools?: string[];

  skillMode?: SkillMode;
  agentConfig?: SkillAgentConfig;
  agentInputSchema?: unknown;
  agentOutputSchema?: unknown;

  toolSchema?: SkillToolSchema;
  toolInputSchema?: unknown;
  toolDescription?: string;

  intentKeywords?: { zh: string[]; en: string[] };
  intentPatterns?: string[];
  intentHints?: Record<string, string>;
  relatedTools?: string[];
  sceneHint?: string;

  fileAccess?: string;
  scopeCheck?: string;
  excludeFrom?: string[];
  policyGroups?: string[];
  profiles?: string[];
  wizardGroup?: string;
  sortOrder?: number;

  summary?: string;
  usageGuide?: string;
  title?: string;
  verb?: string;
  detailKeys?: string;
  label?: string;
  category?: string;

  escalationHints?: EscalationHints;
}

// ── Frontmatter parsing ──────────────────────────────────────────────

export interface ParsedSkill {
  /** Raw frontmatter block. */
  frontmatter: Record<string, unknown>;
  /** Resolved CrabClaw metadata (undefined if no recognizable fields). */
  metadata?: CrabClawSkillMetadata;
  /** Markdown body following the closing "---" line. */
  content: string;
}

/**
 * Extract and parse the YAML frontmatter block at the start of a Markdown
 * file. Returns undefined when the document doesn't start with "---" or
 * when YAML parsing fails.
 */
export function parseFrontmatter(
  content: string,
): Record<string, unknown> | undefined {
  if (!content.startsWith("---")) return undefined;
  const closing = content.indexOf("\n---", 3);
  if (closing < 0) return undefined;
  const yamlBlock = content.slice(3, closing);
  try {
    const parsed = parseYaml(yamlBlock);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse errors — caller gets undefined
  }
  return undefined;
}

/**
 * Full parse pipeline: extract frontmatter, resolve metadata, return body
 * content. Use this when you want both the metadata and the markdown
 * body (e.g. for skill content rendering).
 */
export function parseSkillFrontmatter(
  source: string,
): ParsedSkill | undefined {
  if (!source.startsWith("---")) return undefined;
  const closing = source.indexOf("\n---", 3);
  if (closing < 0) return undefined;

  const yamlBlock = source.slice(3, closing);
  let frontmatter: Record<string, unknown>;
  try {
    const parsed = parseYaml(yamlBlock);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    frontmatter = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }

  let bodyStart = closing + 4; // skip "\n---"
  if (source[bodyStart] === "\n") bodyStart++;

  return {
    frontmatter,
    metadata: resolveCrabClawMetadata(frontmatter),
    content: source.slice(bodyStart),
  };
}

/** Manifest-section keys searched for nested CrabClaw metadata. */
const MANIFEST_KEYS: readonly string[] = ["crabclaw", "pi-ai", "pi"];

/**
 * Resolve CrabClaw metadata from a parsed frontmatter object. Returns
 * undefined if no recognizable fields are found.
 *
 * Translated from Go ResolveCrabClawMetadata. The Go original looks for
 * a nested manifest section (one of "crabclaw" / "pi-ai" / "pi") and
 * falls back to flat metadata when the section is absent.
 */
export function resolveCrabClawMetadata(
  fm: Record<string, unknown>,
): CrabClawSkillMetadata | undefined {
  let metadataObj: Record<string, unknown> = fm;
  for (const key of MANIFEST_KEYS) {
    const v = fm[key];
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      metadataObj = v as Record<string, unknown>;
      break;
    }
  }

  const meta: CrabClawSkillMetadata = {};

  // Top-level fields (read from fm, not the nested manifest section)
  if (typeof fm["tree_id"] === "string") meta.treeId = fm["tree_id"].trim();
  if (typeof fm["tree_group"] === "string") meta.treeGroup = fm["tree_group"].trim();
  if (typeof fm["min_tier"] === "string") meta.minTier = fm["min_tier"].trim();
  if (typeof fm["approval_type"] === "string") meta.approvalType = fm["approval_type"].trim();
  if (typeof fm["enabled_when"] === "string") meta.enabledWhen = fm["enabled_when"].trim();
  if (typeof fm["security_level"] === "string") meta.securityLevel = fm["security_level"].trim();
  if (typeof fm["skill_mode"] === "string") meta.skillMode = fm["skill_mode"].trim() as SkillMode;
  if (typeof fm["intent_priority"] === "number") meta.intentPriority = fm["intent_priority"];
  if (typeof fm["category"] === "string") meta.category = fm["category"].trim();

  // Nested-section fields
  if (typeof metadataObj["emoji"] === "string") meta.emoji = metadataObj["emoji"];
  if (typeof metadataObj["homepage"] === "string") meta.homepage = metadataObj["homepage"];
  if (typeof metadataObj["skillKey"] === "string") meta.skillKey = metadataObj["skillKey"];
  if (typeof metadataObj["primaryEnv"] === "string") meta.primaryEnv = metadataObj["primaryEnv"];
  meta.os = stringArray(metadataObj["os"]);

  // tools (with fallback to treeId basename)
  const toolsList = stringArray(metadataObj["tools"]);
  if (toolsList !== undefined) {
    meta.tools = toolsList;
  } else if (meta.treeId !== undefined) {
    meta.tools = [resolveToolNameFromTreeId(meta.treeId)];
  }

  // tool_schema
  const tsRaw = metadataObj["tool_schema"];
  if (typeof tsRaw === "object" && tsRaw !== null && !Array.isArray(tsRaw)) {
    const tsObj = tsRaw as Record<string, unknown>;
    const stepsArray = tsObj["steps"];
    if (Array.isArray(stepsArray) && stepsArray.length > 0) {
      const steps = stepsArray
        .map(parseSkillToolStep)
        .filter((s): s is SkillToolStep => s !== undefined);
      if (steps.length > 0) {
        meta.toolSchema = {
          input: tsObj["input"] ?? {},
          output: tsObj["output"] ?? {},
          steps,
        };
      }
    }
  }
  if (metadataObj["tool_input_schema"] !== undefined) {
    meta.toolInputSchema = metadataObj["tool_input_schema"];
  }
  if (typeof metadataObj["tool_description"] === "string") {
    meta.toolDescription = metadataObj["tool_description"];
  }

  // agent_config
  const acRaw = metadataObj["agent_config"];
  if (typeof acRaw === "object" && acRaw !== null && !Array.isArray(acRaw)) {
    meta.agentConfig = parseSkillAgentConfig(acRaw as Record<string, unknown>);
  }
  if (metadataObj["agent_input_schema"] !== undefined) {
    meta.agentInputSchema = metadataObj["agent_input_schema"];
  }
  if (metadataObj["agent_output_schema"] !== undefined) {
    meta.agentOutputSchema = metadataObj["agent_output_schema"];
  }

  // intent_keywords / intent_patterns / intent_hints
  const ikRaw = metadataObj["intent_keywords"];
  if (typeof ikRaw === "object" && ikRaw !== null && !Array.isArray(ikRaw)) {
    const ikObj = ikRaw as Record<string, unknown>;
    const zh = stringArray(ikObj["zh"]) ?? [];
    const en = stringArray(ikObj["en"]) ?? [];
    if (zh.length > 0 || en.length > 0) {
      meta.intentKeywords = { zh, en };
    }
  }
  const intentPatterns = stringArray(metadataObj["intent_patterns"]);
  if (intentPatterns !== undefined) meta.intentPatterns = intentPatterns;

  const ihRaw = metadataObj["intent_hints"];
  if (typeof ihRaw === "object" && ihRaw !== null && !Array.isArray(ihRaw)) {
    const hints: Record<string, string> = {};
    for (const [k, v] of Object.entries(ihRaw as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() !== "") hints[k] = v;
    }
    if (Object.keys(hints).length > 0) meta.intentHints = hints;
  }

  // related_tools (cap to 5)
  const rtList = stringArray(metadataObj["related_tools"]);
  if (rtList !== undefined && rtList.length > 0) {
    meta.relatedTools = rtList.slice(0, 5);
  }
  if (typeof metadataObj["scene_hint"] === "string" && metadataObj["scene_hint"] !== "") {
    meta.sceneHint = metadataObj["scene_hint"];
  }

  // permission/policy/display fields
  if (typeof metadataObj["file_access"] === "string") meta.fileAccess = metadataObj["file_access"];
  if (typeof metadataObj["scope_check"] === "string") meta.scopeCheck = metadataObj["scope_check"];
  const ef = stringArray(metadataObj["exclude_from"]);
  if (ef !== undefined) meta.excludeFrom = ef;
  const pg = stringArray(metadataObj["policy_groups"]);
  if (pg !== undefined) meta.policyGroups = pg;
  const profiles = stringArray(metadataObj["profiles"]);
  if (profiles !== undefined) meta.profiles = profiles;
  if (typeof metadataObj["wizard_group"] === "string") meta.wizardGroup = metadataObj["wizard_group"];
  if (typeof metadataObj["sort_order"] === "number") meta.sortOrder = metadataObj["sort_order"];

  if (typeof metadataObj["summary"] === "string") meta.summary = metadataObj["summary"];
  if (typeof metadataObj["usage_guide"] === "string") meta.usageGuide = metadataObj["usage_guide"];
  if (typeof metadataObj["title"] === "string") meta.title = metadataObj["title"];
  if (typeof metadataObj["verb"] === "string") meta.verb = metadataObj["verb"];
  if (typeof metadataObj["detail_keys"] === "string") meta.detailKeys = metadataObj["detail_keys"];
  if (typeof metadataObj["label"] === "string") meta.label = metadataObj["label"];

  // escalation_hints
  const ehRaw = metadataObj["escalation_hints"];
  if (typeof ehRaw === "object" && ehRaw !== null && !Array.isArray(ehRaw)) {
    const ehObj = ehRaw as Record<string, unknown>;
    meta.escalationHints = {
      defaultRequestedLevel: typeof ehObj["default_requested_level"] === "string" ? ehObj["default_requested_level"] : "",
      defaultTtlMinutes: typeof ehObj["default_ttl_minutes"] === "number" ? ehObj["default_ttl_minutes"] : 0,
      defaultMountMode: typeof ehObj["default_mount_mode"] === "string" ? ehObj["default_mount_mode"] : "",
      needsOriginator: ehObj["needs_originator"] === true,
      needsRunSession: ehObj["needs_run_session"] === true,
    };
  }

  // Return undefined if absolutely nothing was extracted
  if (Object.keys(meta).length === 0) return undefined;
  return meta;
}

/**
 * Convert parsed CrabClaw metadata into a SkillNodeData entry suitable
 * for a SkillNodeProvider.loadSkillNodes() implementation. Empty fields
 * preserve hardcoded fallbacks (zero-value semantics in mergeNodeData).
 */
export function metadataToSkillNodeData(
  meta: CrabClawSkillMetadata,
): SkillNodeData {
  let name = "";
  if (meta.tools !== undefined && meta.tools.length > 0) {
    name = meta.tools[0]!;
  } else if (meta.treeId !== undefined) {
    name = resolveToolNameFromTreeId(meta.treeId);
  }
  return {
    treeGroup: meta.treeGroup ?? "",
    name,
    enabledWhen: meta.enabledWhen ?? "",
    summary: meta.summary ?? "",
    sortOrder: meta.sortOrder ?? 0,
    usageGuide: meta.usageGuide ?? "",
    intentHints: meta.intentHints ?? {},
    minTier: meta.minTier ?? "",
    excludeFrom: meta.excludeFrom ?? [],
    intentPriority: meta.intentPriority ?? 0,
    minSecurityLevel: meta.securityLevel ?? "",
    fileAccess: meta.fileAccess ?? "",
    approvalType: meta.approvalType ?? "",
    scopeCheck: meta.scopeCheck ?? "",
    escalationHints: meta.escalationHints,
    bindable: meta.tools !== undefined && meta.tools.length > 0,
    icon: meta.emoji ?? "",
    title: meta.title ?? "",
    label: meta.label ?? "",
    verb: meta.verb ?? "",
    detailKeys: meta.detailKeys ?? "",
    policyGroups: meta.policyGroups ?? [],
    profiles: meta.profiles ?? [],
    wizardGroup: meta.wizardGroup ?? "",
    toolInputSchema: meta.toolInputSchema ?? null,
    toolDescription: meta.toolDescription ?? "",
  };
}

/**
 * Extract the tool name from a treeId. "fs/read_file" → "read_file";
 * a treeId without "/" is returned unchanged.
 */
export function resolveToolNameFromTreeId(treeId: string): string {
  const idx = treeId.lastIndexOf("/");
  if (idx >= 0) return treeId.slice(idx + 1);
  return treeId;
}

// ── helpers ──────────────────────────────────────────────────────────

function parseSkillToolStep(v: unknown): SkillToolStep | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const obj = v as Record<string, unknown>;
  const inputMap: Record<string, string> = {};
  const imRaw = obj["input_map"];
  if (typeof imRaw === "object" && imRaw !== null && !Array.isArray(imRaw)) {
    for (const [k, val] of Object.entries(imRaw as Record<string, unknown>)) {
      if (typeof val === "string") inputMap[k] = val;
    }
  }
  return {
    action: typeof obj["action"] === "string" ? obj["action"] : "",
    description: typeof obj["description"] === "string" ? obj["description"] : "",
    tool: typeof obj["tool"] === "string" ? obj["tool"] : "",
    inputMap,
    outputAs: typeof obj["output_as"] === "string" ? obj["output_as"] : "",
    approval: typeof obj["approval"] === "string" ? obj["approval"] : "",
    onError: typeof obj["on_error"] === "string" ? obj["on_error"] : "",
    loopOver: typeof obj["loop_over"] === "string" ? obj["loop_over"] : "",
  };
}

function parseSkillAgentConfig(obj: Record<string, unknown>): SkillAgentConfig {
  const cfg: SkillAgentConfig = {
    roleTitle: typeof obj["role_title"] === "string" ? obj["role_title"] : "",
  };
  const setIfString = (key: string, target: keyof SkillAgentConfig): void => {
    const v = obj[key];
    if (typeof v === "string") (cfg as unknown as Record<string, unknown>)[target as string] = v;
  };
  const setIfBool = (key: string, target: keyof SkillAgentConfig): void => {
    const v = obj[key];
    if (typeof v === "boolean") (cfg as unknown as Record<string, unknown>)[target as string] = v;
  };
  const setIfNumber = (key: string, target: keyof SkillAgentConfig): void => {
    const v = obj[key];
    if (typeof v === "number") (cfg as unknown as Record<string, unknown>)[target as string] = v;
  };
  const setIfStringArray = (key: string, target: keyof SkillAgentConfig): void => {
    const arr = stringArray(obj[key]);
    if (arr !== undefined) (cfg as unknown as Record<string, unknown>)[target as string] = arr;
  };

  setIfString("role_goal", "roleGoal");
  setIfString("role_backstory", "roleBackstory");
  setIfString("runtime_kind", "runtimeKind");
  setIfString("inherit", "inherit");
  setIfStringArray("allow", "allow");
  setIfStringArray("deny", "deny");
  setIfBool("no_network", "noNetwork");
  setIfBool("no_spawn", "noSpawn");
  setIfBool("sandbox_required", "sandboxRequired");
  setIfStringArray("allowed_commands", "allowedCommands");
  setIfNumber("max_bash_calls", "maxBashCalls");
  setIfString("model", "model");
  setIfString("think_level", "thinkLevel");
  setIfNumber("max_tokens_per_session", "maxTokensPerSession");
  setIfNumber("max_sessions_per_day", "maxSessionsPerDay");
  setIfNumber("max_concurrent", "maxConcurrent");
  setIfNumber("max_tokens_per_day", "maxTokensPerDay");
  setIfString("memory_scope", "memoryScope");
  setIfStringArray("shared_read", "sharedRead");
  setIfStringArray("shared_write", "sharedWrite");
  setIfString("memory_isolation", "memoryIsolation");
  setIfStringArray("can_dispatch_to", "canDispatchTo");
  setIfStringArray("respond_to", "respondTo");
  setIfStringArray("listen_only", "listenOnly");
  setIfStringArray("composed_tools", "composedTools");

  return cfg;
}

/** Coerce a value that should be a string array; return undefined otherwise. */
function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = (v as unknown[]).filter(
    (s): s is string => typeof s === "string" && s.trim() !== "",
  );
  return out.length > 0 ? out : undefined;
}
