// In-memory patch store + tree-mutation helpers. Translated from
// crabclaw/backend/internal/agents/capabilities/{manage_tool.go,patch_store.go}.
//
// The Go original wraps everything in sync.RWMutex. The TS port drops the
// lock — JS event loop is single-threaded so map ops between awaits are
// atomic. Persistence is left to the framework user (call exportPatches()
// / importPatches() at startup/shutdown boundaries).

import type {
  CapabilityNode,
  CapabilityTree,
  NodeDisplay,
  NodePermissions,
  NodePolicy,
  NodePrompt,
  NodeRouting,
  NodeRuntime,
  NodeSkillBinding,
} from "../capabilities/index.ts";

import type { PatchOperation, TreePatch } from "./types.ts";

const patchStore = new Map<string, TreePatch>();

export function storePatch(patch: TreePatch): void {
  patchStore.set(patch.id, patch);
}

export function loadPatch(id: string): TreePatch | undefined {
  return patchStore.get(id);
}

/** Generate a unique patch ID. */
export function nextPatchId(): string {
  return `patch-${Date.now() * 1_000_000 + Math.floor(Math.random() * 1000)}`;
}

/** Test-only: clear the patch store. */
export function clearPatchStoreForTesting(): void {
  patchStore.clear();
}

/** All stored patches as an array snapshot (deep copy). */
export function exportPatches(): TreePatch[] {
  return Array.from(patchStore.values()).map(clonePatch);
}

/** Replace the patch store with the given array. */
export function importPatches(patches: TreePatch[]): void {
  patchStore.clear();
  for (const p of patches) {
    patchStore.set(p.id, clonePatch(p));
  }
}

function clonePatch(p: TreePatch): TreePatch {
  return {
    id: p.id,
    action: p.action,
    description: p.description,
    operations: p.operations.map((op) => ({ ...op })),
    createdAt: p.createdAt,
    createdAtNano: p.createdAtNano,
    status: p.status,
  };
}

/**
 * Replay all applied patches against a tree. Patches sorted by
 * createdAtNano (createdAt fallback for legacy entries with nano=0).
 */
export function replayAppliedPatches(tree: CapabilityTree): void {
  const applied: TreePatch[] = [];
  for (const p of patchStore.values()) {
    if (p.status === "applied") applied.push(p);
  }
  applied.sort((a, b) => {
    if (a.createdAtNano !== 0 && b.createdAtNano !== 0) {
      return a.createdAtNano - b.createdAtNano;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
  for (const p of applied) {
    for (const op of p.operations) {
      try {
        applyOperation(tree, op);
      } catch (err) {
        console.warn(
          `replayAppliedPatches: ${p.id} op ${op.op} ${op.path} failed:`,
          err,
        );
      }
    }
  }
}

/** Apply a single PatchOperation to a tree. Throws on error. */
export function applyOperation(
  tree: CapabilityTree,
  op: PatchOperation,
): void {
  switch (op.op) {
    case "add": {
      if (op.value === undefined || op.value === null) {
        throw new Error(`add op missing value: ${op.path}`);
      }
      tree.addNode(op.value as CapabilityNode);
      return;
    }
    case "replace": {
      const node = tree.lookup(op.path);
      if (node === undefined) {
        throw new Error(`node "${op.path}" not found for replace`);
      }
      if (op.field === undefined) {
        throw new Error(`replace op missing field: ${op.path}`);
      }
      applyFieldReplace(node, op.field, op.value);
      return;
    }
    case "remove": {
      tree.removeNode(op.path);
      return;
    }
  }
}

function applyFieldReplace(
  node: CapabilityNode,
  field: string,
  value: unknown,
): void {
  switch (field) {
    case "prompt":
      node.prompt = value as NodePrompt | undefined;
      return;
    case "routing":
      node.routing = value as NodeRouting | undefined;
      return;
    case "runtime":
      node.runtime = value as NodeRuntime | undefined;
      return;
    case "perms":
      node.perms = value as NodePermissions | undefined;
      return;
    case "skills":
      node.skills = value as NodeSkillBinding | undefined;
      return;
    case "display":
      node.display = value as NodeDisplay | undefined;
      return;
    case "policy":
      node.policy = value as NodePolicy | undefined;
      return;
    default:
      throw new Error(`unknown field "${field}"`);
  }
}

/** Find the most-recently-applied patch that touches the given node ID. */
export function findLatestAppliedPatchByPath(
  nodeId: string,
): string | undefined {
  let bestId: string | undefined;
  let bestTime = "";
  for (const [id, p] of patchStore) {
    if (p.status !== "applied") continue;
    for (const op of p.operations) {
      if (op.path === nodeId) {
        if (p.createdAt > bestTime) {
          bestTime = p.createdAt;
          bestId = id;
        }
        break;
      }
    }
  }
  return bestId;
}

/**
 * Find applied patches that depend on (modify the same paths as) patchId.
 * Returns patch IDs sorted by createdAt ascending. Empty array means no
 * dependents (safe to revert).
 */
export function findDependentAppliedPatches(patchId: string): string[] {
  const base = patchStore.get(patchId);
  if (base === undefined || base.status !== "applied") return [];

  const paths = new Set<string>();
  for (const op of base.operations) {
    if (op.path !== "") paths.add(op.path);
  }
  if (paths.size === 0) return [];

  function laterThan(a: TreePatch, b: TreePatch): boolean {
    if (a.createdAtNano !== 0 && b.createdAtNano !== 0) {
      return a.createdAtNano > b.createdAtNano;
    }
    return a.createdAt > b.createdAt;
  }

  const deps: TreePatch[] = [];
  for (const [id, p] of patchStore) {
    if (id === patchId || p.status !== "applied" || p.action === "revert") continue;
    if (!laterThan(p, base)) continue;
    for (const op of p.operations) {
      if (paths.has(op.path)) {
        deps.push(p);
        break;
      }
    }
  }
  deps.sort((a, b) => (laterThan(b, a) ? -1 : 1));
  return deps.map((p) => p.id);
}
