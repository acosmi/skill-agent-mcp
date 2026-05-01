import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  codegen,
  ComposedToolStore,
  ComposedSubsystem,
  COMPOSED_TOOLS_FILENAME,
  type ExecuteToolFn,
  loadComposedToolStore,
  lookupPath,
  normalizeApproval,
  normalizeOnError,
  resolveTemplate,
  sanitizeName,
  sha256Hex,
  type ToolTreeLookup,
} from "../../src/codegen/index.ts";

// Trivial tree lookup that whitelists a fixed set of tool names.
function fakeTree(tools: Record<string, string>): ToolTreeLookup {
  return {
    lookupTool(name) {
      if (!(name in tools)) return undefined;
      return { nodeId: `node/${name}`, approvalType: tools[name]! };
    },
  };
}

describe("sanitizeName / sha256Hex / normalizers", () => {
  it("sanitizeName replaces hyphens / spaces / dots with underscore", () => {
    expect(sanitizeName("media-cross publish.v2")).toBe("media_cross_publish_v2");
  });

  it("sha256Hex is deterministic", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });

  it("normalizeApproval defaults unknown to 'none'", () => {
    expect(normalizeApproval("plan_confirm")).toBe("plan_confirm");
    expect(normalizeApproval("bogus")).toBe("none");
  });

  it("normalizeOnError accepts skip/retry/abort, defaults to abort", () => {
    expect(normalizeOnError("skip")).toBe("skip");
    expect(normalizeOnError("retry")).toBe("retry");
    expect(normalizeOnError("xxx")).toBe("abort");
  });
});

describe("codegen", () => {
  const tree = fakeTree({ echo: "none", upper: "plan_confirm" });

  it("compiles a valid skill into a ComposedToolDef", () => {
    const result = codegen(
      [
        {
          name: "demo-echo",
          dir: "/skills/demo-echo",
          description: "demo",
          content: "x",
          toolSchema: {
            steps: [
              {
                action: "e",
                description: "",
                tool: "echo",
                inputMap: { text: "{{ input.q }}" },
                outputAs: "out",
                approval: "",
                onError: "",
                loopOver: "",
              },
            ],
          },
        },
      ],
      tree,
    );
    expect(result.tools.length).toBe(1);
    expect(result.tools[0]?.name).toBe("skill_demo_echo");
    expect(result.tools[0]?.maxApproval).toBe("none");
  });

  it("derives strictest approval from steps", () => {
    const result = codegen(
      [
        {
          name: "demo-strict",
          dir: "/x",
          description: "",
          content: "x",
          toolSchema: {
            steps: [
              {
                action: "e",
                description: "",
                tool: "echo",
                inputMap: {},
                outputAs: "",
                approval: "",
                onError: "",
                loopOver: "",
              },
              {
                action: "u",
                description: "",
                tool: "upper",
                inputMap: {},
                outputAs: "",
                approval: "",
                onError: "",
                loopOver: "",
              },
            ],
          },
        },
      ],
      tree,
    );
    // upper inherits plan_confirm from tree node
    expect(result.tools[0]?.maxApproval).toBe("plan_confirm");
  });

  it("reports error when step.tool is missing from tree", () => {
    const result = codegen(
      [
        {
          name: "broken",
          dir: "/x",
          description: "",
          content: "x",
          toolSchema: {
            steps: [
              {
                action: "e",
                description: "",
                tool: "missing_tool",
                inputMap: {},
                outputAs: "",
                approval: "",
                onError: "",
                loopOver: "",
              },
            ],
          },
        },
      ],
      tree,
    );
    expect(result.tools.length).toBe(0);
    expect(result.errors?.[0]?.message).toContain("missing_tool");
  });
});

describe("ComposedToolStore (in-memory)", () => {
  it("set/get/delete/names", () => {
    const store = new ComposedToolStore();
    store.set({
      name: "skill_x",
      skillName: "x",
      skillPath: "/p",
      description: "",
      inputSchema: {},
      outputSchema: {},
      steps: [],
      maxApproval: "none",
      treeNodeId: "composed/skill_x",
      compiledAt: "2026-01-01T00:00:00Z",
      skillHash: "abc",
    });
    expect(store.get("skill_x")?.skillName).toBe("x");
    expect(store.names()).toEqual(["skill_x"]);
    expect(store.delete("skill_x")).toBe(true);
    expect(store.size()).toBe(0);
  });
});

describe("template engine", () => {
  it("resolves pure variable refs preserving raw type", () => {
    const obj = { a: { b: [1, 2, 3] } };
    expect(resolveTemplate("{{ a.b }}", obj)).toEqual([1, 2, 3]);
  });

  it("interpolates mixed strings", () => {
    const out = resolveTemplate("name={{ a.name }} age={{ a.age }}", {
      a: { name: "alice", age: 30 },
    });
    expect(out).toBe("name=alice age=30");
  });

  it("lookupPath throws on missing key", () => {
    expect(() => lookupPath("a.b.c", { a: { b: {} } })).toThrow();
  });
});

