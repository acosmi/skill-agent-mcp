import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  executeSecretProfileManage,
  type SecretProfileManageContext,
  secretProfileManageToolDef,
} from "../../src/manage/secret-profile-manage.ts";
import {
  DefaultSecretProvider,
  defaultSourceAdapters,
  SecretProfileStore,
} from "../../src/secrets/index.ts";

interface TestFixture {
  ctx: SecretProfileManageContext;
  stateDir: string;
}

async function makeFixture(opts?: { allowLiteral?: boolean }): Promise<TestFixture> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "secret-mgmt-"));
  const store = new SecretProfileStore();
  const provider = new DefaultSecretProvider(store);
  for (const a of defaultSourceAdapters()) provider.registerSourceAdapter(a);
  return {
    stateDir,
    ctx: {
      provider,
      store,
      stateDir,
      ...(opts?.allowLiteral === true && { allowLiteralSource: true }),
    },
  };
}

beforeAll(() => {
  process.env["__SM_OPENAI"] = "fake-openai-key-1234567890ab";
  process.env["__SM_GITHUB"] = "fake-github-key-abcdef123456";
});

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    await fs.rm(cleanups.pop()!, { recursive: true, force: true });
  }
});

describe("secret_profile_manage tool def", () => {
  it("exposes the 5 actions", () => {
    const def = secretProfileManageToolDef();
    expect(def.name).toBe("secret_profile_manage");
    const enumVals = (
      def.inputSchema.properties as { action: { enum: string[] } }
    ).action.enum;
    expect(enumVals.sort()).toEqual(["get", "list", "register", "remove", "test"].sort());
  });
});

describe("executeSecretProfileManage", () => {
  it("register persists and list returns it", async () => {
    const { ctx, stateDir } = await makeFixture();
    cleanups.push(stateDir);

    const reg = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({
          action: "register",
          name: "openai",
          type: "bearer",
          source: "env:__SM_OPENAI",
        }),
        ctx,
      ),
    );
    expect(reg.success).toBe(true);
    expect(reg.data.profile.name).toBe("openai");

    const list = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({ action: "list" }),
        ctx,
      ),
    );
    expect(list.success).toBe(true);
    expect(list.data.profiles.length).toBe(1);
    expect(list.data.profiles[0].source).toBe("env:__SM_OPENAI");
  });

  it("register rejects literal-secret source", async () => {
    const { ctx, stateDir } = await makeFixture();
    cleanups.push(stateDir);

    const out = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({
          action: "register",
          name: "bad",
          type: "bearer",
          source: "literal:sk-abcdefghijklmnopqrstuv",
        }),
        ctx,
      ),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/literal secret/i);
  });

  it("register refuses literal: prefix even when value looks innocuous", async () => {
    const { ctx, stateDir } = await makeFixture();
    cleanups.push(stateDir);

    const out = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({
          action: "register",
          name: "x",
          type: "bearer",
          source: "literal:short",
        }),
        ctx,
      ),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/literal/);
  });

  it("register accepts literal: when host opted in", async () => {
    const { ctx, stateDir } = await makeFixture({ allowLiteral: true });
    cleanups.push(stateDir);

    const out = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({
          action: "register",
          name: "demo",
          type: "raw",
          source: "literal:demo-token",
        }),
        ctx,
      ),
    );
    expect(out.success).toBe(true);
  });

  it("register rejects bad name", async () => {
    const { ctx, stateDir } = await makeFixture();
    cleanups.push(stateDir);

    const out = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({
          action: "register",
          name: "bad name!", // contains space + !
          type: "bearer",
          source: "env:X",
        }),
        ctx,
      ),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/invalid/i);
  });

  it("get returns metadata; remove deletes; subsequent get fails", async () => {
    const { ctx, stateDir } = await makeFixture();
    cleanups.push(stateDir);

    await executeSecretProfileManage(
      JSON.stringify({
        action: "register",
        name: "gh",
        type: "bearer",
        source: "env:__SM_GITHUB",
      }),
      ctx,
    );

    const got = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({ action: "get", name: "gh" }),
        ctx,
      ),
    );
    expect(got.success).toBe(true);
    expect(got.data.profile.type).toBe("bearer");

    const removed = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({ action: "remove", name: "gh" }),
        ctx,
      ),
    );
    expect(removed.success).toBe(true);

    const gotAgain = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({ action: "get", name: "gh" }),
        ctx,
      ),
    );
    expect(gotAgain.success).toBe(false);
  });

  it("test returns kind + ok=true and never the headers", async () => {
    const { ctx, stateDir } = await makeFixture();
    cleanups.push(stateDir);

    await executeSecretProfileManage(
      JSON.stringify({
        action: "register",
        name: "p",
        type: "bearer",
        source: "env:__SM_OPENAI",
      }),
      ctx,
    );

    const out = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({ action: "test", name: "p" }),
        ctx,
      ),
    );
    expect(out.success).toBe(true);
    expect(out.data.kind).toBe("bearer");
    expect(out.data.ok).toBe(true);
    // CRITICAL: response must NOT include the resolved Authorization
    // header or the raw token.
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain("Bearer");
    expect(serialised).not.toContain("fake-openai-key");
  });

  it("test surfaces redacted error when source missing", async () => {
    const { ctx, stateDir } = await makeFixture();
    cleanups.push(stateDir);

    await executeSecretProfileManage(
      JSON.stringify({
        action: "register",
        name: "missing",
        type: "bearer",
        source: "env:__DEFINITELY_UNSET_VAR_X",
      }),
      ctx,
    );

    const out = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({ action: "test", name: "missing" }),
        ctx,
      ),
    );
    expect(out.success).toBe(false);
    expect(out.data.code).toBe("source_read_failed");
  });

  it("unknown action surfaces error envelope", async () => {
    const { ctx, stateDir } = await makeFixture();
    cleanups.push(stateDir);

    const out = JSON.parse(
      await executeSecretProfileManage(
        JSON.stringify({ action: "wat" }),
        ctx,
      ),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/unknown action/);
  });

  it("invalid JSON input handled gracefully", async () => {
    const { ctx, stateDir } = await makeFixture();
    cleanups.push(stateDir);

    const out = JSON.parse(
      await executeSecretProfileManage("{not json", ctx),
    );
    expect(out.success).toBe(false);
  });
});
