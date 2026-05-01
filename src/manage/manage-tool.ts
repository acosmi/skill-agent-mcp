// capability_manage meta-tool — 13 actions covering inspection,
// validation, diagnosis, prompt generation, sub-agent enumeration, and
// patch-based mutation. Translated from
// crabclaw/backend/internal/agents/capabilities/manage_tool.go.
//
// Translation choices vs Go original:
// - executeManageTool() takes the CapabilityTree as an explicit argument
//   (the Go original calls DefaultTree() internally). This keeps the
//   framework dependency-injection-friendly and avoids mandating a
//   singleton for users who manage their own tree lifecycle.
// - apply_patch / revert_patch mutate the passed-in tree directly. Users
//   who want RCU semantics can clone() the tree before passing in.
// - Approval gate (approved=true) preserved.
// - The dispatcher table-driven design (manageActions table → both
//   handler dispatch and JSON schema enum) preserved — single source of
//   truth survives translation.

import type {
  CapabilityNode,
  CapabilityTree,
} from "../capabilities/index.ts";
import {
  subAgentTreeFor,
  tierIndex,
  VALID_TIERS,
} from "../capabilities/index.ts";

import {
  applyOperation,
  findDependentAppliedPatches,
  loadPatch,
  nextPatchId,
  storePatch,
} from "./patch-store.ts";

import type {
  DiagnoseResult,
  ManageInput,
  ManageResult,
  PatchOperation,
  ProposeNodeSpec,
  SubTreeInfo,
  TreeNodeView,
  TreePatch,
  ValidationIssue,
  ValidationResult,
} from "./types.ts";

// ── Action descriptors ────────────────────────────────────────────────

interface ManageAction {
  name: string;
  description: string;
  handler: (tree: CapabilityTree, input: ManageInput) => ManageResult;
  mutates?: boolean;
}

const MANAGE_ACTIONS: ManageAction[] = [
  { name: "tree", description: "View capability tree structure (subtree filter, depth control)", handler: executeManageTree },
  { name: "inspect", description: "View single node metadata (all 7 dimensions)", handler: executeManageInspect },
  { name: "validate", description: "Three-level validation (L1 Node → L2 Cross-Node → L3 System)", handler: executeManageValidate },
  { name: "diagnose", description: "Drift diagnosis (tree vs derivation consumers)", handler: executeManageDiagnose },
  { name: "generate_prompt", description: "Generate prompt section for a given tier", handler: executeManageGeneratePrompt },
  { name: "generate_allowlist", description: "Generate tool allowlist for a given tier", handler: executeManageGenerateAllowlist },
  { name: "subtrees", description: "List registered sub-agent capability sub-tree branches", handler: executeManageSubtrees },
  { name: "propose_register", description: "Propose registering a new tool node", handler: executeManageProposeRegister },
  { name: "propose_update", description: "Propose updating node fields", handler: executeManageProposeUpdate },
  { name: "propose_routing", description: "Propose routing rule changes", handler: executeManageProposeRouting },
  { name: "propose_binding", description: "Propose skill binding changes", handler: executeManageProposeBinding },
  { name: "apply_patch", description: "Apply approved patch (requires approved=true)", handler: executeManageApplyPatch, mutates: true },
  { name: "revert_patch", description: "Revert previously-applied patch (requires approved=true)", handler: executeManageRevertPatch, mutates: true },
];

const MANAGE_ACTIONS_BY_NAME = new Map(MANAGE_ACTIONS.map((a) => [a.name, a]));
const MANAGE_ACTION_NAMES = MANAGE_ACTIONS.map((a) => a.name);

/**
 * Dispatch a capability_manage tool call.
 *
 * @param inputJson - JSON-serialized ManageInput.
 * @param tree - The capability tree to operate on.
 * @returns JSON-serialized ManageResult.
 *
 * Phase A actions (tree / inspect / validate / diagnose / generate_*  /
 * subtrees) are read-only. Phase B propose_* actions create patches in
 * the patch store without mutating the tree. apply_patch / revert_patch
 * mutate the passed-in tree directly (no implicit RCU — call clone()
 * before passing if you need that).
 */
