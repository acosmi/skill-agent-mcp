// Secret-profile store — in-memory map + atomic-write JSON persistence.
//
// Mirrors the design of src/codegen/store.ts (ComposedToolStore):
//   - 0o600 file mode + 0o700 dir mode (user-private)
//   - tmp file + rename atomic write
//   - explicit stateDir injection (no global state)
//   - load returns { store, error? } so callers can decide whether to
//     bail or proceed on parse / read failure
//
// What this file deliberately does NOT do:
//   - Read or write the actual secret values. Profiles only describe
//     where to find a secret (env var name / file path / keychain ref).
//   - Validate source URIs at load time. URI parsing is done by the
//     SecretProvider when resolving — letting hosts register additional
//     SecretSourceAdapters before any resolve happens.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  type SecretProfile,
  type SecretProfileStoreData,
  SECRET_PROFILE_STORE_VERSION,
  SECRET_PROFILES_FILENAME,
} from "./types.ts";

/** Outcome from `loadSecretProfileStore`. `error` is set on parse / read failure. */
export interface LoadSecretStoreResult {
  store: SecretProfileStore;
  error?: Error;
}

/**
 * In-memory secret-profile store. Construct one per persistence path.
 *
 * The store is read-mostly; populate either via `loadSecretProfileStore`
 * (from disk) or programmatically via `set(profile)`. Use
 * `saveSecretProfileStore(store)` to flush back.
 */
export class SecretProfileStore {
  version: number;
  updatedAt: string;
  private readonly profiles: Map<string, SecretProfile>;

  constructor(init?: Partial<SecretProfileStoreData>) {
    this.version = init?.version ?? SECRET_PROFILE_STORE_VERSION;
    this.updatedAt = init?.updatedAt ?? "";
    this.profiles = new Map();
    if (init?.profiles) {
      for (const [name, p] of Object.entries(init.profiles)) {
        this.profiles.set(name, p);
      }
    }
  }

  /** Returns the profile with this name, or undefined. */
  get(name: string): SecretProfile | undefined {
    return this.profiles.get(name);
  }

  /** Registers (or replaces) a profile. */
  set(profile: SecretProfile): void {
    this.profiles.set(profile.name, profile);
  }

  /** Deletes a profile. Returns whether it existed. */
  delete(name: string): boolean {
    return this.profiles.delete(name);
  }

  /** All registered profile names (sorted). */
  names(): string[] {
    return Array.from(this.profiles.keys()).sort();
  }

  /** Snapshot of all profiles (safe for the caller to iterate). */
  values(): SecretProfile[] {
    return Array.from(this.profiles.values());
  }

  /** Number of registered profiles. */
  size(): number {
    return this.profiles.size;
  }

  /** Existence check (no I/O). */
  has(name: string): boolean {
    return this.profiles.has(name);
  }

  /** Serializable snapshot (deep clone of the underlying map). */
  toData(): SecretProfileStoreData {
    return {
      version: this.version,
      profiles: Object.fromEntries(this.profiles.entries()),
      updatedAt: this.updatedAt,
    };
  }
}

// ── Persistence ────────────────────────────────────────────────────

/**
 * Resolve the on-disk path for a state directory's secret-profile store.
 * Mirrors composedStorePath() so hosts can co-locate both files.
 */
export function secretProfilesPath(stateDir: string): string {
  return path.join(stateDir, SECRET_PROFILES_FILENAME);
}

/**
 * Load the secret-profile store from disk. Missing file returns an
 * empty store with `error: undefined`. Parse / read errors return an
 * empty store with `error` populated so the caller can decide whether
 * to bail or proceed.
 */
export async function loadSecretProfileStore(
  stateDir: string,
): Promise<LoadSecretStoreResult> {
  const file = secretProfilesPath(stateDir);

  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (err) {
    if (isENoEnt(err)) {
      return { store: new SecretProfileStore() };
    }
    return { store: new SecretProfileStore(), error: toError(err) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { store: new SecretProfileStore(), error: toError(err) };
  }

  if (!isStoreData(parsed)) {
    return {
      store: new SecretProfileStore(),
      error: new Error(
        `secrets: invalid store schema at ${file} (missing version / profiles / updated_at)`,
      ),
    };
  }

  if (parsed.version !== SECRET_PROFILE_STORE_VERSION) {
    return {
      store: new SecretProfileStore(),
      error: new Error(
        `secrets: unknown store version ${parsed.version}, expected ${SECRET_PROFILE_STORE_VERSION}`,
      ),
    };
  }

  return { store: new SecretProfileStore(parsed) };
}

/**
 * Persist the store atomically (tmp file + rename). Updates
 * `store.updatedAt` to the current ISO 8601 timestamp.
 *
 * Uses chmod 0o600 to keep the file user-private — even though
 * profile metadata does not contain secret values, it does describe
 * which env vars / file paths the user has wired up, which is itself
 * sensitive in a multi-user system.
 */
export async function saveSecretProfileStore(
  stateDir: string,
  store: SecretProfileStore,
): Promise<void> {
  store.updatedAt = new Date().toISOString();
  const data = JSON.stringify(store.toData(), null, 2) + "\n";

  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFileAtomic(secretProfilesPath(stateDir), data);
}

// ── Atomic write helper (mirrors src/codegen/store.ts:writeFileAtomic) ──

async function writeFileAtomic(
  filePath: string,
  data: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.secrets-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );

  try {
    await fs.writeFile(tmp, data, { encoding: "utf-8", mode: 0o600 });
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

// ── Helpers ────────────────────────────────────────────────────────

function isStoreData(v: unknown): v is SecretProfileStoreData {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj["version"] === "number" &&
    typeof obj["profiles"] === "object" &&
    obj["profiles"] !== null &&
    !Array.isArray(obj["profiles"]) &&
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
