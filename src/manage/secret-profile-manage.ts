// secret_profile_manage meta-tool — 5 actions covering registration,
// inspection, removal, and connectivity testing of secret profiles.
//
// Hard contract: this tool MUST NEVER accept a literal secret value as
// input, and MUST NEVER return a secret value (or a header containing
// it) in its output. It only manipulates the metadata that says
// "where to find" the secret.
//
// Action surface:
//   register  — adds a profile metadata entry (and persists the store)
//   list      — returns names + types + source URIs (no secret values)
//   get       — returns one profile's metadata
//   remove    — deletes a profile (and persists the store)
//   test      — calls SecretProvider.resolveProfile and reports
//               only the kind + ok flag + redacted error message
//
// Hosts that wire the optional `secretProvider` into createServer get
// this tool registered automatically (see src/mcp/server.ts).

import {
  SecretError,
  type SecretProfile,
  type SecretProfileManageInput,
  type SecretProfileManageResult,
  type SecretProvider,
} from "../secrets/types.ts";
import {
  type SecretProfileStore,
  saveSecretProfileStore,
} from "../secrets/store.ts";
import { redactSecrets, findLiteralSecret } from "../secrets/redact.ts";

// ── Public types ────────────────────────────────────────────────────

/**
 * Wiring-context for the manage tool. Hosts construct one alongside
 * the SecretProvider and pass it whenever they invoke the tool.
 */
export interface SecretProfileManageContext {
  /** The provider whose store this tool mutates. */
  provider: SecretProvider;
  /** The mutable backing store (persistence target). */
  store: SecretProfileStore;
  /** State directory used to persist the store after mutations. */
  stateDir: string;
  /**
   * When true, allows `register` to accept `source="literal:<value>"`.
   * Off by default — set deliberately for local demos/tests only.
   */
  allowLiteralSource?: boolean;
}

// ── Action descriptors ─────────────────────────────────────────────

interface SecretProfileManageAction {
  name: string;
  description: string;
  handler: (
    ctx: SecretProfileManageContext,
    input: SecretProfileManageInput,
  ) => Promise<SecretProfileManageResult>;
  mutates?: boolean;
}

const SECRET_PROFILE_ACTIONS: SecretProfileManageAction[] = [
  {
    name: "register",
    description:
      "Register or replace a profile (name, type, source). Persists store. NEVER accepts literal secret values.",
    handler: handleRegister,
    mutates: true,
  },
  {
    name: "list",
    description:
      "List registered profiles (name + type + source URI, no secret values).",
    handler: handleList,
  },
  {
    name: "get",
    description: "Return one profile's metadata.",
    handler: handleGet,
  },
  {
    name: "remove",
    description: "Delete a profile and persist the store.",
    handler: handleRemove,
    mutates: true,
  },
  {
    name: "test",
    description:
      "Call SecretProvider.resolveProfile and report kind + ok + redacted error message. NEVER returns the resolved Authorization header.",
    handler: handleTest,
  },
];

const SECRET_PROFILE_ACTIONS_BY_NAME = new Map(
  SECRET_PROFILE_ACTIONS.map((a) => [a.name, a]),
);
const SECRET_PROFILE_ACTION_NAMES = SECRET_PROFILE_ACTIONS.map((a) => a.name);

/**
 * Dispatch a secret_profile_manage tool call.
 *
 * @param inputJson - JSON-serialised SecretProfileManageInput.
 * @param ctx       - Provider + store + stateDir.
 * @returns JSON-serialised SecretProfileManageResult.
 */
export async function executeSecretProfileManage(
  inputJson: string,
  ctx: SecretProfileManageContext,
): Promise<string> {
  let input: SecretProfileManageInput;
  try {
    input = JSON.parse(inputJson) as SecretProfileManageInput;
  } catch (err) {
    return formatResult({
      action: "",
      success: false,
      error: `invalid input: ${String(err)}`,
    });
  }
  const action = SECRET_PROFILE_ACTIONS_BY_NAME.get(input.action ?? "");
  if (action === undefined) {
    return formatResult({
      action: input.action ?? "",
      success: false,
      error: `unknown action ${JSON.stringify(input.action)}; valid: ${SECRET_PROFILE_ACTION_NAMES.join(", ")}`,
    });
  }
  const result = await action.handler(ctx, input);
  return formatResult(result);
}

/** LLM tool definition (name + description + JSON Schema). */
export function secretProfileManageToolDef(): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
} {
  const descLines: string[] = [
    "Manage secret-profile metadata (register / list / get / remove / test). Profiles describe WHERE a secret lives (env var name / file path), never the secret value itself. Actions:",
  ];
  for (const a of SECRET_PROFILE_ACTIONS) {
    let line = `- ${a.name}: ${a.description}`;
    if (a.mutates === true) line += " [mutates persisted store]";
    descLines.push(line);
  }
  return {
    name: "secret_profile_manage",
    description: descLines.join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: SECRET_PROFILE_ACTION_NAMES,
          description: "The action to perform.",
        },
        name: {
          type: "string",
          description: "Profile name (required for register / get / remove / test).",
        },
        type: {
          type: "string",
          enum: ["bearer", "basic", "raw"],
          description: "Auth type (required for register).",
        },
        source: {
          type: "string",
          description:
            "Source URI \"<prefix>:<suffix>\". MUST NOT contain a literal secret value (e.g. \"env:OPENAI_API_KEY\", \"file:/run/secrets/openai\").",
        },
        username: {
          type: "string",
          description: "Username component for basic auth (ignored for bearer/raw).",
        },
      },
      required: ["action"],
    },
  };
}

