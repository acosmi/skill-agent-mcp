import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  DefaultSecretProvider,
  defaultSourceAdapters,
  SecretProfileStore,
} from "../../src/secrets/index.ts";
import { SecretError } from "../../src/secrets/types.ts";

function freshProvider(): DefaultSecretProvider {
  const store = new SecretProfileStore();
  const provider = new DefaultSecretProvider(store);
  for (const a of defaultSourceAdapters()) provider.registerSourceAdapter(a);
  return provider;
}

describe("DefaultSecretProvider", () => {
  beforeAll(() => {
    process.env["__P_BEARER"] = "bearer-token-12345";
    process.env["__P_BASIC_PASS"] = "secret-pass";
    process.env["__P_RAW"] = "raw-value-here";
  });
  afterAll(() => {
    delete process.env["__P_BEARER"];
    delete process.env["__P_BASIC_PASS"];
    delete process.env["__P_RAW"];
  });

  it("hasProfile / listProfileNames reflect store state", () => {
    const store = new SecretProfileStore();
    const provider = new DefaultSecretProvider(store);
    expect(provider.hasProfile("openai")).toBe(false);
    expect(provider.listProfileNames()).toEqual([]);

    store.set({
      name: "openai",
      type: "bearer",
      source: "env:__P_BEARER",
      createdAt: "ts",
    });
    expect(provider.hasProfile("openai")).toBe(true);
    expect(provider.listProfileNames()).toEqual(["openai"]);
  });

  it("registerSourceAdapter / registeredPrefixes", () => {
    const provider = freshProvider();
    expect(provider.registeredPrefixes()).toEqual(["env", "file"]);
    expect(provider.unregisterSourceAdapter("file")).toBe(true);
    expect(provider.registeredPrefixes()).toEqual(["env"]);
  });

  it("resolveProfile bearer wraps into Authorization header", async () => {
    const store = new SecretProfileStore();
    store.set({
      name: "p1",
      type: "bearer",
      source: "env:__P_BEARER",
      createdAt: "ts",
    });
    const provider = new DefaultSecretProvider(store);
    for (const a of defaultSourceAdapters()) provider.registerSourceAdapter(a);

    const auth = await provider.resolveProfile("p1");
    expect(auth.kind).toBe("bearer");
    if (auth.kind === "bearer") {
      expect(auth.headers.Authorization).toBe("Bearer bearer-token-12345");
    }
  });

  it("resolveProfile basic combines username + secret into base64", async () => {
    const store = new SecretProfileStore();
    store.set({
      name: "p2",
      type: "basic",
      source: "env:__P_BASIC_PASS",
      username: "alice",
      createdAt: "ts",
    });
    const provider = new DefaultSecretProvider(store);
    for (const a of defaultSourceAdapters()) provider.registerSourceAdapter(a);

    const auth = await provider.resolveProfile("p2");
    expect(auth.kind).toBe("basic");
    if (auth.kind === "basic") {
      const expected = Buffer.from("alice:secret-pass", "utf-8").toString("base64");
      expect(auth.headers.Authorization).toBe(`Basic ${expected}`);
    }
  });

  it("resolveProfile raw returns value", async () => {
    const store = new SecretProfileStore();
    store.set({
      name: "p3",
      type: "raw",
      source: "env:__P_RAW",
      createdAt: "ts",
    });
    const provider = new DefaultSecretProvider(store);
    for (const a of defaultSourceAdapters()) provider.registerSourceAdapter(a);

    const auth = await provider.resolveProfile("p3");
    expect(auth.kind).toBe("raw");
    if (auth.kind === "raw") {
      expect(auth.value).toBe("raw-value-here");
    }
  });

  it("resolveProfile unknown name → profile_not_found", async () => {
    const provider = freshProvider();
    try {
      await provider.resolveProfile("missing");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("profile_not_found");
    }
  });

  it("resolveProfile with unregistered prefix → source_unsupported", async () => {
    const store = new SecretProfileStore();
    store.set({
      name: "p4",
      type: "bearer",
      source: "vault:secret/x",
      createdAt: "ts",
    });
    const provider = new DefaultSecretProvider(store); // no adapters
    try {
      await provider.resolveProfile("p4");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("source_unsupported");
    }
  });

  it("malformed source URI → invalid_source_uri", async () => {
    const store = new SecretProfileStore();
    store.set({
      name: "p5",
      type: "bearer",
      source: "no-colon-here",
      createdAt: "ts",
    });
    const provider = new DefaultSecretProvider(store);
    for (const a of defaultSourceAdapters()) provider.registerSourceAdapter(a);
    try {
      await provider.resolveProfile("p5");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as SecretError).code).toBe("invalid_source_uri");
    }
  });

  it("invalid_source_uri error message does NOT echo the URI value", async () => {
    // If a user mis-registers a profile with a literal secret as the
    // source, the error message must not log that literal.
    const store = new SecretProfileStore();
    const sneakySource = "sk-pretend-leaked-token-1234567890ab";
    store.set({
      name: "p6",
      type: "bearer",
      source: sneakySource,
      createdAt: "ts",
    });
    const provider = new DefaultSecretProvider(store);
    for (const a of defaultSourceAdapters()) provider.registerSourceAdapter(a);
    try {
      await provider.resolveProfile("p6");
      throw new Error("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain(sneakySource);
      expect(msg).toMatch(/length=\d+/);
    }
  });
});