describe("ComposedSubsystem.executeTool", () => {
  it("runs steps in order and binds output", async () => {
    const store = new ComposedToolStore();
    store.set({
      name: "skill_pipe",
      skillName: "pipe",
      skillPath: "/p",
      description: "",
      inputSchema: {},
      outputSchema: {},
      steps: [
        {
          action: "first",
          description: "",
          tool: "echo",
          inputMap: { text: "{{ input.msg }}" },
          outputAs: "echoed",
          approval: "none",
          onError: "abort",
          loopOver: "",
          toolNodeId: "node/echo",
        },
        {
          action: "second",
          description: "",
          tool: "shout",
          inputMap: { text: "{{ echoed }}" },
          outputAs: "loud",
          approval: "none",
          onError: "abort",
          loopOver: "",
          toolNodeId: "node/shout",
        },
      ],
      maxApproval: "none",
      treeNodeId: "composed/skill_pipe",
      compiledAt: "2026-01-01T00:00:00Z",
      skillHash: "abc",
    });
    const exec: ExecuteToolFn = async (name, jsonInput) => {
      const input = JSON.parse(jsonInput) as { text: string };
      if (name === "echo") return input.text;
      if (name === "shout") return input.text.toUpperCase();
      throw new Error(`unknown tool ${name}`);
    };
    const subsystem = new ComposedSubsystem(store, exec);
    const result = await subsystem.executeTool(
      "skill_pipe",
      JSON.stringify({ msg: "hello" }),
    );
    expect(result).toContain("HELLO");
    expect(result).toContain("Step 1: first [done]");
    expect(result).toContain("Step 2: second [done]");
  });

  it("on_error=skip continues past failed step", async () => {
    const store = new ComposedToolStore();
    store.set({
      name: "skill_partial",
      skillName: "partial",
      skillPath: "/p",
      description: "",
      inputSchema: {},
      outputSchema: {},
      steps: [
        {
          action: "boom",
          description: "",
          tool: "boom",
          inputMap: {},
          outputAs: "",
          approval: "none",
          onError: "skip",
          loopOver: "",
          toolNodeId: "node/boom",
        },
        {
          action: "ok",
          description: "",
          tool: "ok",
          inputMap: {},
          outputAs: "",
          approval: "none",
          onError: "abort",
          loopOver: "",
          toolNodeId: "node/ok",
        },
      ],
      maxApproval: "none",
      treeNodeId: "composed/skill_partial",
      compiledAt: "2026-01-01T00:00:00Z",
      skillHash: "abc",
    });
    const exec: ExecuteToolFn = async (name) => {
      if (name === "boom") throw new Error("boom");
      return "OK";
    };
    const result = await new ComposedSubsystem(store, exec).executeTool(
      "skill_partial",
      JSON.stringify({}),
    );
    expect(result).toContain("Step 1: boom [error]");
    expect(result).toContain("Step 2: ok [done]");
  });

  it("loop_over referencing a non-array variable aborts with descriptive error (P2-4)", async () => {
    const store = new ComposedToolStore();
    store.set({
      name: "skill_loop_bad",
      skillName: "loop_bad",
      skillPath: "/p",
      description: "",
      inputSchema: {},
      outputSchema: {},
      steps: [
        {
          action: "iterate",
          description: "",
          tool: "echo",
          inputMap: { text: "{{item}}" },
          outputAs: "",
          approval: "none",
          onError: "abort",
          loopOver: "{{ input.items }}",
          toolNodeId: "node/echo",
        },
      ],
      maxApproval: "none",
      treeNodeId: "composed/skill_loop_bad",
      compiledAt: "2026-01-01T00:00:00Z",
      skillHash: "abc",
    });
    const exec: ExecuteToolFn = async () => "should not be called";
    const result = await new ComposedSubsystem(store, exec).executeTool(
      "skill_loop_bad",
      JSON.stringify({ items: "this-is-a-string-not-an-array" }),
    );
    expect(result).toContain("loop_over expects array, got string");
  });
});

describe("loadComposedToolStore — schema validation", () => {
  let tmpRoot: string;
  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "acosmi-codegen-store-"));
  });
  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("rejects payload where `tools` is an array (Object.entries on array would mis-iterate as string keys)", async () => {
    const dir = await fs.mkdtemp(path.join(tmpRoot, "arr-"));
    await fs.writeFile(
      path.join(dir, COMPOSED_TOOLS_FILENAME),
      JSON.stringify({ version: 1, tools: [], updatedAt: "2026-05-01T00:00:00Z" }),
    );
    const result = await loadComposedToolStore(dir);
    expect(result.error).toBeDefined();
    expect(result.error?.message ?? "").toContain("invalid store schema");
    expect(result.store.size()).toBe(0);
  });

  it("accepts payload where `tools` is a Record object", async () => {
    const dir = await fs.mkdtemp(path.join(tmpRoot, "obj-"));
    await fs.writeFile(
      path.join(dir, COMPOSED_TOOLS_FILENAME),
      JSON.stringify({ version: 1, tools: {}, updatedAt: "2026-05-01T00:00:00Z" }),
    );
    const result = await loadComposedToolStore(dir);
    expect(result.error).toBeUndefined();
  });
});