export function executeManageTool(
  inputJson: string,
  tree: CapabilityTree,
): string {
  let input: ManageInput;
  try {
    input = JSON.parse(inputJson) as ManageInput;
  } catch (err) {
    return formatManageError("", `invalid input: ${String(err)}`);
  }
  const action = MANAGE_ACTIONS_BY_NAME.get(input.action ?? "");
  if (action === undefined) {
    return formatManageError(
      input.action ?? "",
      `unknown action "${input.action}"; valid actions: ${MANAGE_ACTION_NAMES.join(", ")}`,
    );
  }
  const result = action.handler(tree, input);
  return JSON.stringify(result, null, 2);
}

/** LLM tool definition (name + description + JSON Schema). */
export function capabilityManageToolDef(): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
} {
  const descLines: string[] = [
    "Inspect, diagnose, and manage the capability tree. Actions:",
  ];
  for (const a of MANAGE_ACTIONS) {
    let line = `- ${a.name}: ${a.description}`;
    if (a.mutates === true) line += " [mutates; requires approved=true]";
    descLines.push(line);
  }
  return {
    name: "capability_manage",
    description: descLines.join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: MANAGE_ACTION_NAMES,
          description: "The action to perform",
        },
        nodeId: { type: "string", description: "Node ID for inspect/propose_*; or subtree root for tree" },
        depth: { type: "integer", description: "Max depth for tree action (0 = unlimited)" },
        tier: { type: "string", enum: [...VALID_TIERS], description: "Intent tier" },
        level: { type: "integer", description: "Validation level: 1/2/3 (0 = all)" },
        nodeSpec: { type: "object", description: "Node specification for propose_register" },
        updates: { type: "object", description: "Partial fields for propose_update/routing/binding" },
        patchId: { type: "string", description: "Patch ID for apply_patch/revert_patch" },
        approved: { type: "boolean", description: "Approval flag" },
      },
      required: ["action"],
    },
  };
}

function formatManageError(action: string, message: string): string {
  return JSON.stringify({ action, success: false, error: message }, null, 2);
}

// ── helpers ───────────────────────────────────────────────────────────

function resolveNodeByIdOrName(
  tree: CapabilityTree,
  idOrName: string,
): [CapabilityNode | undefined, string] {
  if (idOrName === "") return [undefined, ""];
  const byId = tree.lookup(idOrName);
  if (byId !== undefined) return [byId, "id"];
  const byName = tree.lookupByName(idOrName);
  if (byName !== undefined) return [byName, "name"];
  return [undefined, ""];
}

