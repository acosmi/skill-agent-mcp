// Example ToolCallbackRegistry — register `echo` + `uppercase` for the
// `hello-tool` SKILL demo.
//
// Hosts are expected to assemble their own registry with whatever
// tools they want to expose. The InMemoryToolCallbackRegistry default
// implementation is fine for most cases.

import { InMemoryToolCallbackRegistry } from "@acosmi/skill-agent-mcp/dispatch";

export function buildExampleRegistry(): InMemoryToolCallbackRegistry {
  const registry = new InMemoryToolCallbackRegistry();

  registry.register("echo", async (input: Record<string, unknown>) => {
    const text = typeof input["text"] === "string" ? input["text"] : "";
    return text;
  });

  registry.register("uppercase", async (input: Record<string, unknown>) => {
    const text = typeof input["text"] === "string" ? input["text"] : "";
    return text.toUpperCase();
  });

  // For hello-agent: a no-op read_file that returns a fixed string.
  // Real hosts would wire node:fs/promises.readFile or sandbox-aware equivalents.
  registry.register("read_file", async (input: Record<string, unknown>) => {
    const path = typeof input["path"] === "string" ? input["path"] : "<unknown>";
    return `(stub) contents of ${path}\nline 2\nline 3`;
  });

  return registry;
}
