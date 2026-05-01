---
tree_id: tools/<group>/<tool_name>
tree_group: <group>
tools: ["<tool_name>"]
min_tier: task_light
summary: One-line description shown in tool listings.
description: |
  Longer prose body. The MCP server returns this verbatim as part of the
  tool's `description` field so the calling LLM understands when to use it.
emoji: 🔧
intent_keywords:
  zh: ["关键词1", "关键词2"]
  en: ["keyword1", "keyword2"]
intent_priority: 0
approval: none
file_access: read
security_level: standard

# tool_schema declares the composed-step pipeline. Each step calls one
# underlying tool registered in the host's ToolCallbackRegistry.
tool_schema:
  input:
    type: object
    properties:
      query:
        type: string
        description: User-supplied query
    required: [query]
  output:
    type: object
    properties:
      result:
        type: string
  steps:
    - action: lookup
      description: Look up source data
      tool: read_file
      input_map:
        path: "{{ input.query }}"
      output_as: raw
      approval: none
      on_error: abort
    - action: format
      description: Format the result
      tool: format_text
      input_map:
        text: "{{ raw }}"
      output_as: result
      approval: none
      on_error: skip
---

# Tool SKILL — minimal template

Describe what this tool does, when to invoke it, and what the caller
should expect back. The codegen compiler (commit #12) reads this
frontmatter into a `ComposedToolDef`; the executor (commit #13) walks
`tool_schema.steps[]` at MCP-tool invocation time.

## Variables

- `input.<field>` — the MCP tool's user-supplied input.
- `<step.output_as>` — the named output of any preceding step.
- `item` — the current loop element (only inside `loop_over` steps).
