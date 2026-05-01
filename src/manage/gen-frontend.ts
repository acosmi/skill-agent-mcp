// Frontend constants codegen — generates a TS source file from a
// CapabilityTree for consumption by UI / CLI / SDK frontends.
//
// OSS framework re-design vs Go original
// (crabclaw/backend/internal/agents/capabilities/gen_frontend.go, 391
// lines): the Go version emits a hardcoded `tool-cards.ts` shape into
// a fixed crabclaw `ui/src/...` path. The TS port returns the
// generated source as a string and lets the caller decide where (if
// anywhere) to write it. Dogfood usage: the framework's own build
// pipeline consumes generateFrontendConstants() output for its
// internal dev tools.
//
// What's generated (per option flag — keep all by default):
//   - <prefix>_DISPLAY:        tool name → NodeDisplay record
//   - <prefix>_POLICY_GROUPS:  group name → member tool names
//   - <prefix>_WIZARD_GROUPS:  wizard group → member tool names
//   - <prefix>_TOOL_ORDER:     sorted tool name list (canonical display order)
//   - <prefix>_TOOL_SUMMARIES: tool name → prompt summary

import type { CapabilityTree } from "../capabilities/index.ts";

export interface GenFrontendOptions {
  /** Variable-name prefix for generated constants. Default: "TREE_CONSTANTS". */
  prefix?: string;
  /** Module header text (license / import statements). */
  header?: string;
  /** Set false to omit a particular section. */
  emitDisplay?: boolean;
  emitPolicyGroups?: boolean;
  emitWizardGroups?: boolean;
  emitToolOrder?: boolean;
  emitToolSummaries?: boolean;
}

/**
 * Generate a TS source file string with typed constants derived from
 * the capability tree. Section flags default to true; pass false to
 * omit a particular section.
 */
export function generateFrontendConstants(
  tree: CapabilityTree,
  options: GenFrontendOptions = {},
): string {
  const prefix = options.prefix ?? "TREE_CONSTANTS";
  const emitDisplay = options.emitDisplay !== false;
  const emitPolicyGroups = options.emitPolicyGroups !== false;
  const emitWizardGroups = options.emitWizardGroups !== false;
  const emitToolOrder = options.emitToolOrder !== false;
  const emitToolSummaries = options.emitToolSummaries !== false;

  const lines: string[] = [];
  if (options.header !== undefined && options.header !== "") {
    lines.push(options.header, "");
  }
  lines.push(
    "// Auto-generated from a capability tree by @acosmi/agent gen-frontend. Do not edit by hand.",
    "",
  );

  if (emitDisplay) {
    const displays = [...tree.displaySpecs()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    lines.push(`export const ${prefix}_DISPLAY = {`);
    for (const [name, display] of displays) {
      lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(display)},`);
    }
    lines.push("} as const;");
    lines.push("");
  }

  if (emitPolicyGroups) {
    const policyGroups = [...tree.policyGroups()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    lines.push(`export const ${prefix}_POLICY_GROUPS = {`);
    for (const [group, members] of policyGroups) {
      lines.push(`  ${JSON.stringify(group)}: ${JSON.stringify(members)},`);
    }
    lines.push("} as const;");
    lines.push("");
  }

  if (emitWizardGroups) {
    const wizardGroups = [...tree.wizardGroups()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    lines.push(`export const ${prefix}_WIZARD_GROUPS = {`);
    for (const [group, members] of wizardGroups) {
      lines.push(`  ${JSON.stringify(group)}: ${JSON.stringify(members)},`);
    }
    lines.push("} as const;");
    lines.push("");
  }

  if (emitToolOrder) {
    const toolOrder = tree.sortedToolSummaries().map((e) => e.name);
    lines.push(
      `export const ${prefix}_TOOL_ORDER = ${JSON.stringify(toolOrder, null, 2)} as const;`,
    );
    lines.push("");
  }

  if (emitToolSummaries) {
    const summaries = [...tree.toolSummaries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    lines.push(`export const ${prefix}_TOOL_SUMMARIES = {`);
    for (const [name, summary] of summaries) {
      lines.push(
        `  ${JSON.stringify(name)}: ${JSON.stringify(summary)},`,
      );
    }
    lines.push("} as const;");
  }

  return lines.join("\n");
}

/**
 * Generate a JSON file string with the same data as
 * generateFrontendConstants — useful when a non-TS consumer (Python /
 * Swift / Java) wants the same derivation outputs.
 */
export function generateFrontendJson(tree: CapabilityTree): string {
  return JSON.stringify(
    {
      display: Object.fromEntries(tree.displaySpecs()),
      policyGroups: Object.fromEntries(tree.policyGroups()),
      wizardGroups: Object.fromEntries(tree.wizardGroups()),
      toolOrder: tree.sortedToolSummaries().map((e) => e.name),
      toolSummaries: Object.fromEntries(tree.toolSummaries()),
    },
    null,
    2,
  );
}