function isSubAgentScoped(n: CapabilityNode): boolean {
  return (
    n.runtime !== undefined &&
    n.runtime.subagentScope !== undefined &&
    n.runtime.subagentScope !== ""
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function nowNano(): number {
  // Date.now() is ms; multiply for ns. performance.now() origin differs by
  // platform. ms*1e6 is sufficient since createdAtNano just provides
  // tie-break vs createdAt.
  return Date.now() * 1_000_000;
}

// ── action: tree ──────────────────────────────────────────────────────

function executeManageTree(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  if (input.nodeId !== undefined && input.nodeId !== "") {
    const root = tree.lookup(input.nodeId);
    if (root === undefined) {
      return { action: "tree", success: false, error: `node "${input.nodeId}" not found` };
    }
    return {
      action: "tree",
      success: true,
      data: buildTreeView(tree, root, input.depth ?? 0, 0),
    };
  }
  const roots: TreeNodeView[] = [];
  for (const id of tree.rootChildren) {
    const node = tree.lookup(id);
    if (node === undefined) continue;
    roots.push(buildTreeView(tree, node, input.depth ?? 0, 0));
  }
  return { action: "tree", success: true, data: roots };
}

function buildTreeView(
  tree: CapabilityTree,
  node: CapabilityNode,
  maxDepth: number,
  currentDepth: number,
): TreeNodeView {
  const view: TreeNodeView = { id: node.id, name: node.name, kind: node.kind };
  if (node.routing?.minTier !== undefined && node.routing.minTier !== "") {
    view.minTier = node.routing.minTier;
  }
  if (node.prompt?.summary !== undefined && node.prompt.summary !== "") {
    view.summary = node.prompt.summary;
  }
  if (node.runtime?.dynamic === true) {
    view.dynamic = true;
  }
  if (maxDepth > 0 && currentDepth >= maxDepth) return view;
  for (const childId of node.children) {
    const child = tree.lookup(childId);
    if (child === undefined) continue;
    view.children ??= [];
    view.children.push(buildTreeView(tree, child, maxDepth, currentDepth + 1));
  }
  return view;
}

// ── action: inspect ───────────────────────────────────────────────────

function executeManageInspect(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  if (input.nodeId === undefined || input.nodeId === "") {
    return { action: "inspect", success: false, error: "nodeId is required for inspect action" };
  }
  const [node, matchedBy] = resolveNodeByIdOrName(tree, input.nodeId);
  if (node === undefined) {
    return { action: "inspect", success: false, error: `node "${input.nodeId}" not found` };
  }
  if (matchedBy === "name") {
    return {
      action: "inspect",
      success: true,
      data: {
        node,
        matchedBy: "name",
        warning: `nodeId "${input.nodeId}" matched by tool Name not tree ID; canonical ID is "${node.id}"`,
      },
    };
  }
  return { action: "inspect", success: true, data: node };
}

// ── action: validate ──────────────────────────────────────────────────

function executeManageValidate(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  const vr: ValidationResult = {
    level1Pass: true,
    level2Pass: true,
    level3Pass: true,
    issues: [],
  };
  const lvl = input.level ?? 0;
  if (lvl === 0 || lvl === 1) {
    const issues = validateLevel1(tree);
    if (issues.length > 0) {
      vr.level1Pass = false;
      vr.issues.push(...issues);
    }
  }
  if (lvl === 0 || lvl === 2) {
    const issues = validateLevel2(tree);
    if (issues.length > 0) {
      vr.level2Pass = false;
      vr.issues.push(...issues);
    }
  }
  if (lvl === 0 || lvl === 3) {
    const issues = validateLevel3(tree);
    if (issues.length > 0) {
      vr.level3Pass = false;
      vr.issues.push(...issues);
    }
  }
  return { action: "validate", success: true, data: vr };
}

function validateLevel1(tree: CapabilityTree): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  tree.walk((n) => {
    if (n.kind === "group") return true;
    if (n.prompt === undefined || n.prompt.summary === "") {
      issues.push({ level: 1, nodeId: n.id, message: "Prompt.Summary is empty" });
    }
    if (n.routing === undefined || n.routing.minTier === "") {
      issues.push({ level: 1, nodeId: n.id, message: "Routing.MinTier is empty" });
    } else if (tierIndex(n.routing.minTier) < 0) {
      issues.push({
        level: 1,
        nodeId: n.id,
        message: `Routing.MinTier "${n.routing.minTier}" is not a valid tier`,
      });
    }
    if (
      n.runtime === undefined ||
      (n.runtime.dynamic !== true && n.runtime.owner === "")
    ) {
      issues.push({
        level: 1,
        nodeId: n.id,
        message: "Runtime.Owner is empty for non-dynamic node",
      });
    }
    return true;
  });
  return issues;
}

function validateLevel2(tree: CapabilityTree): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // L2-1 child minTier >= parent minTier
  tree.walk((n) => {
    if (n.kind !== "group" || n.routing === undefined) return true;
    const parentIdx = tierIndex(n.routing.minTier);
    if (parentIdx < 0) return true;
    for (const childId of n.children) {
      const child = tree.lookup(childId);
      if (child === undefined || child.kind === "group") continue;
      const childMinTier =
        child.routing?.minTier !== undefined && child.routing.minTier !== ""
          ? child.routing.minTier
          : "task_multimodal";
      const childIdx = tierIndex(childMinTier);
      if (childIdx >= 0 && childIdx < parentIdx) {
        issues.push({
          level: 2,
          nodeId: child.id,
          message: `MinTier "${childMinTier}" < parent "${n.id}" MinTier "${n.routing.minTier}"`,
        });
      }
    }
    return true;
  });
  // L2-2 dynamic group namePrefix uniqueness
  const prefixMap = new Map<string, string>();
  for (const g of tree.dynamicGroups()) {
    const prefix = g.runtime?.namePrefix;
    if (prefix === undefined || prefix === "") continue;
    const existing = prefixMap.get(prefix);
    if (existing !== undefined) {
      issues.push({
        level: 2,
        nodeId: g.id,
        message: `NamePrefix "${prefix}" overlaps with "${existing}"`,
      });
    }
    prefixMap.set(prefix, g.id);
  }
  return issues;
}

