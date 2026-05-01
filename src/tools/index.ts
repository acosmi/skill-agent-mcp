// Public surface for the natural-language SKILL tools.
//
// Each tool is registered as one MCP tool by the server (commit #17):
//   - `skill_suggest`  — recommend a starting template from free-form text
//   - `skill_generate` — validate-then-save a SKILL.md draft
//   - `skill_manage`   — list / get / update / delete / export SKILLs
//   - `skill_activate` — invoke a SKILL through the dispatcher to verify

export {
  ALL_SKILL_TEMPLATE_NAMES,
  executeSkillSuggest,
  type SkillSuggestContext,
  type SkillSuggestInput,
  type SkillSuggestOutput,
  SKILL_SUGGEST_INPUT_SCHEMA,
  type SkillTemplateName,
} from "./skill-suggest.ts";

export {
  executeSkillGenerate,
  type SkillGenerateContext,
  type SkillGenerateInput,
  type SkillGenerateOutput,
  SKILL_GENERATE_INPUT_SCHEMA,
} from "./skill-generate.ts";

export {
  executeSkillManage,
  type SkillManageAction,
  type SkillManageContext,
  type SkillManageInput,
  type SkillManageListEntry,
  type SkillManageOutput,
  SKILL_MANAGE_INPUT_SCHEMA,
} from "./skill-manage.ts";

export {
  executeSkillActivate,
  type SkillActivateContext,
  type SkillActivateInput,
  type SkillActivateOutput,
  SKILL_ACTIVATE_INPUT_SCHEMA,
  type SkillResolution,
  type SkillResolverWithBody,
  staticSkillResolver,
} from "./skill-activate.ts";
