// `skill_generate` MCP tool — accepts SKILL.md content authored by the
// client LLM, validates it, and persists it to disk.
//
// The actual authoring is done by the calling LLM (we never call out to
// an LLM ourselves — the framework is provider-agnostic). The MCP tool's
// job is to give the client a deterministic validate-then-save loop so
// it can iterate on a draft until the file passes validation.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type ExtendedSkillMetadata,
  parseExtendedSkillFrontmatter,
  type SkillModeValidationError,
  validateSkillMode,
} from "../skill/index.ts";
import { type SkillTemplateName } from "./skill-suggest.ts";

// ── Types ──────────────────────────────────────────────────────────

export interface SkillGenerateInput {
  /** Full SKILL.md source authored by the client LLM. */
  skillMdContent: string;
  /** Optional hint — which template the client started from. */
  baseTemplate?: SkillTemplateName;
  /**
   * Filesystem path under which the SKILL should be persisted. The
   * dispatcher writes `<skillDir>/SKILL.md` (creating the directory
   * if needed); the directory name should match the SKILL's tree_id
   * by convention but is not enforced.
   */
  skillDir: string;
  /** When true, refuse to overwrite an existing SKILL.md. */
  noOverwrite?: boolean;
}

export interface SkillGenerateOutput {
  saved: boolean;
  filePath: string;
  parseErrors?: string[];
  validateError?: SkillModeValidationError;
  metadata?: ExtendedSkillMetadata;
}

export interface SkillGenerateContext {
  /**
   * Optional restriction — when provided, the dispatcher refuses to
   * write outside this root (defense-in-depth against directory
   * traversal in `skillDir`). Hosts that fully trust their callers
   * can omit this.
   */
  workspaceRoot?: string;
}

// ── MCP tool input schema ──────────────────────────────────────────

export const SKILL_GENERATE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    skill_md_content: {
      type: "string",
      description:
        "Full SKILL.md source authored by the client LLM (frontmatter + body).",
    },
    base_template: {
      type: "string",
      enum: ["tool", "operations", "agent", "subsystem", "internal"],
      description:
        "Optional hint — which template the client started from. Used for diagnostics only; does not affect validation.",
    },
    skill_dir: {
      type: "string",
      description:
        "Filesystem path under which to persist the SKILL.md (e.g. `<skills_root>/<tree_id>`).",
    },
    no_overwrite: {
      type: "boolean",
      description:
        "Refuse to overwrite an existing SKILL.md at `skill_dir`. Defaults to false.",
    },
  },
  required: ["skill_md_content", "skill_dir"],
} as const;

// ── Entry point ────────────────────────────────────────────────────

/**
 * Validate-then-save a SKILL.md draft.
 *
 * Two failure paths return `saved: false` with structured error info
 * so the calling LLM can iterate on the draft:
 *   - Frontmatter parse failure or missing required fields.
 *   - SkillMode validation failure (mismatch between skill_mode and
 *     agent_config / tool_schema presence).
 *
 * On success, writes `<skillDir>/SKILL.md` atomically (tmp + rename).
 */
export async function executeSkillGenerate(
  input: SkillGenerateInput,
  context: SkillGenerateContext = {},
): Promise<SkillGenerateOutput> {
  if (!input.skillMdContent || !input.skillMdContent.trim()) {
    return {
      saved: false,
      filePath: "",
      parseErrors: ["skill_md_content is required"],
    };
  }
  if (!input.skillDir || !input.skillDir.trim()) {
    return {
      saved: false,
      filePath: "",
      parseErrors: ["skill_dir is required"],
    };
  }

  // Defense-in-depth: refuse paths outside workspaceRoot when the host
  // sets one. We resolve both to absolute + normalize for comparison.
  const resolvedSkillDir = path.resolve(input.skillDir);
  if (context.workspaceRoot) {
    const root = path.resolve(context.workspaceRoot);
    const rel = path.relative(root, resolvedSkillDir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return {
        saved: false,
        filePath: "",
        parseErrors: [
          `skill_dir ${JSON.stringify(input.skillDir)} resolves outside workspace_root`,
        ],
      };
    }
  }

  // Parse + validate.
  const parsed = parseExtendedSkillFrontmatter(input.skillMdContent);
  if (!parsed) {
    return {
      saved: false,
      filePath: "",
      parseErrors: [
        "frontmatter not found or unparseable (must start with `---` block)",
      ],
    };
  }
  if (!parsed.metadata) {
    return {
      saved: false,
      filePath: "",
      parseErrors: [
        "frontmatter parsed but no recognized SKILL fields detected (need at least tree_id + summary or skill_mode)",
      ],
    };
  }
  const validateError = validateSkillMode(parsed.metadata);
  if (validateError) {
    return {
      saved: false,
      filePath: "",
      validateError,
      metadata: parsed.metadata,
    };
  }

  // Persist.
  const filePath = path.join(resolvedSkillDir, "SKILL.md");
  if (input.noOverwrite) {
    try {
      await fs.access(filePath);
      return {
        saved: false,
        filePath,
        parseErrors: [
          `SKILL.md already exists at ${filePath} and no_overwrite=true`,
        ],
        metadata: parsed.metadata,
      };
    } catch {
      // File missing — proceed.
    }
  }

  await fs.mkdir(resolvedSkillDir, { recursive: true });
  await writeFileAtomic(filePath, input.skillMdContent);

  return {
    saved: true,
    filePath,
    metadata: parsed.metadata,
  };
}

// ── Atomic write helper ───────────────────────────────────────────

async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    await fs.writeFile(tmp, data, { encoding: "utf-8" });
    await fs.rename(tmp, filePath);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      // tmp may already be gone if rename succeeded then threw.
    }
    throw err;
  }
}