function validateLevel3(tree: CapabilityTree): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // L3-2 tier monotonicity
  for (let i = 1; i < VALID_TIERS.length; i++) {
    const lower = VALID_TIERS[i - 1]!;
    const higher = VALID_TIERS[i]!;
    const lowerAllow = tree.allowlistForTier(lower);
    const higherAllow = tree.allowlistForTier(higher);
    for (const name of lowerAllow.keys()) {
      if (higherAllow.has(name)) continue;
      const node = tree.lookupByToolHint(name);
      let excluded = false;
      if (node?.routing !== undefined) {
        for (const ex of node.routing.excludeFrom) {
          if (ex === higher) {
            excluded = true;
            break;
          }
        }
      }
      if (!excluded) {
        issues.push({
          level: 3,
          message: `Tool "${name}" in ${lower} allowlist but missing from ${higher} (monotonicity violation)`,
        });
      }
    }
  }
  // L3-3 every tool has summary
  const summaries = tree.toolSummaries();
  tree.walk((n) => {
    if (n.kind === "group") return true;
    if (isSubAgentScoped(n)) {
      if (n.prompt === undefined || n.prompt.summary === "") {
        issues.push({
          level: 3,
          nodeId: n.id,
          message: `Sub-agent tool "${n.name}" has no prompt summary`,
        });
      }
      return true;
    }
    if (!summaries.has(n.name)) {
      issues.push({
        level: 3,
        nodeId: n.id,
        message: `Tool "${n.name}" has no prompt summary (D1 gap)`,
      });
    }
    return true;
  });
  // L3-4 PolicyGroups naming convention
  const policyGroups = tree.policyGroups();
  for (const groupName of policyGroups.keys()) {
    if (!groupName.startsWith("group:")) {
      issues.push({
        level: 3,
        message: `PolicyGroup "${groupName}" does not follow 'group:*' naming convention`,
      });
    }
  }
  return issues;
}

// ── action: diagnose ──────────────────────────────────────────────────

function executeManageDiagnose(
  tree: CapabilityTree,
  _input: ManageInput,
): ManageResult {
  const checks: string[] = [];
  const allTools = tree.allStaticTools();
  const dynamicGroups = tree.dynamicGroups();
  let groupCount = 0;
  tree.walk((n) => {
    if (n.kind === "group" && (n.runtime === undefined || !n.runtime.dynamic)) {
      groupCount++;
    }
    return true;
  });

  const dynParts = dynamicGroups
    .map((g) => g.runtime?.namePrefix ?? "")
    .filter((p) => p !== "")
    .sort();
  const inventory = `${allTools.length} static + ${dynamicGroups.length} dynamic groups (${dynParts.join("/")}) + ${groupCount} groups`;

  // D1 prompt summaries
  const summaries = tree.toolSummaries();
  let d1Aligned = 0;
  for (const name of allTools) if (summaries.has(name)) d1Aligned++;
  checks.push(
    d1Aligned === allTools.length
      ? `✓ D1 prompt summaries: ${d1Aligned}/${allTools.length} aligned`
      : `⚠ D1 prompt summaries: ${d1Aligned}/${allTools.length} aligned (${allTools.length - d1Aligned} missing)`,
  );

  // D2 frontend tool policy
  let d2ProfileCount = 0;
  let d2GroupCount = 0;
  for (const n of tree.nodes.values()) {
    if (n.kind === "group" || n.policy === undefined) continue;
    if (n.policy.profiles.length > 0) d2ProfileCount++;
    if (n.policy.policyGroups.length > 0) d2GroupCount++;
  }
  checks.push(
    `✓ D2 frontend tool policy: ${d2ProfileCount} tools with profiles, ${d2GroupCount} with policy groups`,
  );

  // D3 intent allowlists
  let tiersOk = 0;
  for (const tier of VALID_TIERS) {
    if (tree.allowlistForTier(tier) !== undefined) tiersOk++;
  }
  checks.push(`✓ D3 intent allowlists: ${tiersOk}/${VALID_TIERS.length} tiers computed`);

  // D5 backend policy groups
  const policyGroups = tree.policyGroups();
  checks.push(`✓ D5 backend policy groups: ${policyGroups.size} groups defined`);

  // D7 display specs
  const displaySpecs = tree.displaySpecs();
  let d7Missing = 0;
  for (const name of allTools) if (!displaySpecs.has(name)) d7Missing++;
  checks.push(
    d7Missing === 0
      ? `✓ D7 tool display: ${displaySpecs.size}/${allTools.length} have display specs`
      : `⚠ D7 tool display: ${d7Missing}/${allTools.length} missing display specs`,
  );

  // D8 policy group naming
  let validGroups = 0;
  for (const groupName of policyGroups.keys()) {
    if (groupName.startsWith("group:")) validGroups++;
  }
  checks.push(
    `✓ D8 policy group naming: ${validGroups}/${policyGroups.size} follow 'group:' convention`,
  );

  // D9 skill bindings
  const bindable = tree.bindableTools();
  checks.push(`✓ D9 skill bindings: ${bindable.length} bindable tools`);

  const dr: DiagnoseResult = { inventory, checks };
  return { action: "diagnose", success: true, data: dr };
}

