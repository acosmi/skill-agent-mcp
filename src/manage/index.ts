// Public API surface for the @acosmi/agent capability_manage subsystem.
// 13 actions covering inspection / validation / diagnosis / prompt
// generation / sub-agent enumeration / patch-based mutation.

export type {
  DiagnoseResult,
  ManageInput,
  ManageResult,
  PatchOpKind,
  PatchOperation,
  PatchStatus,
  ProposeNodeSpec,
  SubTreeInfo,
  TreeNodeView,
  TreePatch,
  ValidationIssue,
  ValidationResult,
} from "./types.ts";

export {
  applyOperation,
  clearPatchStoreForTesting,
  exportPatches,
  findDependentAppliedPatches,
  findLatestAppliedPatchByPath,
  importPatches,
  loadPatch,
  nextPatchId,
  replayAppliedPatches,
  storePatch,
} from "./patch-store.ts";

export {
  capabilityManageToolDef,
  executeManageTool,
} from "./manage-tool.ts";

// ── secret_profile_manage (v1.2.0+) ─────────────────────────────────
export {
  executeSecretProfileManage,
  type SecretProfileManageContext,
  secretProfileManageToolDef,
} from "./secret-profile-manage.ts";

// ── SKILL.md frontmatter ─────────────────────────────────────────────
export type {
  CrabClawSkillMetadata,
  ParsedSkill,
  SkillAgentConfig,
  SkillMode,
  SkillToolSchema,
  SkillToolStep,
} from "./skill-frontmatter.ts";

export {
  metadataToSkillNodeData,
  parseFrontmatter,
  parseSkillFrontmatter,
  resolveCrabClawMetadata,
  resolveToolNameFromTreeId,
} from "./skill-frontmatter.ts";

// ── Frontend codegen (dogfood) ───────────────────────────────────────
export type { GenFrontendOptions } from "./gen-frontend.ts";
export {
  generateFrontendConstants,
  generateFrontendJson,
} from "./gen-frontend.ts";