function formatResult(result: SecretProfileManageResult): string {
  return JSON.stringify(result, null, 2);
}

// ── Action handlers ────────────────────────────────────────────────

async function handleRegister(
  ctx: SecretProfileManageContext,
  input: SecretProfileManageInput,
): Promise<SecretProfileManageResult> {
  const action = "register";
  if (!input.name || input.name.trim() === "") {
    return { action, success: false, error: "name is required" };
  }
  if (!isValidProfileName(input.name)) {
    return {
      action,
      success: false,
      error: `name ${JSON.stringify(input.name)} is invalid (allowed: [a-zA-Z0-9_-], 1-64 chars)`,
    };
  }
  if (input.type !== "bearer" && input.type !== "basic" && input.type !== "raw") {
    return { action, success: false, error: "type must be one of: bearer | basic | raw" };
  }
  if (!input.source || input.source.trim() === "") {
    return { action, success: false, error: "source is required" };
  }

  // Hard rule: refuse anything that looks like a literal secret in the
  // source value, regardless of whether the URI prefix is "literal:".
  const hit = findLiteralSecret(input.source);
  if (hit !== null) {
    return {
      action,
      success: false,
      error: `source contains what looks like a literal secret (${hit.label}). Use "env:VAR" or "file:/path" instead.`,
    };
  }

  // Refuse "literal:" prefix unless host explicitly opted in.
  if (input.source.startsWith("literal:") && ctx.allowLiteralSource !== true) {
    return {
      action,
      success: false,
      error:
        'source prefix "literal:" is disabled by default; restart with allowLiteralSource=true to enable for local demos.',
    };
  }

  const profile: SecretProfile = {
    name: input.name,
    type: input.type,
    source: input.source,
    createdAt: new Date().toISOString(),
  };
  if (input.type === "basic" && input.username) {
    profile.username = input.username;
  }
  ctx.store.set(profile);
  await saveSecretProfileStore(ctx.stateDir, ctx.store);

  return {
    action,
    success: true,
    data: { profile: stripSecrets(profile) },
  };
}

async function handleList(
  ctx: SecretProfileManageContext,
  _input: SecretProfileManageInput,
): Promise<SecretProfileManageResult> {
  const profiles = ctx.store.values().map(stripSecrets);
  return { action: "list", success: true, data: { profiles } };
}

async function handleGet(
  ctx: SecretProfileManageContext,
  input: SecretProfileManageInput,
): Promise<SecretProfileManageResult> {
  const action = "get";
  if (!input.name) {
    return { action, success: false, error: "name is required" };
  }
  const p = ctx.store.get(input.name);
  if (!p) {
    return { action, success: false, error: `profile ${JSON.stringify(input.name)} not found` };
  }
  return { action, success: true, data: { profile: stripSecrets(p) } };
}

async function handleRemove(
  ctx: SecretProfileManageContext,
  input: SecretProfileManageInput,
): Promise<SecretProfileManageResult> {
  const action = "remove";
  if (!input.name) {
    return { action, success: false, error: "name is required" };
  }
  const removed = ctx.store.delete(input.name);
  if (!removed) {
    return { action, success: false, error: `profile ${JSON.stringify(input.name)} not found` };
  }
  await saveSecretProfileStore(ctx.stateDir, ctx.store);
  return { action, success: true, data: { removed: input.name } };
}

async function handleTest(
  ctx: SecretProfileManageContext,
  input: SecretProfileManageInput,
): Promise<SecretProfileManageResult> {
  const action = "test";
  if (!input.name) {
    return { action, success: false, error: "name is required" };
  }
  try {
    const auth = await ctx.provider.resolveProfile(input.name);
    // Returns kind + ok=true. The headers / value are NEVER included.
    return {
      action,
      success: true,
      data: { kind: auth.kind, ok: true },
    };
  } catch (err) {
    const code = err instanceof SecretError ? err.code : "unknown";
    const msg = err instanceof Error ? err.message : String(err);
    return {
      action,
      success: false,
      error: redactSecrets(msg),
      data: { ok: false, code },
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────

const PROFILE_NAME_RE = /^[A-Za-z0-9_\-]{1,64}$/;
function isValidProfileName(name: string): boolean {
  return PROFILE_NAME_RE.test(name);
}

/**
 * Defensive copy of a profile suitable for return-to-client. The
 * profile shape never contains a secret value to begin with — this
 * function exists for symmetry with future fields and to make the
 * intent explicit at every callsite.
 */
function stripSecrets(p: SecretProfile): SecretProfile {
  return {
    name: p.name,
    type: p.type,
    source: p.source,
    ...(p.username !== undefined && { username: p.username }),
    createdAt: p.createdAt,
  };
}
