---
tree_id: tools/demo/hello_prompt
tree_group: demo
tools: ["hello_prompt"]
min_tier: greeting
summary: Returns a friendly greeting; demonstrates skill_mode=prompt.
description: |
  The simplest possible SKILL — `skill_mode=prompt` returns the body
  verbatim as the MCP tool's response. Useful for prompt fragments,
  onboarding messages, or fixed-format responses the host LLM should
  pass through.
emoji: 👋
intent_keywords:
  zh: ["你好", "问候"]
  en: ["hello", "greet"]
intent_priority: 0
approval: none
file_access: read
security_level: standard

skill_mode: prompt
---

# Hello, world!

You invoked the `hello_prompt` SKILL. This entire markdown body is
returned to the calling LLM verbatim as the MCP tool's text content.

## What happens next

- The calling LLM reads this body and decides what to do with it.
- No host-side LLM is invoked; the SKILL is a pure prompt fragment.
- For deterministic step composition, see `hello-tool/`.
- For sub-agent spawn, see `hello-agent/`.
