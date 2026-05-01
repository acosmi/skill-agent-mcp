// CLI entry point.
//
// Boots the MCP server with a stdio (default) or Streamable HTTP
// transport, optionally seeding a CapabilityTree from a JSON file.
//
// The CLI is deliberately minimal — full host integrations (auth,
// custom toolRegistry, custom SkillSourceResolver, custom logger)
// belong in user-supplied programs that import @acosmi/skill-agent-mcp
// directly. The CLI exists so users can validate their SKILL library
// over MCP without writing a host wrapper first.

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { CapabilityTree, setTreeBuilder } from "../capabilities/index.ts";
import { ComposedToolStore, loadComposedToolStore } from "../codegen/index.ts";
import { createServer, createStdioTransport, createStreamableHttpTransport } from "./../mcp/index.ts";
import { type TransportMode } from "../mcp/transport.ts";

interface Args {
  transport: TransportMode;
  skillsDir: string;
  templatesDir?: string;
  stateDir: string;
  treeFile?: string;
  port?: number;
  host?: string;
  workspaceRoot?: string;
  help: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = {
    transport: "stdio",
    skillsDir: process.cwd(),
    stateDir: defaultStateDir(),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--transport":
        out.transport = argv[++i] === "http" ? "http" : "stdio";
        break;
      case "--skills-dir":
        out.skillsDir = path.resolve(argv[++i] ?? out.skillsDir);
        break;
      case "--templates-dir":
        out.templatesDir = path.resolve(argv[++i] ?? "");
        break;
      case "--state-dir":
        out.stateDir = path.resolve(argv[++i] ?? out.stateDir);
        break;
      case "--tree-file":
        out.treeFile = path.resolve(argv[++i] ?? "");
        break;
      case "--workspace-root":
        out.workspaceRoot = path.resolve(argv[++i] ?? "");
        break;
      case "--port":
        out.port = Number.parseInt(argv[++i] ?? "0", 10) || undefined;
        break;
      case "--host":
        out.host = argv[++i];
        break;
    }
  }
  return out;
}

function defaultStateDir(): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".";
  return path.join(home, ".acosmi-skill-agent-mcp", "state");
}

function defaultTemplatesDir(): string {
  // Resolve relative to the package root via this file's URL.
  const here = fileURLToPath(import.meta.url);
  // src/cli/main.ts → src/cli → src → <pkg-root>
  return path.resolve(path.dirname(here), "..", "..", "templates");
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage: acosmi-skill-agent-mcp [options]",
      "",
      "Options:",
      "  --transport <stdio|http>     Transport (default: stdio)",
      "  --skills-dir <path>          SKILL library root (default: cwd)",
      "  --templates-dir <path>       SKILL templates root (default: <pkg>/templates)",
      "  --state-dir <path>           Persistence root (default: ~/.acosmi-skill-agent-mcp/state)",
      "  --tree-file <path>           CapabilityTree JSON to seed (optional)",
      "  --workspace-root <path>      Restrict file writes to this root (optional)",
      "  --port <n>                   HTTP listener port (default: 3030)",
      "  --host <addr>                HTTP listener host (default: 127.0.0.1)",
      "  -h, --help                   Show this help",
    ].join("\n"),
  );
}

async function loadOrEmptyTree(treeFile: string | undefined): Promise<CapabilityTree> {
  const tree = new CapabilityTree();
  if (!treeFile) return tree;
  const fs = await import("node:fs/promises");
  const data = await fs.readFile(treeFile, "utf-8");
  const parsed = JSON.parse(data);
  // Use registerNodes for bulk re-hydration when the JSON matches the
  // toRegistry() output shape; otherwise fall through and let the user
  // wire it themselves.
  if (Array.isArray(parsed)) {
    for (const node of parsed) {
      try {
        tree.addNode(node);
      } catch {
        // Best-effort: skip malformed entries with a warning.
        // eslint-disable-next-line no-console
        console.warn(`[cli] skipped invalid tree node: ${JSON.stringify(node).slice(0, 80)}`);
      }
    }
  }
  return tree;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const tree = await loadOrEmptyTree(args.treeFile);
  setTreeBuilder(() => tree);

  const templatesDir = args.templatesDir ?? defaultTemplatesDir();

  const composedStore = await loadStore(args.stateDir);

  const server = createServer({
    tree,
    skillsDir: args.skillsDir,
    templatesDir,
    stateDir: args.stateDir,
    composedStore,
    ...(args.workspaceRoot !== undefined && { workspaceRoot: args.workspaceRoot }),
  });

  if (args.transport === "http") {
    const { transport, host, port } = createStreamableHttpTransport({
      ...(args.port !== undefined && { port: args.port }),
      ...(args.host !== undefined && { host: args.host }),
    });
    await server.connect(transport);
    // eslint-disable-next-line no-console
    console.log(`[acosmi-skill-agent-mcp] streamable HTTP transport ready at http://${host}:${port}/mcp`);
    return;
  }

  await server.connect(createStdioTransport());
  // stdio transport keeps the process alive via stdin; no log line because
  // it would corrupt the JSON-RPC stream on stdout.
}

async function loadStore(stateDir: string): Promise<ComposedToolStore> {
  const result = await loadComposedToolStore(stateDir);
  if (result.error) {
    // eslint-disable-next-line no-console
    console.warn(`[cli] composed-tool store load warning: ${result.error.message}`);
  }
  return result.store;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[acosmi-skill-agent-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
