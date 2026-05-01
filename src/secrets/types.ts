// Secret-profile subsystem types.
//
// Design rationale: SKILL.md never contains raw secrets, only profile
// names ("openai_default"). The profile metadata file maps name →
// source URI ("env:OPENAI_API_KEY" / "file:/run/secrets/openai") — but
// still doesn't store the secret itself; that lives in process.env or a
// user-private file. The SecretProvider resolves a profile name into a
// ResolvedAuth (already-shaped Authorization headers) at runtime.
//
// The split (Provider / Source / Profile) lets sibling packages
// (@acosmi/skill-secrets-keychain, @acosmi/skill-secrets-vault) plug
// in without the core package needing native deps.
//
// See docs/jiagou/架构-acosmi-skill-agent-mcp-secrets-v1.md for the
// full design + decision log.

// ── Profile metadata ────────────────────────────────────────────────

/** Static metadata describing how to resolve a single named profile. */
export interface SecretProfile {
  /** Profile name — appears as a string handle in SKILL frontmatter. */
  name: string;
  /** Authentication kind. "raw" returned-as-is; not recommended. */
  type: "bearer" | "basic" | "raw";
  /**
   * Source URI identifying where the actual secret lives. Format is
   * "<prefix>:<suffix>" — the prefix routes to a registered
   * SecretSourceAdapter; the suffix is opaque to the framework.
   *
   * Examples:
   *   "env:OPENAI_API_KEY"
   *   "file:/run/secrets/openai"
   *   "keychain:openai-prod"   (when @acosmi/skill-secrets-keychain registered)
   */
  source: string;
  /**
   * Username component for basic auth — combined with the source-resolved
   * password into "user:pass". Ignored for bearer / raw.
   */
  username?: string;
  /** ISO 8601 timestamp at registration. */
  createdAt: string;
}

/** Persisted store layout (JSON-serializable). */
export interface SecretProfileStoreData {
  version: number;
  profiles: Record<string, SecretProfile>;
  updatedAt: string;
}

/** Current persisted-store schema version. */
export const SECRET_PROFILE_STORE_VERSION = 1;

/** Persisted-store filename appended to the supplied state dir. */
export const SECRET_PROFILES_FILENAME = "secret_profiles.json";

// ── Source adapter contract ─────────────────────────────────────────

/**
 * Reads raw secret strings from a single backing store (env / file /
 * keychain / vault / ...). Adapters are registered with a unique prefix
 * on the SecretProvider; the prefix routes profile.source URIs.
 *
 * Implementations MUST NOT echo the secret value into thrown error
 * messages — only describe the source location ("env var FOO not set",
 * "file /tmp/x missing", etc.).
 */
export interface SecretSourceAdapter {
  /** URI prefix this adapter handles, e.g. "env" / "file". */
  readonly prefix: string;
  /**
   * Read the raw secret string from the suffix portion of the URI
   * ("env:FOO" → suffix is "FOO"). Throws SecretError on failure.
   */
  read(suffix: string): Promise<string>;
}

// ── Resolved auth (returned by SecretProvider.resolveProfile) ──────

/**
 * Resolved authentication object — already shaped into headers ready
 * to spread into a fetch() call. Tools should prefer using the
 * `headers` map directly; the raw value is exposed only for "raw" kind
 * profiles where the calling tool needs the unwrapped value.
 */
export type ResolvedAuth =
  | {
      kind: "bearer";
      /** { Authorization: "Bearer <token>" } */
      headers: { Authorization: string };
    }
  | {
      kind: "basic";
      /** { Authorization: "Basic <base64(user:pass)>" } */
      headers: { Authorization: string };
    }
  | {
      kind: "raw";
      /** Raw value as returned by the source. Caller decides how to use. */
      value: string;
    };

// ── Public provider contract ────────────────────────────────────────

/**
 * The single entrypoint hosts inject into tool implementations
 * (http_request, sql_query, ...) and into validateSkillMode for static
 * profile-existence checks.
 *
 * Implementations:
 *   - DefaultSecretProvider — store + adapter map (this package).
 *   - User-supplied — any object satisfying the contract.
 */
export interface SecretProvider {
  /**
   * Resolve a profile name to a ready-to-use ResolvedAuth. Throws a
   * SecretError on missing profile / unsupported source prefix / source
   * read failure.
   */
  resolveProfile(name: string): Promise<ResolvedAuth>;

  /**
   * Profile names registered in the store. MUST NOT return source URIs
   * or any field that could leak the secret location to remote
   * (potentially untrusted) MCP clients beyond what's already in the
   * SKILL frontmatter.
   */
  listProfileNames(): string[];

  /**
   * Cheap existence check used by validateSkillMode. No I/O — backed
   * by the in-memory store map.
   */
  hasProfile(name: string): boolean;
}

// ── Errors ──────────────────────────────────────────────────────────

/** Reason codes surfaced from secrets operations. */
export type SecretErrorCode =
  | "profile_not_found"
  | "source_unsupported"
  | "source_read_failed"
  | "file_mode_insecure"
  | "literal_secret_rejected"
  | "invalid_source_uri"
  | "invalid_profile_type";

/**
 * Structured error thrown by SecretProvider / SecretSourceAdapter.
 * Catchers can branch on `.code` instead of parsing message strings.
 */
export class SecretError extends Error {
  readonly code: SecretErrorCode;
  constructor(code: SecretErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SecretError";
  }
}

// ── Manage-tool action types ────────────────────────────────────────

/** Input shape for executeSecretProfileManage. */
export interface SecretProfileManageInput {
  action?: string;
  /** name field for register / remove / test / get. */
  name?: string;
  /** type field for register. */
  type?: "bearer" | "basic" | "raw";
  /** source URI for register. */
  source?: string;
  /** username for register (basic only). */
  username?: string;
  /** Test-action only: when true, attempts an actual upstream probe. */
  probe?: boolean;
}

/** Output shape for executeSecretProfileManage. */
export interface SecretProfileManageResult {
  action: string;
  success: boolean;
  error?: string;
  data?: unknown;
}
