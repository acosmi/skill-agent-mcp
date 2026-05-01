// Public surface for the secrets subsystem.
//
// Hosts typically wire up:
//
//   import {
//     loadSecretProfileStore,
//     DefaultSecretProvider,
//     defaultSourceAdapters,
//   } from "@acosmi/skill-agent-mcp/secrets";
//
//   const { store } = await loadSecretProfileStore(stateDir);
//   const provider = new DefaultSecretProvider(store);
//   for (const a of defaultSourceAdapters()) provider.registerSourceAdapter(a);
//   const server = createServer({ ..., secretProvider: provider });
//
// Sibling packages adding more SecretSourceAdapters (keychain / vault)
// register them on `provider` after the defaults.

export type {
  ResolvedAuth,
  SecretErrorCode,
  SecretProfile,
  SecretProfileManageInput,
  SecretProfileManageResult,
  SecretProfileStoreData,
  SecretProvider,
  SecretSourceAdapter,
} from "./types.ts";

export {
  SECRET_PROFILE_STORE_VERSION,
  SECRET_PROFILES_FILENAME,
  SecretError,
} from "./types.ts";

export {
  type LoadSecretStoreResult,
  loadSecretProfileStore,
  saveSecretProfileStore,
  SecretProfileStore,
  secretProfilesPath,
} from "./store.ts";

export { DefaultSecretProvider } from "./provider.ts";

export {
  containsLikelySecret,
  findLiteralSecret,
  redactSecrets,
} from "./redact.ts";

export {
  defaultSourceAdapters,
  EnvSecretSource,
  FileSecretSource,
} from "./sources/index.ts";
