import { describe, expect, it } from "bun:test";

import {
  buildSOPPromptSection,
  buildSkillAgentSystemPrompt,
  dispatchPromptSkill,
  executeSkillDrivenSpawn,
  type ResolvedAgentSkill,
  resolveSkillAgentCapabilities,
  type SpawnContext,
  type SubagentRunOutcome,
} from "../../src/dispatch/index.ts";

describe("resolveSkillAgentCapabilities", () => {
  it("inherit=undefined returns full parent set", () => {
    const out = resolveSkillAgentCapabilities(undefined, ["a", "b", "c"]);
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("inherit=none + allow whitelist", () => {
    const out = resolveSkillAgentCapabilities(
      { roleTitle: "x", inherit: "none", allow: ["a", "c"] },
      ["a", "b", "c"],
    );
    expect(new Set(out)).toEqual(new Set(["a", "c"]));
  });

  it("inherit=minimal + allow appends", () => {
    const out = resolveSkillAgentCapabilities(
      { roleTitle: "x", inherit: "minimal", allow: ["custom"] },
      ["bash", "read_file", "write_file", "list_dir", "custom", "other"],
    );
    expect(new Set(out)).toEqual(
      new Set(["bash", "read_file", "write_file", "list_dir", "custom"]),
    );
  });

  it("allow cannot escape parent set (monotone-decay)", () => {
    const out = resolveSkillAgentCapabilities(
      { roleTitle: "x", inherit: "none", allow: ["forbidden"] },
      ["a", "b"],
    );
    expect(out).toEqual([]);
  });

  it("deny removes from result set", () => {
    const out = resolveSkillAgentCapabilities(
      { roleTitle: "x", inherit: "full", deny: ["b"] },
      ["a", "b", "c"],
    );
    expect(new Set(out)).toEqual(new Set(["a", "c"]));
  });
});

describe("buildSOPPromptSection", () => {
  it("returns empty string for empty input", () => {
    expect(buildSOPPromptSection(undefined)).toBe("");
    expect(buildSOPPromptSection([])).toBe("");
  });

  it("formats each step with index + Guidance", () => {
    const out = buildSOPPromptSection([
      { step: "first" },
      { step: "second", prompt: "do it" },
    ]);
    expect(out).toContain("1. first");
    expect(out).toContain("2. second");
    expect(out).toContain("Guidance: do it");
  });
});

describe("buildSkillAgentSystemPrompt", () => {
  it("composes Role + Goal + Backstory + body", () => {
    const skill: ResolvedAgentSkill = {
      skillName: "demo",
      agentConfig: {
        roleTitle: "Helper",
        roleGoal: "be helpful",
        roleBackstory: "You are kind.",
      },
      skillBody: "Always greet first.",
    };
    const prompt = buildSkillAgentSystemPrompt(skill);
    expect(prompt).toContain("# Role: Helper");
    expect(prompt).toContain("Goal: be helpful");
    expect(prompt).toContain("You are kind.");
    expect(prompt).toContain("Always greet first.");
  });
});

describe("dispatchPromptSkill", () => {
  it("returns body verbatim when no query", () => {
    const out = dispatchPromptSkill(
      { treeId: "tools/x/y" },
      "  Hello body.",
    );
    expect(out.text).toBe("Hello body.");
  });

  it("prepends query when supplied", () => {
    const out = dispatchPromptSkill(
      { treeId: "tools/x/y" },
      "Body.",
      { query: "what is x?" },
    );
    expect(out.text).toContain("## Query\nwhat is x?");
    expect(out.text).toContain("## SKILL: tools/x/y");
    expect(out.text).toContain("Body.");
  });
});

describe("executeSkillDrivenSpawn", () => {
  it("invokes the SpawnSubagent callback with the resolved tool whitelist", async () => {
    let capturedAllowed: readonly string[] | undefined;
    const ctx: SpawnContext = {
      parentSessionId: "test",
      parentToolNames: ["bash", "read_file", "write_file", "list_dir", "extra"],
      skillResolver: {
        resolveAgentSkill: () => undefined,
        listAgentSkills: () => [],
      },
      spawnSubagent: async (params): Promise<SubagentRunOutcome> => {
        capturedAllowed = params.subAgentAllowedTools;
        return {
          status: "completed",
          thoughtResult: {
            contractId: params.contract.contractId,
            status: "completed",
            result: "ok",
          },
        };
      },
    };
    const skill: ResolvedAgentSkill = {
      skillName: "demo",
      agentConfig: {
        roleTitle: "Helper",
        inherit: "minimal",
        allow: ["extra"],
      },
      skillBody: "",
    };
    const text = await executeSkillDrivenSpawn(
      { skillName: "demo", task: "hi" },
      skill,
      ctx,
    );
    expect(text).toContain("Status: completed");
    expect(text).toContain("ok");
    expect(new Set(capturedAllowed ?? [])).toEqual(
      new Set(["bash", "read_file", "write_file", "list_dir", "extra"]),
    );
  });

  it("returns error string when SpawnSubagent throws", async () => {
    const ctx: SpawnContext = {
      parentSessionId: "t",
      parentToolNames: [],
      skillResolver: {
        resolveAgentSkill: () => undefined,
        listAgentSkills: () => [],
      },
      spawnSubagent: async () => {
        throw new Error("kaboom");
      },
    };
    const skill: ResolvedAgentSkill = {
      skillName: "demo",
      agentConfig: { roleTitle: "x" },
      skillBody: "",
    };
    const text = await executeSkillDrivenSpawn(
      { skillName: "demo", task: "hi" },
      skill,
      ctx,
    );
    expect(text).toContain("Sub-agent spawn failed: kaboom");
  });
});
