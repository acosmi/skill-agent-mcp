---
tree_id: internal/<group>/<name>
tree_group: internal
min_tier: greeting
summary: Internal-only SKILL — not exposed to user-invocation.
description: |
  Internal SKILLs are loaded into the capability tree but flagged so
  they do not appear in user-facing tool listings. Used for prompt
  fragments / scaffolding the model needs but the user should never
  invoke directly.
emoji: 🔒
approval: none
file_access: read
security_level: standard

skill_mode: prompt
exclude_from: ["user_listing", "tool_picker"]
---

# Internal SKILL — minimal template

Internal SKILLs serve as building blocks for other SKILLs (typically
pulled in via `composed_tools` references) or as system-level prompt
context the model needs but should not invoke directly.

Keep the body short — it gets injected into other prompts wholesale.
