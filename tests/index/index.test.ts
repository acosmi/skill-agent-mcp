import { describe, expect, it } from "bun:test";

// P0-1: top-level package surface must re-export every subsystem so users
// can `import { ... } from "@acosmi/skill-agent-mcp"`. Pre-fix this file
// only contained `export {};` so every named import resolved to undefined.
import * as pkg from "../../src/index.ts";
import {
  AnthropicLLMClient,
  CapabilityTree,
  ComposedToolStore,
  OpenAILLMClient,
  buildSkillAgentSystemPrompt,
  createServer,
  dispatchPromptSkill,
  executeManageTool,
  executeSkillSuggest,
  parseExtendedSkillFrontmatter,
  parseSkillFrontmatter,
} from "../../src/index.ts";

describe("top-level package surface (P0-1)", () => {
  it("re-exports CapabilityTree (capabilities/)", () => {
    expect(typeof CapabilityTree).toBe("function");
    expect(new CapabilityTree().nodeCount()).toBe(0);
  });

  it("re-exports createServer (mcp/)", () => {
    expect(typeof createServer).toBe("function");
  });

  it("re-exports AnthropicLLMClient + OpenAILLMClient (llm/)", () => {
    expect(typeof AnthropicLLMClient).toBe("function");
    expect(typeof OpenAILLMClient).toBe("function");
  });

  it("re-exports dispatchPromptSkill + buildSkillAgentSystemPrompt (dispatch/)", () => {
    expect(typeof dispatchPromptSkill).toBe("function");
    expect(typeof buildSkillAgentSystemPrompt).toBe("function");
  });

  it("re-exports ComposedToolStore (codegen/)", () => {
    expect(typeof ComposedToolStore).toBe("function");
  });

  it("re-exports executeManageTool + parseSkillFrontmatter (manage/)", () => {
    expect(typeof executeManageTool).toBe("function");
    expect(typeof parseSkillFrontmatter).toBe("function");
  });

  it("re-exports parseExtendedSkillFrontmatter (skill/)", () => {
    expect(typeof parseExtendedSkillFrontmatter).toBe("function");
  });

  it("re-exports executeSkillSuggest (tools/)", () => {
    expect(typeof executeSkillSuggest).toBe("function");
  });

  it("namespace import surface contains expected core names", () => {
    const expected = [
      "CapabilityTree",
      "createServer",
      "AnthropicLLMClient",
      "OpenAILLMClient",
      "ComposedToolStore",
      "executeManageTool",
      "parseSkillFrontmatter",
      "parseExtendedSkillFrontmatter",
      "dispatchPromptSkill",
      "buildSkillAgentSystemPrompt",
      "executeSkillSuggest",
    ];
    for (const name of expected) {
      expect((pkg as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});
