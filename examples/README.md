# Examples

Three demo SKILL.md files (one per `skill_mode`) plus reference
implementations of the host-supplied callbacks the framework expects.

## Files

| Path | Purpose |
|------|---------|
| `claude-desktop-config.json` | Drop-in `mcpServers` block for Claude Desktop / Code. Replace the `/absolute/path/to/...` placeholders before use. |
| `skills/hello-prompt/SKILL.md` | Minimal `skill_mode=prompt` SKILL. The body is returned verbatim. |
| `skills/hello-tool/SKILL.md` | `skill_mode=tool` composing two host callbacks (`echo` → `uppercase`). |
| `skills/hello-agent/SKILL.md` | `skill_mode=agent` with a tightened whitelist (`inherit: minimal` + `allow: [read_file]`). |
| `tool-callback-registry.ts` | Example `InMemoryToolCallbackRegistry` registering `echo` / `uppercase` / a stub `read_file`. |
| `agent-runner-impl.ts` | Stub `SpawnSubagent` (no-LLM canned reply) + sketch of an LLM-backed implementation. |

## Wiring the demo locally

```ts
import { CapabilityTree, setTreeBuilder } from "@acosmi/skill-agent-mcp/capabilities";
import { ComposedToolStore } from "@acosmi/skill-agent-mcp/codegen";
import { staticSkillResolver } from "@acosmi/skill-agent-mcp/tools";
import { createServer, createStdioTransport } from "@acosmi/skill-agent-mcp/mcp";

import { buildExampleRegistry } from "./tool-callback-registry.ts";
import { stubSpawnSubagent } from "./agent-runner-impl.ts";
import { promises as fs } from "node:fs";

// 1. Capability tree (empty for the demo; production hosts seed real nodes).
const tree = new CapabilityTree();
setTreeBuilder(() => tree);

// 2. SKILL resolver from the demo SKILL.md files.
const skillSources: Record<string, string> = {
  "tools/demo/hello_prompt": await fs.readFile("./skills/hello-prompt/SKILL.md", "utf-8"),
  "tools/demo/hello_tool":   await fs.readFile("./skills/hello-tool/SKILL.md", "utf-8"),
  "agents/demo/hello_agent": await fs.readFile("./skills/hello-agent/SKILL.md", "utf-8"),
};
const skillResolver = staticSkillResolver(skillSources);

// 3. ComposedToolStore + tool registry for `hello-tool`.
const composedStore = new ComposedToolStore();
const toolRegistry = buildExampleRegistry();

// 4. Build + connect the MCP server.
const server = createServer({
  tree,
  skillsDir: "./skills",
  templatesDir: new URL("../templates", import.meta.url).pathname,
  stateDir: "./.state",
  skillResolver,
  spawnSubagent: stubSpawnSubagent,
  toolRegistry,
  composedStore,
});

await server.connect(createStdioTransport());
```

## Caveats

- `hello-tool` requires you to run codegen against `hello-tool/SKILL.md` first;
  otherwise `skill_activate` will report "composed tool ... not in store".
- `hello-agent` calls into the stub SpawnSubagent which returns a canned
  ThoughtResult — replace with `makeLLMSpawnSubagent` (or your own
  implementation) for real reasoning.
- The `staticSkillResolver` helper is intended for demos / tests; production
  hosts should walk disk via `AggregatedSkillNodeProvider` (commit #6).
