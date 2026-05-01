// `skill_manage` MCP tool — list / get / update / delete / export
// SKILL.md files in a directory the host owns.
//
// Useful for clients that want to inspect or rewrite their SKILL
// library without spawning a separate filesystem tool.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type ExtendedSkillMetadata,
  parseExtendedSkillFrontmatter,
  type SkillModeValidationError,
  validateSkillMode,
} from "../skill/index.ts";

// ── Types ──────────────────────────────────────────────────────────

export type SkillManageAction = "list" | "get" | "update" | "delete" | "export";

export interface SkillManageInput {
  action: SkillManageAction;
  /** Required for get / update / delete / export. */
  treeId?: string;
  /** Required for update — full replacement SKILL.md content. */
  skillMdContent?: string;
  /** Optional for list — restrict to a tree_group prefix. */
  treeGroupFilter?: string;
}

export interface SkillManageListEntry {
  treeId: string;
  treeGroup?: string;
  summary?: string;
  skillMode?: ExtendedSkillMetadata["skillMode"];
  filePath: string;
}

export interface SkillManageOutput {
  action: SkillManageAction;
  ok: boolean;
  /** Populated for `list`. */
  entries?: SkillManageListEntry[];
  /** Populated for `get` / `export`. */
  skillMdContent?: string;
  /** Populated for `get`. */
  metadata?: ExtendedSkillMetadata;
  /** Populated for `update` when the new content fails validation. */
  validateError?: SkillModeValidationError;
  /** Human-readable error message; populated when ok=false. */
  error?: string;
}

export interface SkillManageContext {
  /** Root directory the SKILL library lives under. */
  skillsDir: string;
  /**
   * Optional restriction — directory writes outside this root are
   * refused (defense-in-depth against directory traversal in
   * client-supplied tree_id).
   */
  workspaceRoot?: string;
}

// ── MCP tool input schema ──────────────────────────────────────────

export const SKILL_MANAGE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "get", "update", "delete", "export"],
      description:
        "Action to perform. list = enumerate; get / export = read; update = write; delete = remove.",
    },
    tree_id: {
      type: "string",
      description: "SKILL tree id (e.g. \"tools/fs/read_text\"). Required for non-list actions.",
    },
    skill_md_content: {
      type: "string",
      description:
        "Full replacement SKILL.md source. Required for the update action.",
    },
    tree_group_filter: {
      type: "string",
      description: "Optional list filter — only include SKILLs whose tree_group starts with this prefix.",
    },
  },
  required: ["action"],
} as const;

// ── Entry point ────────────────────────────────────────────────────

export async function executeSkillManage(
  input: SkillManageInput,
  context: SkillManageContext,
): Promise<SkillManageOutput> {
  switch (input.action) {
    case "list":
      return listSkills(input, context);
    case "get":
    case "export":
      return getSkill(input, context);
    case "update":
      return updateSkill(input, context);
    case "delete":
      return deleteSkill(input, context);
    default: {
      const _exhaustive: never = input.action;
      return {
        action: input.action,
        ok: false,
        error: `unknown action: ${JSON.stringify(_exhaustive)}`,
      };
    }
  }
}

// ── Per-action handlers ────────────────────────────────────────────

async function listSkills(
  input: SkillManageInput,
  context: SkillManageContext,
): Promise<SkillManageOutput> {
  const root = path.resolve(context.skillsDir);
  let files: string[];
  try {
    files = await collectSkillFiles(root);
  } catch (err) {
    return {
      action: "list",
      ok: false,
      error: `failed to enumerate ${JSON.stringify(root)}: ${errMsg(err)}`,
    };
  }

  const entries: SkillManageListEntry[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch {
      continue; // skip unreadable
    }
    const parsed = parseExtendedSkillFrontmatter(content);
    if (!parsed?.metadata?.treeId) continue;

    if (
      input.treeGroupFilter &&
      !(parsed.metadata.treeGroup ?? "").startsWith(input.treeGroupFilter)
    ) {
      continue;
    }

    entries.push({
      treeId: parsed.metadata.treeId,
      ...(parsed.metadata.treeGroup !== undefined && {
        treeGroup: parsed.metadata.treeGroup,
      }),
      ...(parsed.metadata.summary !== undefined && {
        summary: parsed.metadata.summary,
      }),
      ...(parsed.metadata.skillMode !== undefined && {
        skillMode: parsed.metadata.skillMode,
      }),
      filePath: file,
    });
  }

  entries.sort((a, b) => a.treeId.localeCompare(b.treeId));
  return { action: "list", ok: true, entries };
}

