import { describe, expect, it } from "bun:test";

import {
  executeSkillDrivenSpawn,
  type ResolvedAgentSkill,
  type SpawnContext,
  type SpawnSubagentParams,
  type SubagentRunOutcome,
} from "../../src/dispatch/index.ts";

function makeSkill(): ResolvedAgentSkill {
  return {
    skillName: "test_agent",
    agentConfig: { roleTitle: "tester" },
    skillBody: "",
  };
}

function makeContext(
  capture: { value?: SpawnSubagentParams },
): SpawnContext {
  return {
    parentSessionId: "sess-1",
    parentToolNames: [],
    skillResolver: {
      resolveAgentSkill: () => undefined,
      listAgentSkills: () => [],
    },
    spawnSubagent: async (params): Promise<SubagentRunOutcome> => {
      capture.value = params;
      return { status: "completed" };
    },
  };
}

describe("executeSkillDrivenSpawn — contract.timeoutMs (P1-1)", () => {
  it("propagates input.timeoutMs into contract.timeoutMs (not stuck at default)", async () => {
    const captured: { value?: SpawnSubagentParams } = {};
    await executeSkillDrivenSpawn(
      { skillName: "test_agent", task: "hello", timeoutMs: 30_000 },
      makeSkill(),
      makeContext(captured),
    );
    expect(captured.value).toBeDefined();
    expect(captured.value?.timeoutMs).toBe(30_000);
    expect(captured.value?.contract.timeoutMs).toBe(30_000);
  });

  it("input.timeoutMs undefined → contract.timeoutMs defaults to 60_000", async () => {
    const captured: { value?: SpawnSubagentParams } = {};
    await executeSkillDrivenSpawn(
      { skillName: "test_agent", task: "hello" },
      makeSkill(),
      makeContext(captured),
    );
    expect(captured.value?.timeoutMs).toBe(60_000);
    expect(captured.value?.contract.timeoutMs).toBe(60_000);
  });

  it("input.timeoutMs<=0 falls back to default — and contract matches", async () => {
    const captured: { value?: SpawnSubagentParams } = {};
    await executeSkillDrivenSpawn(
      { skillName: "test_agent", task: "hello", timeoutMs: 0 },
      makeSkill(),
      makeContext(captured),
    );
    expect(captured.value?.timeoutMs).toBe(60_000);
    expect(captured.value?.contract.timeoutMs).toBe(60_000);
  });

  it("contract.formatForSystemPrompt exposes the consistent timeoutMs", async () => {
    const captured: { value?: SpawnSubagentParams } = {};
    await executeSkillDrivenSpawn(
      { skillName: "test_agent", task: "hello", timeoutMs: 12_345 },
      makeSkill(),
      makeContext(captured),
    );
    const formatted = captured.value?.contract.formatForSystemPrompt();
    expect(formatted).toContain("12345ms");
  });
});
