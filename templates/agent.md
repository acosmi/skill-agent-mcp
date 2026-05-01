---
tree_id: agents/<group>/<agent_name>
tree_group: agents
min_tier: task_write
summary: One-line description of the sub-agent's role.
description: |
  Longer prose body. Used as the SKILL.md description fallback when
  the metadata-level summary is empty.
emoji: 🤖
approval: plan_confirm

skill_mode: agent

agent_config:
  # ── Role definition ──
  role_title: <Role title>
  role_goal: One-sentence statement of what success looks like for this role.
  role_backstory: |
    Multi-paragraph backstory injected ahead of the SKILL body.

  # ── Runtime ──
  runtime_kind: skill   # "skill" | "coder" | "media"

  # ── Capability inheritance + tightening ──
  inherit: minimal      # "full" | "minimal" | "none"
  allow:
    - read_file
    - write_file
    - bash
  deny:
    - shell_admin

  # ── Safety constraints ──
  no_network: false
  no_spawn: true
  sandbox_required: false
  allowed_commands:
    - git
    - rg
  max_bash_calls: 20

  # ── Resource budget ──
  model: claude-sonnet-4-6
  think_level: medium
  max_tokens_per_session: 200000
  max_sessions_per_day: 50
  max_concurrent: 1
  max_tokens_per_day: 5000000

  # ── Memory + dispatch ──
  memory_scope: session
  shared_read: []
  shared_write: []
  memory_isolation: session   # "session" | "persistent" | "shared"
  can_dispatch_to: []         # e.g. ["agents/sub/helper"]

  # ── Channel binding ──
  respond_to: []              # e.g. ["main"]
  listen_only: []

  # ── Auto-trigger ──
  triggers:
    cron:
      - schedule: "0 9 * * *"
        task: "morning briefing"
    event:
      - event: file_created
        source: workspace
    message_match:
      - pattern: "^@helper "
        task: handle direct mention

  # ── Standard Operating Procedure ──
  sop:
    - step: read_intake
      prompt: Inspect the request payload before any tool invocation.
      tools: [read_file]
    - step: plan
      prompt: Propose a plan; call review_gate.request when ready.
    - step: execute
      condition: review_gate.approved
      tools: [bash, write_file]

  # ── Quality review gate ──
  review_gate:
    enabled: true
    reviewer: llm   # "llm" | "rule" | "human"
    max_rounds: 2
    auto_approve_tiers:
      - greeting
      - question

  # ── Schedule + fault-tolerance ──
  stall_threshold_ms: 90000
  max_retry: 1
  escalation_chain: [self, parent, human]
  snapshot_rollback: false

  # ── Composed tool binding ──
  composed_tools: []
---

# Agent SKILL — minimal template

The body becomes the sub-agent's system prompt suffix (after Role / Goal
/ Backstory). Treat it as the place to spell out:

- The exact deliverable expected.
- Tone / formatting requirements.
- Escalation triggers.
