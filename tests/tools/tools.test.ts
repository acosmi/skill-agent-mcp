import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import {
  executeSkillGenerate,
  executeSkillManage,
  executeSkillSuggest,
  staticSkillResolver,
} from "../../src/tools/index.ts";

const PROMPT_SKILL = `---
tree_id: tools/demo/hello_prompt
tools: ["hello_prompt"]
summary: Hello world prompt
skill_mode: prompt
---

Hello.
`;

let tmpRoot: string;
let templatesDir: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "acosmi-tools-test-"));
  templatesDir = path.resolve(import.meta.dir, "../../templates");
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("executeSkillSuggest", () => {
  it("returns the recommended template body", async () => {
    const out = await executeSkillSuggest(
      { userRequest: "spawn a sub-agent that researches a topic" },
      { templatesDir },
    );
    expect(out.recommendedTemplate).toBe("agent");
    expect(out.templateBody).toContain("agent_config:");
  });

  it("falls back to 'tool' when no keywords match", async () => {
    const out = await executeSkillSuggest(
      { userRequest: "qqqzzz xyz" },
      { templatesDir },
    );
    expect(out.recommendedTemplate).toBe("tool");
  });

  it("recognises pipeline keywords for tool template", async () => {
    const out = await executeSkillSuggest(
      { userRequest: "deterministic step pipeline composing two tools" },
      { templatesDir },
    );
    expect(out.recommendedTemplate).toBe("tool");
    expect(out.rationale).toContain("pipeline");
  });
});

describe("executeSkillGenerate", () => {
  it("validates and persists a SKILL.md draft", async () => {
    const skillDir = path.join(tmpRoot, "gen-ok");
    const out = await executeSkillGenerate(
      { skillMdContent: PROMPT_SKILL, skillDir },
      {},
    );
    expect(out.saved).toBe(true);
    const content = await fs.readFile(out.filePath, "utf-8");
    expect(content).toContain("hello_prompt");
  });

  it("refuses content without frontmatter", async () => {
    const out = await executeSkillGenerate(
      {
        skillMdContent: "no frontmatter here",
        skillDir: path.join(tmpRoot, "no-front"),
      },
      {},
    );
    expect(out.saved).toBe(false);
    expect(out.parseErrors?.[0]).toContain("frontmatter");
  });

  it("refuses paths outside workspace_root", async () => {
    const out = await executeSkillGenerate(
      {
        skillMdContent: PROMPT_SKILL,
        skillDir: path.join(tmpRoot, "..", "..", "outside"),
      },
      { workspaceRoot: tmpRoot },
    );
    expect(out.saved).toBe(false);
    expect(out.parseErrors?.[0]).toContain("outside workspace_root");
  });
});

describe("executeSkillManage", () => {
  it("list / get / delete round trip", async () => {
    const skillsDir = path.join(tmpRoot, "skills-lib");
    await fs.mkdir(path.join(skillsDir, "tools/demo/hello_prompt"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(skillsDir, "tools/demo/hello_prompt", "SKILL.md"),
      PROMPT_SKILL,
    );

    const list = await executeSkillManage({ action: "list" }, { skillsDir });
    expect(list.ok).toBe(true);
    expect(list.entries?.length).toBe(1);
    expect(list.entries?.[0]?.treeId).toBe("tools/demo/hello_prompt");

    const get = await executeSkillManage(
      { action: "get", treeId: "tools/demo/hello_prompt" },
      { skillsDir },
    );
    expect(get.ok).toBe(true);
    expect(get.skillMdContent).toContain("hello_prompt");

    const del = await executeSkillManage(
      { action: "delete", treeId: "tools/demo/hello_prompt" },
      { skillsDir },
    );
    expect(del.ok).toBe(true);
  });

  it("update rejects content failing validateSkillMode", async () => {
    const skillsDir = path.join(tmpRoot, "skills-lib-2");
    const result = await executeSkillManage(
      {
        action: "update",
        treeId: "tools/demo/bad",
        skillMdContent: `---
tree_id: tools/demo/bad
skill_mode: agent
---

body
`,
      },
      { skillsDir },
    );
    expect(result.ok).toBe(false);
    expect(result.validateError?.code).toBe("missing_agent_config");
  });
});

describe("staticSkillResolver", () => {
  it("listAgentSkills only returns skill_mode=agent SKILLs", () => {
    const resolver = staticSkillResolver({
      "tools/demo/hello_prompt": PROMPT_SKILL,
      "agents/demo/hello_agent": `---
tree_id: agents/demo/hello_agent
summary: agent demo
skill_mode: agent
agent_config:
  role_title: helper
---

body
`,
    });
    expect(resolver.listAgentSkills()).toEqual(["agents/demo/hello_agent"]);
    expect(resolver.resolveAgentSkill("tools/demo/hello_prompt")).toBeUndefined();
    expect(
      resolver.resolveAgentSkill("agents/demo/hello_agent")?.agentConfig.roleTitle,
    ).toBe("helper");
    expect(resolver.resolveAny("agents/demo/hello_agent")?.metadata.skillMode).toBe(
      "agent",
    );
  });
});