// ── action: generate_prompt ───────────────────────────────────────────

function executeManageGeneratePrompt(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  if (input.tier === undefined || input.tier === "") {
    return {
      action: "generate_prompt",
      success: false,
      error: "tier is required for generate_prompt action",
    };
  }
  if (tierIndex(input.tier) < 0) {
    return { action: "generate_prompt", success: false, error: `invalid tier "${input.tier}"` };
  }
  const nodes = tree.toolsForTier(input.tier);
  if (nodes.length === 0) {
    return {
      action: "generate_prompt",
      success: true,
      data: `(no tools available at tier "${input.tier}")`,
    };
  }
  interface Entry { name: string; summary: string; order: number; }
  const entries: Entry[] = nodes.map((n) => ({
    name: n.name,
    summary: n.prompt?.summary ?? "",
    order: n.prompt?.sortOrder ?? 999,
  }));
  entries.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name);
  });
  const lines: string[] = [`## Tooling (tier: ${input.tier})`, ""];
  for (const e of entries) {
    if (e.summary !== "") {
      lines.push(`- **${e.name}**: ${e.summary}`);
    } else {
      lines.push(`- **${e.name}**`);
    }
  }
  return { action: "generate_prompt", success: true, data: lines.join("\n") };
}

// ── action: generate_allowlist ────────────────────────────────────────

function executeManageGenerateAllowlist(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  if (input.tier === undefined || input.tier === "") {
    return {
      action: "generate_allowlist",
      success: false,
      error: "tier is required for generate_allowlist action",
    };
  }
  if (tierIndex(input.tier) < 0) {
    return { action: "generate_allowlist", success: false, error: `invalid tier "${input.tier}"` };
  }
  const allow = tree.allowlistForTier(input.tier);
  const names = [...allow.keys()].sort();
  return {
    action: "generate_allowlist",
    success: true,
    data: { tier: input.tier, count: names.length, tools: names },
  };
}

// ── action: subtrees ──────────────────────────────────────────────────

function executeManageSubtrees(
  tree: CapabilityTree,
  _input: ManageInput,
): ManageResult {
  const root = tree.lookup("subagent_trees");
  if (root === undefined) {
    return {
      action: "subtrees",
      success: true,
      data: { subtrees: [], note: "subagent_trees group not found" },
    };
  }
  const subtrees: SubTreeInfo[] = [];
  for (const childId of root.children) {
    const group = tree.lookup(childId);
    if (group === undefined || group.kind !== "group") continue;
    const idx = childId.lastIndexOf("/");
    const agentType = idx >= 0 ? childId.slice(idx + 1) : childId;
    const tools = tree.toolsForAgentScope(agentType);
    const toolNames = tools.map((t) => t.name);
    const registered = subAgentTreeFor(agentType) !== undefined;
    subtrees.push({
      agentType,
      groupId: childId,
      toolCount: toolNames.length,
      toolNames,
      registered,
    });
  }
  return { action: "subtrees", success: true, data: { subtrees } };
}

// ── action: propose_register ──────────────────────────────────────────

