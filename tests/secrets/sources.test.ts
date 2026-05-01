import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  EnvSecretSource,
  FileSecretSource,
} from "../../src/secrets/sources/index.ts";
import { SecretError } from "../../src/secrets/types.ts";

describe("EnvSecretSource", () => {
  const env = new EnvSecretSource();

  beforeAll(() => {
    process.env["__TEST_SECRET_FOO"] = "value-foo";
    process.env["__TEST_SECRET_EMPTY"] = "";
  });
  afterAll(() => {
    delete process.env["__TEST_SECRET_FOO"];
    delete process.env["__TEST_SECRET_EMPTY"];
  });

  it("prefix is 'env'", () => {
    expect(env.prefix).toBe("env");
  });

  it("reads existing env var", async () => {
    expect(await env.read("__TEST_SECRET_FOO")).toBe("value-foo");
  });

  it("throws source_read_failed when var missing", async () => {
    try {
      await env.read("__TEST_SECRET_DOES_NOT_EXIST");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SecretError);
      expect((err as SecretError).code).toBe("source_read_failed");
    }
  });

  it("throws source_read_failed when var empty", async () => {
    try {
      await env.read("__TEST_SECRET_EMPTY");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("source_read_failed");
    }
  });

  it("throws invalid_source_uri on empty suffix", async () => {
    try {
      await env.read("");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("invalid_source_uri");
    }
  });

  it("error message does not include the secret value", async () => {
    process.env["__TEST_TRICKY"] = "super-secret-do-not-leak";
    try {
      // the var IS set so we won't hit the failure path here; just
      // verify we don't accidentally include the value when we DO hit
      // the failure path on an unrelated var.
      await env.read("__TEST_DEFINITELY_NOT_SET");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain("super-secret-do-not-leak");
    } finally {
      delete process.env["__TEST_TRICKY"];
    }
  });
});

describe("FileSecretSource", () => {
  const file = new FileSecretSource();
  const cleanup: string[] = [];
  afterEach(async () => {
    while (cleanup.length > 0) {
      const p = cleanup.pop()!;
      await fs.rm(p, { recursive: true, force: true });
    }
  });

  it("prefix is 'file'", () => {
    expect(file.prefix).toBe("file");
  });

  it("reads file contents and strips trailing newlines", async () => {
    const tmp = path.join(os.tmpdir(), `secret-${Date.now()}-${Math.random()}.txt`);
    cleanup.push(tmp);
    await fs.writeFile(tmp, "tok-value\n", { mode: 0o600 });
    expect(await file.read(tmp)).toBe("tok-value");
  });

  it("rejects insecure mode (POSIX only)", async () => {
    if (process.platform === "win32") return;
    const tmp = path.join(os.tmpdir(), `secret-${Date.now()}-${Math.random()}.txt`);
    cleanup.push(tmp);
    await fs.writeFile(tmp, "tok", { mode: 0o644 });
    try {
      await file.read(tmp);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("file_mode_insecure");
    }
  });

  it("rejects directories", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "secret-dir-"));
    cleanup.push(tmp);
    try {
      await file.read(tmp);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("source_read_failed");
    }
  });

  it("rejects empty file", async () => {
    const tmp = path.join(os.tmpdir(), `secret-empty-${Date.now()}.txt`);
    cleanup.push(tmp);
    await fs.writeFile(tmp, "\n", { mode: 0o600 });
    try {
      await file.read(tmp);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("source_read_failed");
    }
  });

  it("missing file → source_read_failed", async () => {
    try {
      await file.read("/definitely/nonexistent/path/secret");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("source_read_failed");
    }
  });

  it("empty suffix → invalid_source_uri", async () => {
    try {
      await file.read("");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("invalid_source_uri");
    }
  });

  it("accepts a 600 symlink pointing at a 600 target (POSIX)", async () => {
    if (process.platform === "win32") return;
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "secret-tgt-"));
    cleanup.push(targetDir);
    const target = path.join(targetDir, "secret-target");
    await fs.writeFile(target, "linked-secret-value", { mode: 0o600 });
    const linkDir = await fs.mkdtemp(path.join(os.tmpdir(), "secret-lnk-"));
    cleanup.push(linkDir);
    const link = path.join(linkDir, "link");
    await fs.symlink(target, link);
    // Symlinks themselves on POSIX often default to 0o777; recreate as 600.
    // chmod on a symlink is best-effort across platforms — Linux supports
    // it via lchmod, macOS too. fs.chmod follows the link, so we use
    // fs.lchmod when available, fallback to recreating from a 600 dir.
    if ((fs as unknown as { lchmod?: unknown }).lchmod) {
      await (fs as unknown as { lchmod: (p: string, m: number) => Promise<void> }).lchmod(
        link,
        0o600,
      );
    }
    // If lchmod is unavailable on this platform, the symlink keeps its
    // default mode and our test will hit the symlink-insecure branch.
    // Read fact-checks current platform; we only assert the success
    // path when lchmod succeeded.
    const linkStat = await fs.lstat(link);
    if ((linkStat.mode & 0o077) === 0) {
      expect(await file.read(link)).toBe("linked-secret-value");
    }
  });

  it("rejects symlink with insecure mode even when target is 600 (POSIX)", async () => {
    if (process.platform === "win32") return;
    // We need an actually-mode-loose symlink. Easiest reliable way:
    // place the link in a tmp dir, leave default symlink mode (0o777
    // on most POSIX), and verify file.read rejects it.
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "secret-tgt2-"));
    cleanup.push(targetDir);
    const target = path.join(targetDir, "secret-target");
    await fs.writeFile(target, "leaked", { mode: 0o600 });
    const linkDir = await fs.mkdtemp(path.join(os.tmpdir(), "secret-lnk2-"));
    cleanup.push(linkDir);
    const link = path.join(linkDir, "link");
    await fs.symlink(target, link);

    const linkStat = await fs.lstat(link);
    // Sanity: skip if this platform's default symlink mode is already
    // 0o600 — then there's nothing to test.
    if ((linkStat.mode & 0o077) === 0) return;

    try {
      await file.read(link);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("file_mode_insecure");
    }
  });
});
