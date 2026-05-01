// Aggregating SkillNodeProvider — multi-source SKILL.md merge with
// canonical-rank tie-breaking and alias demotion.
//
// Translated from crabclaw skill_node_provider.go (~380 LoC Go) with
// the following deliberate divergences for the OSS framework:
//
//   - The Go side reaches into a process-global `ProviderConfigGetter`
//     to discover sources at load time. We instead require the caller
//     to hand us a pre-resolved `LoadedSkillEntry[]`. That keeps the
//     library free of disk / env / process-global side-effects and lets
//     OSS users plug in arbitrary loaders (filesystem, embedded
//     manifests, remote registries, in-memory test fixtures, ...).
//
//   - We drop `sync.RWMutex` / `atomic.Pointer`. Node uses a single
//     event loop, so a per-instance cache is enough.
//
//   - Logging is omitted. Go uses `slog`; OSS users wire their own
//     observability.
//
//   - The Go-side `BundledSkillNodeProvider` alias is dropped: the
//     provider is named consistently for its true behaviour from the
//     start.

import type {
  SkillNodeData,
  SkillNodeProvider,
} from "../capabilities/index.ts";
import type { ExtendedSkillMetadata } from "./types.ts";

// ── Source enumeration ─────────────────────────────────────────────

export type SkillSource =
  | "bundled"
  | "extra"
  | "managed"
  | "user"
  | "workspace";

/** A pre-loaded SKILL.md entry tagged with its source. */
export interface LoadedSkillEntry {
  source: SkillSource;
  metadata: ExtendedSkillMetadata;
  /**
   * Top-level `description` field from the SKILL.md frontmatter, used as
   * the `summary` fallback when `metadata.summary` is empty (mirrors the
   * Go `buildSkillNodeDataFromEntry` semantics).
   */
  description?: string;
}

export interface AggregateMetrics {
  bundledCount: number;
  nonBundledCount: number;
  treeNodeCount: number;
  aliasCount: number;
}

/** Returns priority weight (higher = more canonical). 0 for unknown. */
export function sourcePriority(source: SkillSource): number {
  switch (source) {
    case "workspace":
      return 5;
    case "user":
      return 4;
    case "managed":
      return 3;
    case "extra":
      return 2;
    case "bundled":
      return 1;
    default:
      return 0;
  }
}

// ── SkillNodeData builder ──────────────────────────────────────────

/**
 * Build a `SkillNodeData` from extended SKILL.md metadata.
 *
 * Empty / zero-valued fields preserve the "do not override" contract
 * the v1.0 mergeNodeData expects (see capabilities/providers.ts).
 *
 * Translated from crabclaw skill_node_provider.go:323-380
 * (`buildSkillNodeDataCore`).
 */
export function buildSkillNodeData(
  metadata: ExtendedSkillMetadata,
  descriptionFallback?: string,
): SkillNodeData {
  // Derive name from tools[0] when treeID basename != tools[0]
  let name = "";
  const treeID = metadata.treeId ?? "";
  const tools = metadata.tools ?? [];
  if (tools.length > 0) {
    let suffix = treeID;
    const idx = treeID.lastIndexOf("/");
    if (idx >= 0) suffix = treeID.slice(idx + 1);
    if (tools[0] !== suffix && tools[0] !== undefined) {
      name = tools[0];
    }
  }

  // Summary fallback: metadata.summary, then descriptionFallback
  const summary = metadata.summary ?? descriptionFallback ?? "";

  const data: SkillNodeData = {
    treeGroup: metadata.treeGroup ?? "",
    name,
    enabledWhen: metadata.enabledWhen ?? "",
    summary,
    sortOrder: metadata.sortOrder ?? 0,
    usageGuide: metadata.usageGuide ?? "",
    intentHints: metadata.intentHints ?? {},
    minTier: metadata.minTier ?? "",
    excludeFrom: metadata.excludeFrom ?? [],
    intentPriority: metadata.intentPriority ?? 0,
    minSecurityLevel: metadata.securityLevel ?? "",
    fileAccess: metadata.fileAccess ?? "",
    approvalType: metadata.approvalType ?? "",
    scopeCheck: metadata.scopeCheck ?? "",
    bindable: tools.length > 0,
    icon: metadata.emoji ?? "",
    title: metadata.title ?? "",
    label: metadata.label ?? "",
    verb: metadata.verb ?? "",
    detailKeys: metadata.detailKeys ?? "",
    policyGroups: metadata.policyGroups ?? [],
    profiles: metadata.profiles ?? [],
    wizardGroup: metadata.wizardGroup ?? "",
    toolInputSchema: metadata.toolInputSchema,
    toolDescription: metadata.toolDescription ?? "",
  };

  if (metadata.escalationHints) {
    data.escalationHints = metadata.escalationHints;
  }

  return data;
}

