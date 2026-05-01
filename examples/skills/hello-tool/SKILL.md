---
tree_id: tools/demo/hello_tool
tree_group: demo
tools: ["hello_tool"]
min_tier: task_light
summary: Composes echo + uppercase to demo skill_mode=tool steps.
description: |
  Demonstrates `skill_mode=tool` by composing two host-supplied
  callbacks (`echo` + `uppercase`) into one MCP tool. The codegen
  compiler turns this `tool_schema.steps[]` into a ComposedToolDef;
  the executor walks the steps at MCP-tool invocation time.
emoji: 📢
intent_keywords:
  zh: ["回声", "大写"]
  en: ["echo", "uppercase"]
intent_priority: 0
approval: none
file_access: read
security_level: standard

tool_schema:
  input:
    type: object
    properties:
      message:
        type: string
        description: Message to echo (will be uppercased)
    required: [message]
  output:
    type: object
    properties:
      shouted:
        type: string
  steps:
    - action: repeat
      description: Echo the message back
      tool: echo
      input_map:
        text: "{{ input.message }}"
      output_as: echoed
      approval: none
      on_error: abort

    - action: shout
      description: Uppercase the echoed message
      tool: uppercase
      input_map:
        text: "{{ echoed }}"
      output_as: shouted
      approval: none
      on_error: abort
---

# Hello, tool!

This SKILL composes two host-registered callbacks (`echo` and
`uppercase`) via the `tool_schema.steps[]` block above. See
`examples/tool-callback-registry.ts` for a reference implementation
of those callbacks.
