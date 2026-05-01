// Public surface for the codegen subsystem.
//
// Skill-to-Tool codegen takes SKILL.md `tool_schema.steps[]` and
// compiles them into a callable composed-tool definition that the
// executor can run. The store persists compiled tools across MCP server
// restarts.

export type {
  CodegenError,
  CodegenResult,
  CompiledStep,
  ComposedToolDef,
  ComposedToolStoreData,
  StepResult,
} from "./types.ts";

export { COMPOSED_TOOL_STORE_VERSION } from "./types.ts";

export {
  COMPOSED_TOOLS_FILENAME,
  ComposedToolStore,
  composedStorePath,
  loadComposedToolStore,
  type LoadStoreResult,
  saveComposedToolStore,
} from "./store.ts";

export {
  APPROVAL_PRIORITY,
  codegen,
  codegenIncremental,
  compileSteps,
  deriveMaxApproval,
  normalizeApproval,
  normalizeOnError,
  sanitizeName,
  sha256Hex,
  type SkillInput,
  type StepInput,
  type ToolSchemaInput,
  type ToolTreeLookup,
  type ToolTreeLookupResult,
} from "./codegen.ts";

export {
  type ComposedToolDefSummary,
  ComposedSubsystem,
  type ExecuteToolFn,
  formatComposedResult,
  lookupPath,
  resolveInputMap,
  resolveTemplate,
  resolveVar,
} from "./executor.ts";