// ── Aggregation ────────────────────────────────────────────────────

interface Candidate {
  entry: LoadedSkillEntry;
  data: SkillNodeData;
  source: SkillSource;
  treeID: string;
}

export interface AggregateResult {
  nodes: Map<string, SkillNodeData>;
  sourcesByTreeID: Map<string, SkillSource>;
  /** demoted treeID → canonical treeID */
  aliases: Map<string, string>;
  bundledCount: number;
  nonBundledCount: number;
}

/**
 * Pure aggregation function. Collapses entries from multiple sources
 * onto a single canonical tree-id per "tool name", honouring source
 * priority first and field-completeness second.
 *
 * Filtering: only entries whose `metadata.category` is `"tools"` or
 * begins with `"tools/"` are considered; everything else (operations,
 * agents, subsystems, internal) is silently skipped to avoid
 * polluting the capability tree.
 */
export function aggregateSkillEntries(
  entries: readonly LoadedSkillEntry[],
): AggregateResult {
  const candidates: Candidate[] = [];
  let bundledCount = 0;
  let nonBundledCount = 0;

  for (const entry of entries) {
    const treeID = entry.metadata.treeId;
    if (!treeID) continue;
    const cat = entry.metadata.category ?? "";
    if (cat !== "tools" && !cat.startsWith("tools/")) continue;
    const data = buildSkillNodeData(entry.metadata, entry.description);
    candidates.push({ entry, data, source: entry.source, treeID });
    if (entry.source === "bundled") bundledCount++;
    else nonBundledCount++;
  }

  // Stable sort: priority descending, then treeID ascending.
  candidates.sort((a, b) => {
    const pa = sourcePriority(a.source);
    const pb = sourcePriority(b.source);
    if (pa !== pb) return pb - pa;
    return a.treeID.localeCompare(b.treeID);
  });

  const result = new Map<string, SkillNodeData>();
  const sourcesByTreeID = new Map<string, SkillSource>();
  const chosenByName = new Map<string, string>();
  const chosenRank = new Map<string, number>();
  const aliases = new Map<string, string>();

  for (const c of candidates) {
    const resolvedName = toolNameOf(c.data, c.treeID);
    const incomingRank = canonicalRank(c.entry.metadata, resolvedName, c.source);

    // Same tree_id already present?
    if (result.has(c.treeID)) {
      const existingRank = chosenRank.get(c.treeID) ?? 0;
      if (incomingRank > existingRank) {
        result.set(c.treeID, c.data);
        chosenRank.set(c.treeID, incomingRank);
        sourcesByTreeID.set(c.treeID, c.source);
      }
      continue;
    }

    // Same tool name already bound to a different tree_id?
    const existingTreeID = chosenByName.get(resolvedName);
    if (existingTreeID !== undefined) {
      const existingRank = chosenRank.get(existingTreeID) ?? 0;
      if (incomingRank > existingRank) {
        result.delete(existingTreeID);
        chosenRank.delete(existingTreeID);
        sourcesByTreeID.delete(existingTreeID);
        result.set(c.treeID, c.data);
        chosenByName.set(resolvedName, c.treeID);
        chosenRank.set(c.treeID, incomingRank);
        sourcesByTreeID.set(c.treeID, c.source);
        aliases.set(existingTreeID, c.treeID);
        aliases.delete(c.treeID);
      } else {
        aliases.set(c.treeID, existingTreeID);
      }
      continue;
    }

    result.set(c.treeID, c.data);
    chosenByName.set(resolvedName, c.treeID);
    chosenRank.set(c.treeID, incomingRank);
    sourcesByTreeID.set(c.treeID, c.source);
  }

  return {
    nodes: result,
    sourcesByTreeID,
    aliases,
    bundledCount,
    nonBundledCount,
  };
}

