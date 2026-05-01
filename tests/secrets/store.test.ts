import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  loadSecretProfileStore,
  saveSecretProfileStore,
  SecretProfileStore,
  secretProfilesPath,
} from "../../src/secrets/store.ts";
import { SECRET_PROFILES_FILENAME } from "../../src/secrets/types.ts";

async function tmpStateDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "skill-agent-secrets-"));
}

describe("SecretProfileStore (in-memory)", () => {
  it("set / get / has / delete / size", () => {
    const store = new SecretProfileStore();
    expect(store.size()).toBe(0);
    expect(store.has("openai")).toBe(false);

    store.set({
      name: "openai",
      type: "bearer",
      source: "env:OPENAI_API_KEY",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    expect(store.size()).toBe(1);
    expect(store.has("openai")).toBe(true);
    expect(store.get("openai")?.source).toBe("env:OPENAI_API_KEY");

    expect(store.delete("openai")).toBe(true);
    expect(store.delete("openai")).toBe(false);
    expect(store.size()).toBe(0);
  });

  it("names() returns sorted keys", () => {
    const store = new SecretProfileStore();
    store.set({
      name: "gamma",
      type: "bearer",
      source: "env:G",
      createdAt: "x",
    });
    store.set({
      name: "alpha",
      type: "bearer",
      source: "env:A",
      createdAt: "x",
    });
    expect(store.names()).toEqual(["alpha", "gamma"]);
  });

  it("toData snapshot round-trips through constructor", () => {
    const a = new SecretProfileStore();
    a.set({
      name: "x",
      type: "basic",
      source: "env:X",
      username: "u",
      createdAt: "ts",
    });
    a.updatedAt = "now";
    const data = a.toData();
    const b = new SecretProfileStore(data);
    expect(b.get("x")?.username).toBe("u");
    expect(b.updatedAt).toBe("now");
  });
});

describe("loadSecretProfileStore / saveSecretProfileStore", () => {
  const dirsToCleanup: string[] = [];
  afterEach(async () => {
    while (dirsToCleanup.length > 0) {
      const d = dirsToCleanup.pop()!;
      await fs.rm(d, { recursive: true, force: true });
    }
  });

  it("missing file → empty store, no error", async () => {
    const dir = await tmpStateDir();
    dirsToCleanup.push(dir);
    const { store, error } = await loadSecretProfileStore(dir);
    expect(error).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it("save round-trips through load", async () => {
    const dir = await tmpStateDir();
    dirsToCleanup.push(dir);
    const a = new SecretProfileStore();
    a.set({
      name: "openai",
      type: "bearer",
      source: "env:OPENAI_API_KEY",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    await saveSecretProfileStore(dir, a);

    const { store, error } = await loadSecretProfileStore(dir);
    expect(error).toBeUndefined();
    expect(store.get("openai")?.source).toBe("env:OPENAI_API_KEY");
    expect(store.updatedAt).not.toBe(""); // save stamped it
  });

  it("save creates the file with mode 0o600 (POSIX only)", async () => {
    if (process.platform === "win32") return;
    const dir = await tmpStateDir();
    dirsToCleanup.push(dir);
    const store = new SecretProfileStore();
    store.set({ name: "x", type: "raw", source: "env:X", createdAt: "ts" });
    await saveSecretProfileStore(dir, store);
    const stat = await fs.stat(secretProfilesPath(dir));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("rejects unknown version with error", async () => {
    const dir = await tmpStateDir();
    dirsToCleanup.push(dir);
    const file = path.join(dir, SECRET_PROFILES_FILENAME);
    await fs.writeFile(
      file,
      JSON.stringify({ version: 999, profiles: {}, updatedAt: "x" }),
    );
    const { store, error } = await loadSecretProfileStore(dir);
    expect(error).toBeDefined();
    expect(error?.message).toContain("unknown store version");
    expect(store.size()).toBe(0);
  });

  it("rejects malformed JSON with error", async () => {
    const dir = await tmpStateDir();
    dirsToCleanup.push(dir);
    const file = path.join(dir, SECRET_PROFILES_FILENAME);
    await fs.writeFile(file, "not json");
    const { error } = await loadSecretProfileStore(dir);
    expect(error).toBeDefined();
  });

  it("rejects bad schema (missing fields)", async () => {
    const dir = await tmpStateDir();
    dirsToCleanup.push(dir);
    const file = path.join(dir, SECRET_PROFILES_FILENAME);
    await fs.writeFile(file, JSON.stringify({ profiles: {} }));
    const { error } = await loadSecretProfileStore(dir);
    expect(error).toBeDefined();
    expect(error?.message).toContain("invalid store schema");
  });
});
