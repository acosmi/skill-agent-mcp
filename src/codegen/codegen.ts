// Codegen — Skill-to-Tool compiler.
//
// Translated from crabclaw composed/codegen.go (268 LoC Go → ~280 TS).
// Inputs: SKILL.md entries with `tool_schema`. Outputs: ComposedToolDef
// list + per-skill error list.
//
// Algorithm (preserved 1:1 from Go):
//   1. Skip skills without tool_schema.
//   2. Validate input + output JSON Schema (must parse).
//   3. Validate every step.tool exists in the tree (or has a dynamic
//      mcp_/remote_ prefix).
//   4. Derive the composed tool's max approval level from steps.
//   5. Synthesize a ComposedToolDef with name = "skill_" +
//      sanitizeName(skillName), tree node id = "composed/<name>".
//
// Deliberate divergence from Go:
//   - `slog.Info` / `slog.Debug` dropped — OSS users observe via
//     `Codegen` returning rich CodegenResult (errors + tool list).
//   - SHA-256 uses `node:crypto.createHash` instead of crypto/sha256
//     (sync, single-threaded; matches Go semantics from a caller's POV).
//   - `time.Now().Format(time.RFC3339)` → `new Date().toISOString()`
//     (RFC 3339 is a subset of ISO 8601; both are interoperable).

import { createHash } from "node:crypto";

import {
  type CodegenError,
  type CodegenResult,
  type CompiledStep,
  type ComposedToolDef,
} from "./types.ts";
import { type ComposedToolStore } from "./store.ts";

// ── Public types ───────────────────────────────────────────────────

/** Approval priority — higher = stricter. */
export const APPROVAL_PRIORITY: ReadonlyMap<string, number> = new Map([
  ["none", 0],
  ["plan_confirm", 1],
  ["data_export", 2],
  ["mount_access", 3],
  ["exec_escalation", 4],
]);

/** Result of a single tree lookup. */
export interface ToolTreeLookupResult {
  nodeId: string;
  approvalType: string;
}

/** Capability-tree lookup interface (avoids depending on capabilities pkg). */
export interface ToolTreeLookup {
  /** Returns undefined when the tool name is not registered. */
  lookupTool(toolHint: string): ToolTreeLookupResult | undefined;
}

/** Compiler-facing skill input shape. */
export interface SkillInput {
  /** Skill name (e.g. "media-cross-publish"). */
  name: string;
  /** SKILL.md file directory. */
  dir: string;
  /** Top-level frontmatter description. */
  description: string;
  /** Full SKILL.md source for the SHA-256 cache key. */
  content: string;
  toolSchema?: ToolSchemaInput;
}

/** Compiler-facing tool_schema. */
export interface ToolSchemaInput {
  /** input JSON Schema (raw object or undefined). */
  input?: unknown;
  /** output JSON Schema. */
  output?: unknown;
  steps: StepInput[];
}

/** Compiler-facing step input. */
export interface StepInput {
  action: string;
  description: string;
  tool: string;
  inputMap: Record<string, string>;
  outputAs: string;
  approval: string;
  onError: string;
  loopOver: string;
}

// ── Compilation entry points ───────────────────────────────────────