async function getSkill(
  input: SkillManageInput,
  context: SkillManageContext,
): Promise<SkillManageOutput> {
  if (!input.treeId) {
    return {
      action: input.action,
      ok: false,
      error: "tree_id is required",
    };
  }
  const root = path.resolve(context.skillsDir);
  const file = path.join(root, input.treeId, "SKILL.md");
  if (!isUnder(root, file)) {
    return {
      action: input.action,
      ok: false,
      error: `tree_id ${JSON.stringify(input.treeId)} resolves outside skills_dir`,
    };
  }
  let content: string;
  try {
    content = await fs.readFile(file, "utf-8");
  } catch (err) {
    return {
      action: input.action,
      ok: false,
      error: `read failed: ${errMsg(err)}`,
    };
  }
  const parsed = parseExtendedSkillFrontmatter(content);
  return {
    action: input.action,
    ok: true,
    skillMdContent: content,
    ...(parsed?.metadata !== undefined && { metadata: parsed.metadata }),
  };
}

async function updateSkill(
  input: SkillManageInput,
  context: SkillManageContext,
): Promise<SkillManageOutput> {
  if (!input.treeId) {
    return { action: "update", ok: false, error: "tree_id is required" };
  }
  if (!input.skillMdContent) {
    return {
      action: "update",
      ok: false,
      error: "skill_md_content is required",
    };
  }

  const root = path.resolve(context.skillsDir);
  const targetDir = path.join(root, input.treeId);
  const file = path.join(targetDir, "SKILL.md");
  if (!isUnder(root, file)) {
    return {
      action: "update",
      ok: false,
      error: `tree_id ${JSON.stringify(input.treeId)} resolves outside skills_dir`,
    };
  }
  if (
    context.workspaceRoot &&
    !isUnder(path.resolve(context.workspaceRoot), file)
  ) {
    return {
      action: "update",
      ok: false,
      error: `tree_id ${JSON.stringify(input.treeId)} resolves outside workspace_root`,
    };
  }

  // Validate content before touching disk.
  const parsed = parseExtendedSkillFrontmatter(input.skillMdContent);
  if (!parsed?.metadata) {
    return {
      action: "update",
      ok: false,
      error: "frontmatter parse failed or no recognized SKILL fields",
    };
  }
  const validateError = validateSkillMode(parsed.metadata);
  if (validateError) {
    return {
      action: "update",
      ok: false,
      validateError,
      metadata: parsed.metadata,
    };
  }

  try {
    await fs.mkdir(targetDir, { recursive: true });
    await writeFileAtomic(file, input.skillMdContent);
  } catch (err) {
    return {
      action: "update",
      ok: false,
      error: `write failed: ${errMsg(err)}`,
    };
  }
  return { action: "update", ok: true, metadata: parsed.metadata };
}

async function deleteSkill(
  input: SkillManageInput,
  context: SkillManageContext,
): Promise<SkillManageOutput> {
  if (!input.treeId) {
    return { action: "delete", ok: false, error: "tree_id is required" };
  }
  const root = path.resolve(context.skillsDir);
  const targetDir = path.join(root, input.treeId);
  const file = path.join(targetDir, "SKILL.md");
  if (!isUnder(root, file)) {
    return {
      action: "delete",
      ok: false,
      error: `tree_id ${JSON.stringify(input.treeId)} resolves outside skills_dir`,
    };
  }
  try {
    await fs.unlink(file);
  } catch (err) {
    return {
      action: "delete",
      ok: false,
      error: `delete failed: ${errMsg(err)}`,
    };
  }
  // Best-effort: drop the now-empty directory if it had no other files.
  try {
    const remaining = await fs.readdir(targetDir);
    if (remaining.length === 0) await fs.rmdir(targetDir);
  } catch {
    // dir not empty / already removed — fine.
  }
  return { action: "delete", ok: true };
}

// ── Helpers ────────────────────────────────────────────────────────

async function collectSkillFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, out);
  return out;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      out.push(full);
    }
  }
}

function isUnder(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

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
      // tmp already gone
    }
    throw err;
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