function executeManageProposeRegister(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  if (input.nodeSpec === undefined) {
    return {
      action: "propose_register",
      success: false,
      error: "nodeSpec is required for propose_register",
    };
  }
  const spec: ProposeNodeSpec = input.nodeSpec;
  if (spec.name === "") {
    return { action: "propose_register", success: false, error: "nodeSpec.name is required" };
  }
  if (spec.parent === "") {
    return { action: "propose_register", success: false, error: "nodeSpec.parent is required" };
  }
  if (spec.kind === undefined) {
    spec.kind = "tool";
  }
  // Safe-default-deny: required dimensions for new node (matches Go fix
  // for "hallucinated nodes default-active" risk).
  if (spec.runtime === undefined) {
    return {
      action: "propose_register",
      success: false,
      error: 'nodeSpec.runtime is required (specify owner and enabledWhen explicitly; use enabledWhen="deny" if unknown)',
    };
  }
  if (spec.runtime.owner === "") {
    return {
      action: "propose_register",
      success: false,
      error: "nodeSpec.runtime.owner is required",
    };
  }
  if (spec.runtime.enabledWhen === "") {
    return {
      action: "propose_register",
      success: false,
      error: 'nodeSpec.runtime.enabledWhen is required (set to "deny" if the tool should not activate by default)',
    };
  }
  if (spec.prompt === undefined || spec.prompt.summary === "") {
    return {
      action: "propose_register",
      success: false,
      error: "nodeSpec.prompt.summary is required — every capability must describe itself",
    };
  }
  if (spec.routing === undefined || spec.routing.minTier === "") {
    return {
      action: "propose_register",
      success: false,
      error: "nodeSpec.routing.minTier is required",
    };
  }
  if (tierIndex(spec.routing.minTier) < 0) {
    return {
      action: "propose_register",
      success: false,
      error: `nodeSpec.routing.minTier "${spec.routing.minTier}" is not a valid tier`,
    };
  }
  if (spec.perms === undefined || spec.perms.minSecurityLevel === "") {
    return {
      action: "propose_register",
      success: false,
      error: "nodeSpec.perms.minSecurityLevel is required (allowlist/sandboxed/full/deny)",
    };
  }
  const nodeId = `${spec.parent}/${spec.name}`;
  if (tree.lookup(nodeId) !== undefined) {
    return {
      action: "propose_register",
      success: false,
      error: `node "${nodeId}" already exists`,
    };
  }
  if (tree.lookup(spec.parent) === undefined) {
    return {
      action: "propose_register",
      success: false,
      error: `parent "${spec.parent}" not found`,
    };
  }
  const node: CapabilityNode = {
    id: nodeId,
    name: spec.name,
    kind: spec.kind,
    parent: spec.parent,
    children: [],
    runtime: spec.runtime,
    prompt: spec.prompt,
    routing: spec.routing,
    perms: spec.perms,
    skills: spec.skills ?? { bindable: false, boundSkills: [], guidance: false },
    display: spec.display,
    policy: spec.policy,
  };
  const patch: TreePatch = {
    id: nextPatchId(),
    action: "register",
    description: `Register new ${spec.kind} "${spec.name}" under "${spec.parent}"`,
    operations: [{ op: "add", path: nodeId, value: node }],
    createdAt: nowIso(),
    createdAtNano: nowNano(),
    status: "proposed",
  };
  storePatch(patch);
  return { action: "propose_register", success: true, data: patch };
}

// ── action: propose_update ────────────────────────────────────────────

