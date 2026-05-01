// @acosmi/skill-agent-mcp — public surface aggregator.
//
// Concrete re-exports land progressively across commits #2 – #18:
//   commit  2 — capabilities/  (copied from @acosmi/agent v1.0)
//   commit  3 — manage/        (copied from v1.0)
//   commit  4 — llm/           (copied from v1.0)
//   commit  5 — skill/types
//   commit  6 — skill/node-provider
//   commits 7–10 — dispatch/   (agent / prompt / tool dispatchers)
//   commits 11–13 — codegen/   (skill → composed tool compiler + executor)
//   commits 15–16 — tools/     (natural-language SKILL.md generation)
//   commits 17–18 — mcp/       (McpServer factory + transports + CLI)
//
// This bootstrap commit only declares the file so `package.json#main`
// + `tsconfig` typecheck pass. There is no runtime API yet.
export {};