/** Compile every input that has a tool_schema. */
export function codegen(
  inputs: readonly SkillInput[],
  tree: ToolTreeLookup,
): CodegenResult {
  const result: CodegenResult = { tools: [] };
  const errors: CodegenError[] = [];

  for (const input of inputs) {
    if (!input.toolSchema) continue;
    const schema = input.toolSchema;

    // 1. Validate input schema is a parseable object (already parsed by
    //    upstream YAML decoder, but we still guard against accidental
    //    string payloads or null).
    if (
      schema.input !== undefined &&
      schema.input !== null &&
      typeof schema.input !== "object"
    ) {
      errors.push({
        skillName: input.name,
        message: `input schema is not a JSON object (got ${typeof schema.input})`,
      });
      continue;
    }
    if (
      schema.output !== undefined &&
      schema.output !== null &&
      typeof schema.output !== "object"
    ) {
      errors.push({
        skillName: input.name,
        message: `output schema is not a JSON object (got ${typeof schema.output})`,
      });
      continue;
    }

    // 2. Validate every step.tool either exists in the tree or has
    //    a dynamic mcp_/remote_ prefix.
    let stepsValid = true;
    for (const step of schema.steps) {
      if (!step.tool) {
        errors.push({
          skillName: input.name,
          step: step.action,
          message: "step missing tool field",
        });
        stepsValid = false;
        break;
      }
      if (
        step.tool.startsWith("mcp_") ||
        step.tool.startsWith("remote_")
      ) {
        continue;
      }
      if (!tree.lookupTool(step.tool)) {
        errors.push({
          skillName: input.name,
          step: step.action,
          message: `tool ${JSON.stringify(step.tool)} is not registered in the capability tree`,
        });
        stepsValid = false;
        break;
      }
    }
    if (!stepsValid) continue;

    // 3. Derive the strictest approval the steps require.
    const maxApproval = deriveMaxApproval(schema.steps, tree);

    // 4. Synthesize the composed tool definition.
    const toolName = "skill_" + sanitizeName(input.name);
    const def: ComposedToolDef = {
      name: toolName,
      skillName: input.name,
      skillPath: input.dir,
      description: input.description,
      inputSchema: schema.input,
      outputSchema: schema.output,
      steps: compileSteps(schema.steps, tree),
      maxApproval,
      treeNodeId: "composed/" + toolName,
      compiledAt: new Date().toISOString(),
      skillHash: sha256Hex(input.content),
    };
    result.tools.push(def);
  }

  if (errors.length > 0) result.errors = errors;
  return result;
}

/**
 * Incremental codegen: only compile skills whose `content` SHA-256
 * differs from the existing store entry. Skills already compiled with
 * matching hash are silently skipped.
 *
 * Useful for MCP server boot: re-walking the SKILL.md root on every
 * start would otherwise re-hash + re-compile every SKILL.
 */
export function codegenIncremental(
  inputs: readonly SkillInput[],
  tree: ToolTreeLookup,
  existing: ComposedToolStore,
): CodegenResult {
  const filtered: SkillInput[] = [];

  for (const input of inputs) {
    if (!input.toolSchema) continue;
    const toolName = "skill_" + sanitizeName(input.name);
    const existingDef = existing.get(toolName);
    const newHash = sha256Hex(input.content);
    if (existingDef && existingDef.skillHash === newHash) {
      continue;
    }
    filtered.push(input);
  }

  if (filtered.length === 0) return { tools: [] };
  return codegen(filtered, tree);
}

// ── Helpers ────────────────────────────────────────────────────────

/** Derive the strictest approval level the step list requires. */
export function deriveMaxApproval(
  steps: readonly StepInput[],
  tree: ToolTreeLookup,
): string {
  let maxPriority = 0;

  for (const step of steps) {
    // Step-level approval declaration takes precedence.
    if (step.approval) {
      const p = APPROVAL_PRIORITY.get(step.approval);
      if (p !== undefined && p > maxPriority) maxPriority = p;
      continue;
    }
    // Otherwise inherit from the tree node's ApprovalType.
    const found = tree.lookupTool(step.tool);
    if (found && found.approvalType) {
      const p = APPROVAL_PRIORITY.get(found.approvalType);
      if (p !== undefined && p > maxPriority) maxPriority = p;
    }
  }

  for (const [k, v] of APPROVAL_PRIORITY) {
    if (v === maxPriority) return k;
  }
  return "none";
}

/** Compile StepInput[] into CompiledStep[] (resolves tree node ids). */
export function compileSteps(
  steps: readonly StepInput[],
  tree: ToolTreeLookup,
): CompiledStep[] {
  const out: CompiledStep[] = [];
  for (const step of steps) {
    const found = tree.lookupTool(step.tool);
    out.push({
      action: step.action,
      description: step.description,
      tool: step.tool,
      inputMap: { ...step.inputMap },
      outputAs: step.outputAs,
      approval: normalizeApproval(step.approval),
      onError: normalizeOnError(step.onError),
      loopOver: step.loopOver,
      toolNodeId: found?.nodeId ?? "",
    });
  }
  return out;
}

/** Skill-name → tool-name normalization. Preserves Go semantics. */
export function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[-\s.]/g, "_");
}

/** Normalize step.approval to a known APPROVAL_PRIORITY key (default "none"). */
export function normalizeApproval(approval: string): string {
  if (APPROVAL_PRIORITY.has(approval)) return approval;
  return "none";
}

/** Normalize step.onError to "abort" / "skip" / "retry". */
export function normalizeOnError(onError: string): string {
  if (onError === "skip" || onError === "retry") return onError;
  return "abort";
}

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}
