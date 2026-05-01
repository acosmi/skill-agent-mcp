// Default source-adapter set bundled with this package.
//
// Hosts wiring up DefaultSecretProvider can call:
//
//   for (const a of defaultSourceAdapters()) provider.registerSourceAdapter(a);
//
// Sibling packages adding additional adapters (keychain / vault / ...)
// register their own after the defaults.

import { EnvSecretSource } from "./env.ts";
import { FileSecretSource } from "./file.ts";
import type { SecretSourceAdapter } from "../types.ts";

/** Returns a fresh array of the default adapters (env + file). */
export function defaultSourceAdapters(): SecretSourceAdapter[] {
  return [new EnvSecretSource(), new FileSecretSource()];
}

export { EnvSecretSource, FileSecretSource };