function executeManageProposeUpdate(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  if (input.nodeId === undefined || input.nodeId === "") {
    return { action: "propose_update", success: false, error: "nodeId is required for propose_update" };
  }
  if (input.updates === undefined) {
    return { action: "propose_update", success: false, error: "updates is required for propose_update" };
  }
  const [node, matchedBy] = resolveNodeByIdOrName(tree, input.nodeId);
  if (node === undefined) {
    return { action: "propose_update", success: false, error: `node "${input.nodeId}" not found` };
  }
  const updates = input.updates as Partial<ProposeNodeSpec>;
  const ops: PatchOperation[] = [];
  if (updates.prompt !== undefined) ops.push({ op: "replace", path: node.id, field: "prompt", value: updates.prompt, old: node.prompt });
  if (updates.runtime !== undefined) ops.push({ op: "replace", path: node.id, field: "runtime", value: updates.runtime, old: node.runtime });
  if (updates.routing !== undefined) ops.push({ op: "replace", path: node.id, field: "routing", value: updates.routing, old: node.routing });
  if (updates.perms !== undefined) ops.push({ op: "replace", path: node.id, field: "perms", value: updates.perms, old: node.perms });
  if (updates.skills !== undefined) ops.push({ op: "replace", path: node.id, field: "skills", value: updates.skills, old: node.skills });
  if (updates.display !== undefined) ops.push({ op: "replace", path: node.id, field: "display", value: updates.display, old: node.display });
  if (updates.policy !== undefined) ops.push({ op: "replace", path: node.id, field: "policy", value: updates.policy, old: node.policy });

  if (ops.length === 0) {
    return { action: "propose_update", success: false, error: "no updatable fields found in updates" };
  }
  const patch: TreePatch = {
    id: nextPatchId(),
    action: "update",
    description: `Update ${ops.length} field(s) on "${node.id}"`,
    operations: ops,
    createdAt: nowIso(),
    createdAtNano: nowNano(),
    status: "proposed",
  };
  storePatch(patch);
  if (matchedBy === "name") {
    return {
      action: "propose_update",
      success: true,
      data: {
        patch,
        matchedBy: "name",
        warning: `nodeId "${input.nodeId}" matched by Name; canonical ID is "${node.id}"`,
      },
    };
  }
  return { action: "propose_update", success: true, data: patch };
}

// ── action: propose_routing ───────────────────────────────────────────

function executeManageProposeRouting(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  if (input.nodeId === undefined || input.nodeId === "") {
    return { action: "propose_routing", success: false, error: "nodeId is required for propose_routing" };
  }
  if (input.updates === undefined) {
    return { action: "propose_routing", success: false, error: "updates (NodeRouting fields) is required for propose_routing" };
  }
  const [node, matchedBy] = resolveNodeByIdOrName(tree, input.nodeId);
  if (node === undefined) {
    return { action: "propose_routing", success: false, error: `node "${input.nodeId}" not found` };
  }
  const newRouting = input.updates as { minTier?: string };
  if (
    newRouting.minTier !== undefined &&
    newRouting.minTier !== "" &&
    tierIndex(newRouting.minTier) < 0
  ) {
    return { action: "propose_routing", success: false, error: `invalid minTier "${newRouting.minTier}"` };
  }
  const patch: TreePatch = {
    id: nextPatchId(),
    action: "routing",
    description: `Update routing for "${node.id}"`,
    operations: [{ op: "replace", path: node.id, field: "routing", value: input.updates, old: node.routing }],
    createdAt: nowIso(),
    createdAtNano: nowNano(),
    status: "proposed",
  };
  storePatch(patch);
  const data: Record<string, unknown> = { patch };
  if (matchedBy === "name") {
    data.matchedBy = "name";
    data.warning = `nodeId "${input.nodeId}" matched by Name; canonical ID is "${node.id}"`;
  }
  return { action: "propose_routing", success: true, data };
}

// ── action: propose_binding ───────────────────────────────────────────

function executeManageProposeBinding(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  if (input.nodeId === undefined || input.nodeId === "") {
    return { action: "propose_binding", success: false, error: "nodeId is required for propose_binding" };
  }
  if (input.updates === undefined) {
    return { action: "propose_binding", success: false, error: "updates is required for propose_binding" };
  }
  const [node, matchedBy] = resolveNodeByIdOrName(tree, input.nodeId);
  if (node === undefined) {
    return { action: "propose_binding", success: false, error: `node "${input.nodeId}" not found` };
  }
  const patch: TreePatch = {
    id: nextPatchId(),
    action: "binding",
    description: `Update skill binding for "${node.id}"`,
    operations: [{ op: "replace", path: node.id, field: "skills", value: input.updates, old: node.skills }],
    createdAt: nowIso(),
    createdAtNano: nowNano(),
    status: "proposed",
  };
  storePatch(patch);
  if (matchedBy === "name") {
    return {
      action: "propose_binding",
      success: true,
      data: {
        patch,
        matchedBy: "name",
        warning: `nodeId "${input.nodeId}" matched by Name; canonical ID is "${node.id}"`,
      },
    };
  }
  return { action: "propose_binding", success: true, data: patch };
}

