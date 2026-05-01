---
tree_id: operations/<group>/<operation_name>
tree_group: operations
min_tier: task_write
summary: One-line description of the operation.
description: |
  Longer prose body explaining when this operation should be invoked
  and what side-effects it has.
emoji: ⚙️
approval: plan_confirm
file_access: write
security_level: elevated

skill_mode: prompt
---

# Operations SKILL — minimal template

Operations SKILLs default to `skill_mode: prompt`, meaning the SKILL
body itself is the answer the calling LLM should follow. There is no
embedded `tool_schema` — the LLM reads this body and decides which
underlying tools to invoke directly.

Use this template for "playbook"-style guidance that needs the calling
LLM to make decisions step by step (e.g. "to deploy a release, first do
X, then check Y, then run Z"). For deterministic step composition,
prefer the `tool` template instead.

## Standard procedure

1. Step one — what to do, what to check.
2. Step two — what to do, what to check.
3. Step three — what to do, what to check.

## Approval gates

- Plan confirmation required before step 2.
- Execution escalation required before step 3.
