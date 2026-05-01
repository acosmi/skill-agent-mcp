// @acosmi/skill-agent-mcp — public surface aggregator.
//
// Re-exports each subsystem so consumers can flat-import:
//   import { CapabilityTree, createServer, dispatchSkill, ... } from "@acosmi/skill-agent-mcp";
//
// SkillAgentConfig / SkillMode are defined in BOTH manage/ (v1.0 base
// version, kept for backward-compat with the parsed frontmatter shape)
// AND skill/ (the extended version with the seven agent_config fields).
// The top-level surface exposes the *extended* version from skill/ — that
// is the canonical type for v1.x consumers. manage/ keeps the base type
// internally; consumers wanting the base type can deep-import from
// "@acosmi/skill-agent-mcp/manage/...".

export * from "./capabilities/index.ts";
export * from "./codegen/index.ts";
export * from "./dispatch/index.ts";
export * from "./llm/index.ts";
export * from "./skill/index.ts";
export * from "./mcp/index.ts";
export * from "./tools/index.ts";

// manage/ — explicit re-export to avoid SkillAgentConfig / SkillMode
// ambiguity with skill/index.ts (re-exported above).
export {
  applyOperation,
  capabilityManageToolDef,
  clearPatchStoreForTesting,
  executeManageTool,
  exportPatches,
  findDependentAppliedPatches,
  findLatestAppliedPatchByPath,
  generateFrontendConstants,
  generateFrontendJson,
  importPatches,
  loadPatch,
  metadataToSkillNodeData,
  nextPatchId,
  parseFrontmatter,
  parseSkillFrontmatter,
  replayAppliedPatches,
  resolveCrabClawMetadata,
  resolveToolNameFromTreeId,
  storePatch,
} from "./manage/index.ts";

export type {
  CrabClawSkillMetadata,
  DiagnoseResult,
  GenFrontendOptions,
  ManageInput,
  ManageResult,
  ParsedSkill,
  PatchOpKind,
  PatchOperation,
  PatchStatus,
  ProposeNodeSpec,
  SkillToolSchema,
  SkillToolStep,
  SubTreeInfo,
  TreeNodeView,
  TreePatch,
  ValidationIssue,
  ValidationResult,
} from "./manage/index.ts";
