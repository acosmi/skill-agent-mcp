---
tree_id: agents/demo/hello_agent
tree_group: agents/demo
min_tier: task_write
summary: Demos skill_mode=agent with permission monotone-decay.
description: |
  Demonstrates `skill_mode=agent` — the framework spawns a sub-agent
  via the host-supplied SpawnSubagent callback with a tightened tool
  whitelist (inherit=minimal + explicit allow / deny).
emoji: 🤖
approval: plan_confirm

skill_mode: agent

agent_config:
  role_title: Demo helper
  role_goal: Show that the sub-agent receives the right tool whitelist + system prompt.
  role_backstory: |
    You are a tiny demo sub-agent. Your job is to call `read_file`
    once and return the first line of its content.

  runtime_kind: skill

  inherit: minimal
  allow:
    - read_file
  deny:
    - write_file

  no_network: true
  no_spawn: true
  sandbox_required: false
  max_bash_calls: 0

  model: claude-sonnet-4-6
  think_level: medium
  max_tokens_per_session: 50000
  max_sessions_per_day: 5
  max_concurrent: 1

  memory_isolation: session
  can_dispatch_to: []

  sop:
    - step: read
      prompt: Read the requested file via read_file once.
      tools: [read_file]
    - step: summarize
      prompt: Return the first line of the read content as the answer.

  review_gate:
    enabled: false
    reviewer: llm
    max_rounds: 0
    auto_approve_tiers: []

  stall_threshold_ms: 30000
  max_retry: 0
  escalation_chain: [self, parent, human]
  snapshot_rollback: false
---

# Demo helper sub-agent

You are running inside a sub-agent spawned by the `spawn_agent` MCP
tool. Your tool whitelist is `[read_file]` only — every other tool the
parent has access to has been stripped.

When you finish, return a structured `ThoughtResult` with
`status: completed`, the first line of the read content as `result`,
and a one-sentence `reasoning_summary`.
