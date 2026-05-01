// Composed Tool Store — in-memory map + atomic-write JSON persistence.
//
// Translated from crabclaw composed/store.go + atomic_write.go.
//
// Deliberate divergence from Go:
//   - Go uses a process-global `statepaths.ResolveStateDir()` to pick
//     the persistence path. We require the caller to supply a path
//     explicitly (ComposedToolStore is constructed with one). Keeps
//     the library free of OS / env side-effects.
//   - `sync.RWMutex` dropped — TS event loop serializes Map access.
//   - `slog.Warn` dropped; load-time errors return `{store, error?}`
//     so callers can log via their own observability.
//   - Atomic write uses `node:fs/promises` writeFile + rename. The Go
//     side handles Windows rename quirks via os.Rename which already
//     supports overwrite-rename on Windows ≥ Vista; node fs.rename
//     also supports it, so no extra retry loop is needed for the
//     local user-state file.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type ComposedToolDef,
  type ComposedToolStoreData,
  COMPOSED_TOOL_STORE_VERSION,
} from "./types.ts";

/** Persisted-store filename suffix appended to the supplied state dir. */
export const COMPOSED_TOOLS_FILENAME = "composed_tools.json";

/** Outcome from `loadComposedToolStore`. `error` is set on parse / read failure. */
export interface LoadStoreResult {
  store: ComposedToolStore;
  error?: Error;
}

/**
 * In-memory composed-tool store. Construct one per persistence path.
 *
 * The store is read-mostly; the lookup map is populated either by
 * `loadComposedToolStore(...)` (from disk) or programmatically via
 * `set(def)`. Use `saveComposedToolStore(store)` to flush back to disk.
 */
export class ComposedToolStore {
  version: number;
  updatedAt: string;
  private readonly tools: Map<string, ComposedToolDef>;

  constructor(init?: Partial<ComposedToolStoreData>) {
    this.version = init?.version ?? COMPOSED_TOOL_STORE_VERSION;
    this.updatedAt = init?.updatedAt ?? "";
    this.tools = new Map();
    if (init?.tools) {
      for (const [name, def] of Object.entries(init.tools)) {
        this.tools.set(name, def);
      }
    }
  }

  /** Returns the composed tool with this name, or undefined. */
  get(name: string): ComposedToolDef | undefined {
    return this.tools.get(name);
  }

  /** Registers (or replaces) a composed tool. */
  set(def: ComposedToolDef): void {
    this.tools.set(def.name, def);
  }

  /** Deletes a composed tool. Returns whether it existed. */
  delete(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Returns all registered composed-tool names (sorted). */
  names(): string[] {
    return Array.from(this.tools.keys()).sort();
  }

  /** Returns all composed tools (snapshot, safe for the caller to iterate). */
  values(): ComposedToolDef[] {
    return Array.from(this.tools.values());
  }

  /** Number of registered composed tools. */
  size(): number {
    return this.tools.size;
  }

  /** Serializable snapshot (deep clone of the underlying map). */
  toData(): ComposedToolStoreData {
    return {
      version: this.version,
      tools: Object.fromEntries(this.tools.entries()),
      updatedAt: this.updatedAt,
    };
  }
}

// ── Persistence ────────────────────────────────────────────────────

/**
 * Resolve the on-disk path for a state directory's composed-tool store.
 * `stateDir` is the host's persistent state root (e.g.
 * `~/.acosmi-skill-agent-mcp/state`).
 */
export function composedStorePath(stateDir: string): string {
  return path.join(stateDir, COMPOSED_TOOLS_FILENAME);
}

/**
 * Load the composed-tool store from disk. Missing file returns an
 * empty store with `error: undefined`. Parse / read errors return an
 * empty store with `error` populated so the caller can decide whether
 * to bail or proceed.
 */
export async function loadComposedToolStore(
  stateDir: string,
): Promise<LoadStoreResult> {
  const file = composedStorePath(stateDir);

  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (err) {
    if (isENoEnt(err)) {
      return { store: new ComposedToolStore() };
    }
    return { store: new ComposedToolStore(), error: toError(err) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { store: new ComposedToolStore(), error: toError(err) };
  }

  if (!isStoreData(parsed)) {
    return {
      store: new ComposedToolStore(),
      error: new Error(
        `composed: invalid store schema at ${file} (missing version / tools / updated_at)`,
      ),
    };
  }

  if (parsed.version !== COMPOSED_TOOL_STORE_VERSION) {
    return {
      store: new ComposedToolStore(),
      error: new Error(
        `composed: unknown store version ${parsed.version}, expected ${COMPOSED_TOOL_STORE_VERSION}`,
      ),
    };
  }

  return { store: new ComposedToolStore(parsed) };
}

/**
 * Persist the store to disk atomically (tmp file + rename). Updates
 * `store.updatedAt` to the current ISO 8601 timestamp.
 *
 * Uses chmod 0o600 to keep the file user-private — composed tools may
 * embed custom prompts / API key references the user does not want
 * world-readable.
 */
export async function saveComposedToolStore(
  stateDir: string,
  store: ComposedToolStore,
): Promise<void> {
  store.updatedAt = new Date().toISOString();
  const data = JSON.stringify(store.toData(), null, 2) + "\n";

  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFileAtomic(composedStorePath(stateDir), data);
}

// ── Atomic write helper (translated from composed/atomic_write.go) ──

async function writeFileAtomic(
  filePath: string,
  data: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  // node fs has no `CreateTemp` equivalent; build a unique tmp name.
  const tmp = path.join(
    dir,
    `.composed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );

  try {
    await fs.writeFile(tmp, data, { encoding: "utf-8", mode: 0o600 });
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Best-effort cleanup; ignore unlink failures.
    try {
      await fs.unlink(tmp);
    } catch {
      // tmp may already be gone if rename succeeded then threw.
    }
    throw err;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function isStoreData(v: unknown): v is ComposedToolStoreData {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj["version"] === "number" &&
    typeof obj["tools"] === "object" &&
    obj["tools"] !== null &&
    !Array.isArray(obj["tools"]) &&
    typeof obj["updatedAt"] === "string"
  );
}

function isENoEnt(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
