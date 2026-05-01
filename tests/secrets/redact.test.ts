import { describe, expect, it } from "bun:test";

import {
  containsLikelySecret,
  findLiteralSecret,
  redactSecrets,
} from "../../src/secrets/redact.ts";

describe("redactSecrets", () => {
  it("redacts Authorization Bearer header", () => {
    const out = redactSecrets("Authorization: Bearer sk-very-long-pretend-token-123456");
    expect(out).toBe("Authorization: Bearer ***");
  });

  it("redacts Authorization Basic header", () => {
    const out = redactSecrets("Authorization: Basic dXNlcjpwYXNzd29yZF92ZXJ5X2xvbmc=");
    expect(out).toBe("Authorization: Basic ***");
  });

  it("redacts OpenAI sk- token in free text", () => {
    const out = redactSecrets("error: token sk-abcdefghijklmnopqrstuv invalid");
    expect(out).toBe("error: token *** invalid");
  });

  it("redacts GitHub PAT", () => {
    const out = redactSecrets("token=ghp_abcdefghijklmnopqrst");
    expect(out).toBe("token=***");
  });

  it("redacts AWS access key id", () => {
    const out = redactSecrets("aws_key=AKIAIOSFODNN7EXAMPLE");
    expect(out).toBe("aws_key=***");
  });

  it("redacts bare Bearer token (no Authorization: prefix)", () => {
    const out = redactSecrets("got Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 here");
    expect(out).toBe("got Bearer *** here");
  });

  it("leaves non-secret text untouched", () => {
    expect(redactSecrets("hello world")).toBe("hello world");
    expect(redactSecrets("price: $1234.56")).toBe("price: $1234.56");
  });

  it("handles empty string", () => {
    expect(redactSecrets("")).toBe("");
  });
});

describe("containsLikelySecret / findLiteralSecret", () => {
  it("detects sk- token", () => {
    expect(containsLikelySecret("hello sk-abcdefghijklmnopqrstuv world")).toBe(true);
    const hit = findLiteralSecret("hello sk-abcdefghijklmnopqrstuv world");
    expect(hit?.label).toContain("sk-");
  });

  it("does not flag short sk- prefix (under 20 chars)", () => {
    expect(containsLikelySecret("sk-short")).toBe(false);
    expect(findLiteralSecret("sk-short")).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(findLiteralSecret("the quick brown fox")).toBeNull();
  });

  it("findLiteralSecret never returns the matched value", () => {
    const hit = findLiteralSecret("sk-abcdefghijklmnopqrstuvwxyz");
    expect(hit).not.toBeNull();
    // The returned object shape is just { label }; no value field.
    expect(Object.keys(hit!)).toEqual(["label"]);
  });

  it("isolates state between calls (regex /g lastIndex reset)", () => {
    const text = "sk-abcdefghijklmnopqrstuv";
    expect(containsLikelySecret(text)).toBe(true);
    expect(containsLikelySecret(text)).toBe(true); // would fail if lastIndex leaked
  });
});
