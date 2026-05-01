// Composed Tool Types — Skill-to-Tool Codegen.
//
// Translated from crabclaw composed/types.go (109 LoC Go → ~80 TS).
// `sync.RWMutex` is dropped: TS event loop is single-threaded so the
// in-memory store can use a plain Map.

/** Compiled-step shape. Each step composes one underlying tool. */
export interface CompiledStep {
  action: string;
  description: string;
  /** Tool name — verified to exist in the host's capability tree. */
  tool: string;
  /** Template-mapped inputs ({{var.path}} expressions). */
  inputMap: Record<string, string>;
  /** Variable name to bind this step's output to. */
  outputAs: string;
  /** Approval level (normalized). */
  approval: string;
  /** "abort" / "skip" / "retry". */
  onError: string;
  /** Iterates the step over a collection variable when non-empty. */
  loopOver: string;
  /** Tree node id of the underlying tool. */
  toolNodeId: string;
}

/** Compiled composed-tool definition. */
export interface ComposedToolDef {
  /** "skill_media_cross_publish" — the synthesized callable name. */
  name: string;
  /** "media-cross-publish" — original SKILL.md tree id. */
  skillName: string;
  /** SKILL.md file path (host-supplied). */
  skillPath: string;
  description: string;
  /** Mirrors `tool_schema.input` from the SKILL.md (raw JSON Schema). */
  inputSchema: unknown;
  /** Mirrors `tool_schema.output`. */
  outputSchema: unknown;
  steps: CompiledStep[];
  /**
   * Derived approval level — the strictest among all steps. Drives the
   * outer composed-tool's approval gating.
   */
  maxApproval: string;
  /** Capability-tree node id (e.g. "composed/skill_media_cross_publish"). */
  treeNodeId: string;
  /** ISO 8601 timestamp of compilation. */
  compiledAt: string;
  /** SHA-256 of the source SKILL.md contents (incremental compile cache key). */
  skillHash: string;
}

/** Per-step execution outcome (consumed by ComposedExecutor in commit #13). */
export interface StepResult {
  action: string;
  output?: unknown;
  error?: string;
}

/** Aggregate compile result returned by Codegen. */
export interface CodegenResult {
  tools: ComposedToolDef[];
  errors?: CodegenError[];
}

/** Per-skill compile error. */
export interface CodegenError {
  skillName: string;
  /** Step name when the error is per-step; empty when whole-skill. */
  step?: string;
  message: string;
}

/** Persisted store layout (JSON-serializable). */
export interface ComposedToolStoreData {
  version: number;
  tools: Record<string, ComposedToolDef>;
  updatedAt: string;
}

/** Current persisted-store schema version. */
export const COMPOSED_TOOL_STORE_VERSION = 1;
