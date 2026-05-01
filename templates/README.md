# SKILL.md templates

This folder holds the five canonical SKILL.md skeletons new authors
should start from. Each template ships a complete frontmatter block
with every relevant field set to a sensible default plus inline
comments explaining when to override.

| File | Mode | Use when |
|------|------|----------|
| `tool.md` | `skill_mode: tool` | You can express the SKILL as a deterministic step pipeline composing existing tools. The codegen compiler (commit #12) compiles `tool_schema.steps[]` into a single callable composed tool. |
| `operations.md` | `skill_mode: prompt` | You need the calling LLM to follow a playbook step by step, with judgment calls between steps (deploys, incident response, etc.). |
| `agent.md` | `skill_mode: agent` | You need a separate sub-agent session with its own role, capability slice, and budget. The `spawn_agent` MCP tool consumes this. |
| `subsystem.md` | `skill_mode: prompt` | You're documenting a coherent bundle of related tools so the calling LLM knows when to compose them. |
| `internal.md` | `skill_mode: prompt` | Reusable prompt fragments that should not be exposed to user-invocation. Loaded into the capability tree but excluded from user-facing listings. |

## Field reference

The full grammar (every field, every value enum, every legal
combination) is documented in [`docs/SKILL-TEMPLATE.md`](../docs/SKILL-TEMPLATE.md).

## Validating

Once you've authored a `SKILL.md`, validate it against the schema:

```bash
acosmi-skill-agent-mcp skill parse path/to/SKILL.md
acosmi-skill-agent-mcp skill validate path/to/SKILL.md
```

The CLI lands in commit #18; until then, parse the file
programmatically:

```ts
import { parseExtendedSkillFrontmatter, validateSkillMode } from "@acosmi/skill-agent-mcp/skill";

const parsed = parseExtendedSkillFrontmatter(await Bun.file("SKILL.md").text());
if (!parsed?.metadata) throw new Error("invalid SKILL.md");
const error = validateSkillMode(parsed.metadata);
if (error) throw new Error(`${error.code}: ${error.message}`);
```
