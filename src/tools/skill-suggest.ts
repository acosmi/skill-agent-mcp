// `skill_suggest` MCP tool — recommends a SKILL.md template based on
// the caller's free-form description.
//
// The recommendation is keyword-based, not LLM-driven, so it stays
// deterministic and zero-cost. The MCP server registers this tool so
// LLM clients can ask "I want a SKILL that does X — which template
// should I start from?" and get back a concrete template body to
// hand to the client LLM as a follow-up.

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ── Types ──────────────────────────────────────────────────────────

export type SkillTemplateName =
  | "tool"
  | "operations"
  | "agent"
  | "subsystem"
  | "internal";

export const ALL_SKILL_TEMPLATE_NAMES: readonly SkillTemplateName[] = [
  "tool",
  "operations",
  "agent",
  "subsystem",
  "internal",
];

export interface SkillSuggestInput {
  /** Free-form description of what the SKILL should do. */
  userRequest: string;
  /**
   * Optional list of capability hints (tool names / category names) the
   * SKILL is expected to use. Used to bump confidence; never overrides
   * an explicit keyword match.
   */
  preferredCapabilities?: readonly string[];
}

export interface SkillSuggestOutput {
  recommendedTemplate: SkillTemplateName;
  alternativeTemplates: SkillTemplateName[];
  rationale: string;
  templateBody: string;
  customizationHints: string[];
}

export interface SkillSuggestContext {
  /** Filesystem root containing the 5 template `.md` files. */
  templatesDir: string;
}

// ── MCP tool input schema ──────────────────────────────────────────

export const SKILL_SUGGEST_INPUT_SCHEMA = {
  type: "object",
  properties: {
    user_request: {
      type: "string",
      description: "Free-form description of what the SKILL should do.",
    },
    preferred_capabilities: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional capability hints (tool names / categories) used to boost confidence in the recommendation.",
    },
  },
  required: ["user_request"],
} as const;

// ── Keyword scoring ───────────────────────────────────────────────

interface TemplateScore {
  name: SkillTemplateName;
  score: number;
  hits: string[];
}

const TEMPLATE_KEYWORDS: ReadonlyMap<SkillTemplateName, readonly string[]> = new Map([
  [
    "tool",
    [
      "deterministic", "pipeline", "chain", "compose", "composed",
      "step", "steps", "sequence", "callable", "json schema", "input schema",
      "transform", "convert", "fetch", "query", "lookup",
    ],
  ],
  [
    "operations",
    [
      "playbook", "procedure", "runbook", "deploy", "release",
      "incident", "rollback", "checklist", "sop", "manual",
      "guidance", "walk through", "step-by-step",
    ],
  ],
  [
    "agent",
    [
      "agent", "sub-agent", "subagent", "specialist", "delegate",
      "assistant", "researcher", "coder", "media", "spawn",
      "role", "persona", "long-running", "autonomous",
    ],
  ],
  [
    "subsystem",
    [
      "subsystem", "bundle", "module", "package", "ecosystem",
      "documentation", "reference", "overview", "capability set",
    ],
  ],
  [
    "internal",
    [
      "internal", "fragment", "snippet", "scaffold", "shared prompt",
      "building block", "boilerplate", "include", "header",
      "system prompt fragment",
    ],
  ],
]);

function scoreTemplates(
  userRequest: string,
  preferredCapabilities: readonly string[] = [],
): TemplateScore[] {
  const lower = userRequest.toLowerCase();
  const capLower = preferredCapabilities.map((c) => c.toLowerCase());

  const out: TemplateScore[] = [];
  for (const [name, keywords] of TEMPLATE_KEYWORDS) {
    const hits: string[] = [];
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        score += kw.split(" ").length;
        hits.push(kw);
      }
    }
    // Capability hints add a small boost when they match the template's domain.
    for (const cap of capLower) {
      for (const kw of keywords) {
        if (cap.includes(kw)) {
          score += 1;
          hits.push(`cap:${cap}`);
          break;
        }
      }
    }
    out.push({ name, score, hits });
  }
  // Stable sort: highest score first, alphabetical tie-break.
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });
  return out;
}

// ── Entry point ────────────────────────────────────────────────────

/**
 * Recommend a SKILL.md template based on the caller's description.
 *
 * Returns the recommended template name, up to two alternatives, the
 * keyword hits driving the recommendation, the body of the recommended
 * template (read off disk), and a few customization hints derived from
 * the request itself.
 */
export async function executeSkillSuggest(
  input: SkillSuggestInput,
  context: SkillSuggestContext,
): Promise<SkillSuggestOutput> {
  if (!input.userRequest || !input.userRequest.trim()) {
    throw new Error("skill_suggest: user_request is required");
  }
  const scores = scoreTemplates(
    input.userRequest,
    input.preferredCapabilities,
  );
  // Default to "tool" when nothing matches — it's the most flexible
  // starting point for net-new SKILLs.
  const recommended =
    scores[0] && scores[0].score > 0 ? scores[0].name : "tool";

  const alternatives: SkillTemplateName[] = [];
  for (const s of scores) {
    if (s.name === recommended) continue;
    if (alternatives.length >= 2) break;
    if (s.score > 0) alternatives.push(s.name);
  }

  const templateBody = await readTemplate(context.templatesDir, recommended);

  const rationale = buildRationale(scores, recommended, input);
  const customizationHints = buildCustomizationHints(input, recommended);

  return {
    recommendedTemplate: recommended,
    alternativeTemplates: alternatives,
    rationale,
    templateBody,
    customizationHints,
  };
}

async function readTemplate(
  templatesDir: string,
  name: SkillTemplateName,
): Promise<string> {
  const file = path.join(templatesDir, `${name}.md`);
  return fs.readFile(file, "utf-8");
}

function buildRationale(
  scores: readonly TemplateScore[],
  recommended: SkillTemplateName,
  input: SkillSuggestInput,
): string {
  const top = scores.find((s) => s.name === recommended);
  if (!top || top.score === 0) {
    return `No keywords matched directly; defaulted to ${JSON.stringify(recommended)} as the most flexible starting point.`;
  }
  return (
    `Picked ${JSON.stringify(recommended)} based on keyword hits: ` +
    top.hits.slice(0, 5).map((h) => JSON.stringify(h)).join(", ") +
    `. Adjust if the SKILL needs a different mode.`
  );
}

function buildCustomizationHints(
  input: SkillSuggestInput,
  recommended: SkillTemplateName,
): string[] {
  const hints: string[] = [
    `Replace the placeholder tree_id / tree_group / summary with values that fit your domain.`,
  ];
  if (recommended === "tool" || recommended === "agent") {
    hints.push(
      `Trim the example tools list under \`allow:\` / \`steps[].tool\` to the specific tools your host has registered.`,
    );
  }
  if (recommended === "agent") {
    hints.push(
      `Decide \`runtime_kind\` (skill / coder / media) before authoring \`sop\` and \`review_gate\`.`,
    );
  }
  if (input.preferredCapabilities && input.preferredCapabilities.length > 0) {
    hints.push(
      `Wire the requested capabilities (${input.preferredCapabilities.join(", ")}) into the template's tool / step / allow lists.`,
    );
  }
  return hints;
}
