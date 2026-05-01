// EnvSecretSource — reads raw secrets from process.env.
//
// The simplest source. Suitable for dev / CI. Production hosts that
// load secrets via Vault / Doppler / ESO typically materialise them
// into env vars first, so this source covers most prod scenarios too.
//
// Behaviour:
//   - "env:OPENAI_API_KEY" → process.env.OPENAI_API_KEY
//   - missing / empty env var → throws SecretError("source_read_failed")
//   - the env var name itself appears in the error message; the value
//     never does.

import {
  SecretError,
  type SecretSourceAdapter,
} from "../types.ts";

export class EnvSecretSource implements SecretSourceAdapter {
  readonly prefix = "env";

  async read(suffix: string): Promise<string> {
    if (suffix === "") {
      throw new SecretError(
        "invalid_source_uri",
        "env source requires a variable name suffix (got empty)",
      );
    }
    const v = process.env[suffix];
    if (v === undefined) {
      throw new SecretError(
        "source_read_failed",
        `env variable ${JSON.stringify(suffix)} is not set`,
      );
    }
    if (v === "") {
      throw new SecretError(
        "source_read_failed",
        `env variable ${JSON.stringify(suffix)} is empty`,
      );
    }
    return v;
  }
}