// ── action: apply_patch ───────────────────────────────────────────────

function executeManageApplyPatch(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  if (input.patchId === undefined || input.patchId === "") {
    return { action: "apply_patch", success: false, error: "patchId is required for apply_patch" };
  }
  const patch = loadPatch(input.patchId);
  if (patch === undefined) {
    return { action: "apply_patch", success: false, error: `patch "${input.patchId}" not found` };
  }
  if (patch.status === "applied") {
    return { action: "apply_patch", success: false, error: `patch "${input.patchId}" already applied` };
  }
  if (input.approved !== true) {
    return {
      action: "apply_patch",
      success: false,
      error: "apply_patch requires approval; set approved=true after obtaining approval",
    };
  }
  for (const op of patch.operations) {
    try {
      applyOperation(tree, op);
    } catch (err) {
      return {
        action: "apply_patch",
        success: false,
        error: `failed to apply operation (op=${op.op}, path=${op.path}): ${String(err)}`,
      };
    }
  }
  patch.status = "applied";
  // Re-validate after apply (matches Go's auto-trigger)
  const validation = executeManageValidate(tree, { action: "validate", level: 0 });
  return {
    action: "apply_patch",
    success: true,
    data: { patch, validation: validation.data },
  };
}

// ── action: revert_patch ──────────────────────────────────────────────

function executeManageRevertPatch(
  tree: CapabilityTree,
  input: ManageInput,
): ManageResult {
  if (input.patchId === undefined || input.patchId === "") {
    return { action: "revert_patch", success: false, error: "patchId is required for revert_patch" };
  }
  if (input.approved !== true) {
    return {
      action: "revert_patch",
      success: false,
      error: "revert_patch requires approved=true (same approval level as apply_patch)",
    };
  }
  const original = loadPatch(input.patchId);
  if (original === undefined) {
    return { action: "revert_patch", success: false, error: `patch "${input.patchId}" not found` };
  }
  if (original.status !== "applied") {
    return {
      action: "revert_patch",
      success: false,
      error: `patch "${input.patchId}" is not in applied state (have "${original.status}")`,
    };
  }
  // Dependency check
  const deps = findDependentAppliedPatches(original.id);
  if (deps.length > 0) {
    return {
      action: "revert_patch",
      success: false,
      error: `patch "${original.id}" has ${deps.length} downstream applied patch(es) modifying the same path(s): ${deps.join(", ")}. Revert blocked; revert them first.`,
      data: {
        patchId: original.id,
        blockedBy: deps,
        reason: "downstream_applied_patches",
        suggestedStrategy: "revert descendants in reverse order before retrying",
      },
    };
  }
  const reverseOps: PatchOperation[] = [];
  for (let i = original.operations.length - 1; i >= 0; i--) {
    const op = original.operations[i]!;
    switch (op.op) {
      case "add":
        reverseOps.push({ op: "remove", path: op.path });
        break;
      case "remove":
        if (op.old === undefined) {
          return {
            action: "revert_patch",
            success: false,
            error: `cannot revert remove on "${op.path}": Old value missing`,
          };
        }
        reverseOps.push({ op: "add", path: op.path, value: op.old });
        break;
      case "replace":
        if (op.old === undefined) {
          return {
            action: "revert_patch",
            success: false,
            error: `cannot revert replace on "${op.path}" field "${op.field ?? ""}": Old value missing`,
          };
        }
        reverseOps.push({
          op: "replace",
          path: op.path,
          field: op.field,
          value: op.old,
          old: op.value,
        });
        break;
    }
  }
  const revertPatch: TreePatch = {
    id: `revert-${original.id}`,
    action: "revert",
    description: `Revert of patch ${original.id}: ${original.description}`,
    operations: reverseOps,
    createdAt: nowIso(),
    createdAtNano: nowNano(),
    status: "proposed",
  };
  storePatch(revertPatch);
  for (const op of reverseOps) {
    try {
      applyOperation(tree, op);
    } catch (err) {
      return {
        action: "revert_patch",
        success: false,
        error: `reverse op failed (op=${op.op}, path=${op.path}): ${String(err)}`,
      };
    }
  }
  original.status = "reverted";
  revertPatch.status = "applied";
  return {
    action: "revert_patch",
    success: true,
    data: { original, revertPatch },
  };
}