function toolNameOf(data: SkillNodeData, treeID: string): string {
  if (data.name) return data.name;
  let suffix = treeID;
  const idx = treeID.lastIndexOf("/");
  if (idx >= 0) suffix = treeID.slice(idx + 1);
  return suffix;
}

function canonicalRank(
  metadata: ExtendedSkillMetadata,
  resolvedName: string,
  src: SkillSource,
): number {
  // Priority weighting (factor 10) so source priority dominates field
  // completeness — matches Go semantics.
  let rank = sourcePriority(src) * 10;

  const treeID = metadata.treeId ?? "";
  let suffix = treeID;
  const idx = treeID.lastIndexOf("/");
  if (idx >= 0) suffix = treeID.slice(idx + 1);
  if (suffix === resolvedName) rank += 2;

  const tis = metadata.toolInputSchema;
  if (tis !== undefined && tis !== null && typeof tis === "object") {
    const keys = Object.keys(tis as Record<string, unknown>);
    if (keys.length > 0) rank += 1;
  }
  if (metadata.toolDescription) rank += 1;

  return rank;
}

// ── SkillNodeProvider implementation ───────────────────────────────

/**
 * Aggregating `SkillNodeProvider`. Wraps a pre-loaded entry list and
 * caches the aggregation result on first `loadSkillNodes()` call.
 *
 * For long-running servers that need to re-aggregate after disk
 * changes, dispose this instance and instantiate a fresh one with new
 * entries; we deliberately do not expose a mutate-in-place reload API
 * because the v1.0 `SkillNodeProvider` contract is sync and a partial
 * reload could leak state.
 */
export class AggregatedSkillNodeProvider implements SkillNodeProvider {
  private cachedNodes?: Map<string, SkillNodeData>;
  private cachedSources = new Map<string, SkillSource>();
  private cachedAliases = new Map<string, string>();
  private bundledCount = 0;
  private nonBundledCount = 0;

  constructor(
    private readonly entries: readonly LoadedSkillEntry[],
    eager = false,
  ) {
    if (eager) this.loadSkillNodes();
  }

  loadSkillNodes(): Map<string, SkillNodeData> {
    if (!this.cachedNodes) this.aggregate();
    // Non-null after aggregate(); narrow for TS strictness.
    return this.cachedNodes!;
  }

  /** treeID → source map (canonical only; demoted aliases excluded). */
  skillNodeSources(): Map<string, SkillSource> {
    if (!this.cachedNodes) this.aggregate();
    return new Map(this.cachedSources);
  }

  /** demoted treeID → canonical treeID map. */
  skillNodeAliases(): Map<string, string> {
    if (!this.cachedNodes) this.aggregate();
    return new Map(this.cachedAliases);
  }

  lastBundledNodeCount(): number {
    if (!this.cachedNodes) this.aggregate();
    return this.bundledCount;
  }

  metrics(): AggregateMetrics {
    if (!this.cachedNodes) this.aggregate();
    return {
      bundledCount: this.bundledCount,
      nonBundledCount: this.nonBundledCount,
      treeNodeCount: this.cachedNodes!.size,
      aliasCount: this.cachedAliases.size,
    };
  }

  private aggregate(): void {
    const result = aggregateSkillEntries(this.entries);
    this.cachedNodes = result.nodes;
    this.cachedSources = result.sourcesByTreeID;
    this.cachedAliases = result.aliases;
    this.bundledCount = result.bundledCount;
    this.nonBundledCount = result.nonBundledCount;
  }
}
