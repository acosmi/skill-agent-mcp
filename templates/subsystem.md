---
tree_id: subsystems/<group>/<subsystem_name>
tree_group: subsystems
min_tier: task_write
summary: One-line description of the subsystem.
description: |
  Subsystems are bundles of related capabilities the host wires up
  together. The SKILL.md is documentation; the actual implementation
  lives in code the MCP server owns.
emoji: 🧩
approval: plan_confirm
file_access: read
security_level: standard

skill_mode: prompt
---

# Subsystem SKILL — minimal template

Subsystem SKILLs document a coherent capability bundle (e.g. "filesystem
mount", "vector store") so the calling LLM can discover which tools it
exposes and how they compose. They default to `skill_mode: prompt`
because the body is reference material rather than a step pipeline.

## Capabilities exposed

- `<tool_a>` — what it does.
- `<tool_b>` — what it does.
- `<tool_c>` — what it does.

## Cross-references

- Use `<tool_a>` before `<tool_b>` when…
- Skip `<tool_c>` if…
