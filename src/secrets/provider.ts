// DefaultSecretProvider — glues SecretProfileStore + SecretSourceAdapters.
//
// Lifecycle (host wiring):
//
//   const { store } = await loadSecretProfileStore(stateDir);
//   const provider = new DefaultSecretProvider(store);
//   for (const a of defaultSourceAdapters()) provider.registerSourceAdapter(a);
//   // Optionally: provider.registerSourceAdapter(new KeychainSecretSource());
//   createServer({ ..., secretProvider: provider });
//
// resolveProfile() never caches the resolved auth — every call re-reads
// the source. This is deliberate: rotating an env var (or replacing the
// file at /run/secrets/...) takes effect immediately without a server
// restart, and we never accumulate a cache the process could leak.

import {
  type ResolvedAuth,
  SecretError,
  type SecretProvider,
  type SecretSourceAdapter,
} from "./types.ts";
import type { SecretProfileStore } from "./store.ts";

export class DefaultSecretProvider implements SecretProvider {
  private readonly adapters = new Map<string, SecretSourceAdapter>();

  constructor(private readonly store: SecretProfileStore) {}

  /**
   * Register a source adapter. Subsequent profile.source URIs whose
   * prefix matches `adapter.prefix` will route to it. Re-registering
   * the same prefix replaces the previous adapter.
   */
  registerSourceAdapter(adapter: SecretSourceAdapter): void {
    this.adapters.set(adapter.prefix, adapter);
  }

  /** Inverse of register; mainly used by tests. */
  unregisterSourceAdapter(prefix: string): boolean {
    return this.adapters.delete(prefix);
  }

  /** Prefixes registered. */
  registeredPrefixes(): string[] {
    return Array.from(this.adapters.keys()).sort();
  }

  // ── SecretProvider impl ────────────────────────────────────────

  hasProfile(name: string): boolean {
    return this.store.has(name);
  }

  listProfileNames(): string[] {
    return this.store.names();
  }

  async resolveProfile(name: string): Promise<ResolvedAuth> {
    const profile = this.store.get(name);
    if (!profile) {
      throw new SecretError(
        "profile_not_found",
        `secret profile ${JSON.stringify(name)} is not registered`,
      );
    }

    const { prefix, suffix } = parseSourceUri(profile.source);
    const adapter = this.adapters.get(prefix);
    if (!adapter) {
      throw new SecretError(
        "source_unsupported",
        `profile ${JSON.stringify(name)} uses source prefix ${JSON.stringify(prefix)} but no adapter is registered`,
      );
    }

    const raw = await adapter.read(suffix);

    return shapeAuth(profile.type, raw, profile.username);
  }
}

// ── Helpers ────────────────────────────────────────────────────────

interface ParsedSourceUri {
  prefix: string;
  suffix: string;
}

/**
 * Parse "prefix:suffix" form. The prefix MUST NOT contain a colon; the
 * suffix MAY (e.g. windows file paths "file:C:\foo\bar"). We split on
 * the FIRST colon only.
 *
 * NOTE: error message MUST NOT dump the full URI — a malformed source
 * may be a misregistration where the user pasted a literal secret as
 * the source value, and that string would otherwise echo into logs.
 * Only the URI length is mentioned for diagnosis.
 */
function parseSourceUri(uri: string): ParsedSourceUri {
  const idx = uri.indexOf(":");
  if (idx <= 0) {
    throw new SecretError(
      "invalid_source_uri",
      `source URI is not in "prefix:suffix" form (length=${uri.length})`,
    );
  }
  return {
    prefix: uri.slice(0, idx),
    suffix: uri.slice(idx + 1),
  };
}

/**
 * Wrap raw secret string into the appropriate ResolvedAuth shape based
 * on the profile's declared type.
 */
function shapeAuth(
  type: "bearer" | "basic" | "raw",
  raw: string,
  username: string | undefined,
): ResolvedAuth {
  switch (type) {
    case "bearer":
      return {
        kind: "bearer",
        headers: { Authorization: `Bearer ${raw}` },
      };
    case "basic": {
      const user = username ?? "";
      const encoded = Buffer.from(`${user}:${raw}`, "utf-8").toString(
        "base64",
      );
      return {
        kind: "basic",
        headers: { Authorization: `Basic ${encoded}` },
      };
    }
    case "raw":
      return { kind: "raw", value: raw };
    default: {
      // Exhaustiveness — unreachable under TS's narrowing, but defensive
      // in case a malformed store entry slips through.
      const _exhaust: never = type;
      throw new SecretError(
        "invalid_profile_type",
        `unsupported profile type: ${String(_exhaust)}`,
      );
    }
  }
}
