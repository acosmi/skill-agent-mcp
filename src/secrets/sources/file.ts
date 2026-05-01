// FileSecretSource — reads raw secrets from a user-private file.
//
// Designed for the standard "K8s tmpfs secret mount" / "Docker secret"
// / "Vault Agent sidecar" deployment pattern, where the secret is
// rendered into a path like /run/secrets/openai with restricted
// permissions.
//
// Mode-bit security check:
//   - On POSIX hosts: BOTH lstat (the link / direct entry) AND stat
//     (the target after symlink resolution) must have group/other
//     permission bits clear (`mode & 0o077 === 0`). This blocks the
//     attack surface where a user-writable directory contains a
//     symlink whose own permissions are loose but points at a 600
//     target — without lstat, the loose link itself would pass.
//     Matches sshd's "StrictModes" behaviour on ~/.ssh files.
//   - On Windows: NTFS ACLs are projected into stat.mode in a way that
//     usually leaves all bits 0. The check is best-effort — we skip it
//     entirely on win32 and document the limitation.
//
// Trailing newlines are stripped (the typical case where a user does
// `echo "sk-..." > file` and bash appends \n).

import * as fs from "node:fs/promises";

import {
  SecretError,
  type SecretSourceAdapter,
} from "../types.ts";

export class FileSecretSource implements SecretSourceAdapter {
  readonly prefix = "file";

  async read(suffix: string): Promise<string> {
    if (suffix === "") {
      throw new SecretError(
        "invalid_source_uri",
        "file source requires a path suffix (got empty)",
      );
    }

    // lstat first so symlinks themselves are mode-checked. Then stat
    // (follows symlinks) so the target is also mode-checked. Both
    // must pass on POSIX. We deliberately allow symlinks — K8s secret
    // mounts use them — but require the link entry itself to be
    // group/other-locked just like the target.
    let lstat;
    try {
      lstat = await fs.lstat(suffix);
    } catch (err) {
      throw new SecretError(
        "source_read_failed",
        `file ${JSON.stringify(suffix)} lstat failed: ${errMsg(err)}`,
      );
    }

    let stat;
    try {
      stat = await fs.stat(suffix);
    } catch (err) {
      throw new SecretError(
        "source_read_failed",
        `file ${JSON.stringify(suffix)} stat failed: ${errMsg(err)}`,
      );
    }

    if (!stat.isFile()) {
      throw new SecretError(
        "source_read_failed",
        `file ${JSON.stringify(suffix)} is not a regular file`,
      );
    }

    if (process.platform !== "win32") {
      const linkInsecure = lstat.mode & 0o077;
      if (linkInsecure !== 0 && lstat.isSymbolicLink()) {
        const got = (lstat.mode & 0o777).toString(8).padStart(3, "0");
        throw new SecretError(
          "file_mode_insecure",
          `symlink ${JSON.stringify(suffix)} has insecure mode 0${got} (group/other readable); chmod 600 the link`,
        );
      }
      const insecureBits = stat.mode & 0o077;
      if (insecureBits !== 0) {
        const got = (stat.mode & 0o777).toString(8).padStart(3, "0");
        throw new SecretError(
          "file_mode_insecure",
          `file ${JSON.stringify(suffix)} has insecure mode 0${got} (group/other readable); chmod 600 the file`,
        );
      }
    }

    let raw: string;
    try {
      raw = await fs.readFile(suffix, "utf-8");
    } catch (err) {
      throw new SecretError(
        "source_read_failed",
        `file ${JSON.stringify(suffix)} read failed: ${errMsg(err)}`,
      );
    }

    // Strip trailing newlines (one or more) — common bash heredoc artefact.
    const trimmed = raw.replace(/[\r\n]+$/, "");
    if (trimmed === "") {
      throw new SecretError(
        "source_read_failed",
        `file ${JSON.stringify(suffix)} is empty after newline strip`,
      );
    }
    return trimmed;
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
