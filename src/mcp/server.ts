// MCP server factory.
//
// Wires the per-subsystem dispatchers + tools into a single `McpServer`
// instance the host can connect to a transport.
//
// Optional dependencies pattern: tools that need a particular host
// dependency (spawnSubagent for spawn_agent, composedStore for tool-mode
// SKILL activation, etc.) are only registered when the dependency is
// supplied. Lets minimal hosts ship with just `skill_manage` /
// `skill_suggest` while richer hosts opt in to the full surface.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CapabilityTree } from "../capabilities/index.ts";
import { executeManageTool } from "../manage/index.ts";
import {
  type ComposedToolStore,
  type ExecuteToolFn,
} from "../codegen/index.ts";
import {
  executeSpawnAgent,
  type InterAgentBus,
  type SpawnContext,
  type SpawnLogger,
  type SpawnSubagent,
  type ToolCallbackRegistry,
} from "../dispatch/index.ts";
import {
  executeSkillActivate,
  executeSkillGenerate,
  executeSkillManage,
  executeSkillSuggest,
  type SkillResolverWithBody,
} from "../tools/index.ts";

// ── Public types ───────────────────────────────────────────────────

export interface CreateServerOptions {
  /** Display name shown to MCP clients. Defaults to "@acosmi/skill-agent-mcp". */
  name?: string;
  /** Display version. Defaults to the package version. */
  version?: string;

  // ── Required dependencies ───────────────────────────────────────
  /** Capability tree. Used by capability_manage + tree query tools. */
  tree: CapabilityTree;
  /** Filesystem root for the SKILL library. */
  skillsDir: string;
  /** Filesystem root for the bundled SKILL templates. */
  templatesDir: string;
  /** Filesystem root for composed-tool persistence. */
  stateDir: string;

  // ── Optional dependencies (toggles MCP tool registration) ──────
  /** Resolver — required for skill_activate + spawn_agent. */
  skillResolver?: SkillResolverWithBody;
  /** Spawn callback — required for agent-mode SKILLs. */
  spawnSubagent?: SpawnSubagent;
  /** Tool registry — required for tool-mode SKILLs with composed steps. */
  toolRegistry?: ToolCallbackRegistry;
  /** Composed-tool store — required for tool-mode SKILLs. */
  composedStore?: ComposedToolStore;
  /** Inter-agent bus — enables handoff二选一 routing in spawn_agent. */
  interAgentBus?: InterAgentBus;
  /** Optional structured logger forwarded to dispatchers + tools. */
  logger?: SpawnLogger;

  /**
   * Optional workspace root — when set, file-writing tools refuse
   * paths that resolve outside this directory (defense-in-depth
   * against directory traversal in client-supplied tree_id / skill_dir).
   */
  workspaceRoot?: string;
}

// ── Server factory ─────────────────────────────────────────────────

/**
 * Construct an `McpServer` with every applicable tool registered.
 *
 * Returns the server unstarted — call `await server.connect(transport)`
 * with a stdio or Streamable HTTP transport (factories ship in
 * ./transport.ts).
 */
export function createServer(options: CreateServerOptions): McpServer {
  const server = new McpServer({
    name: options.name ?? "@acosmi/skill-agent-mcp",
    version: options.version ?? "1.0.0",
  });

  registerCapabilityManage(server, options);
  registerTreeQueries(server, options);
  registerSkillSuggest(server, options);
  registerSkillGenerate(server, options);
  registerSkillManage(server, options);
  registerSkillActivate(server, options);
  registerSkillParse(server);
  registerSpawnAgent(server, options);

  return server;
}

// ── capability_manage (single MCP tool wrapping 13 actions) ────────

function registerCapabilityManage(
  server: McpServer,
  options: CreateServerOptions,
): void {
  server.registerTool(
    "capability_manage",
    {
      description:
        "Inspect, validate, diagnose, generate prompts for, and patch the capability tree. Wraps the 13-action executeManageTool dispatcher; pass the action name + per-action fields as a single JSON object via the `payload` field.",
      inputSchema: {
        payload: z
          .string()
          .describe(
            "JSON-encoded action payload (see executeManageTool for the per-action shape).",
          ),
      },
    },
    async ({ payload }) => {
      const text = executeManageTool(payload, options.tree);
      return { content: [{ type: "text", text }] };
    },
  );
}

// ── Tree query tools ───────────────────────────────────────────────

function registerTreeQueries(
  server: McpServer,
  options: CreateServerOptions,
): void {
  server.registerTool(
    "tree_lookup_tool",
    {
      description:
        "Look up the capability-tree node id + approval type for a tool name. Returns 'not found' when the tool is not registered.",
      inputSchema: {
        toolHint: z.string().describe("Tool name to look up."),
      },
    },
    async ({ toolHint }) => {
      // CapabilityTree exposes lookup via toRegistry / similar; we
      // walk the tree once for the lookup since it's an infrequent
      // MCP-tool call.
      const allTools = options.tree.toRegistry();
      const found = allTools.find((spec) => spec.toolName === toolHint);
      if (!found) {
        return {
          content: [
            { type: "text", text: `tool ${JSON.stringify(toolHint)} not found` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { id: found.id, runtimeOwner: found.runtimeOwner },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "tree_dump",
    {
      description:
        "Dump the entire capability tree as JSON (every node, every dimension). Useful for debugging or seeding clients with the full capability surface.",
      inputSchema: {},
    },
    async () => {
      const registry = options.tree.toRegistry();
      return {
        content: [
          { type: "text", text: JSON.stringify(registry, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "tree_list_tier",
    {
      description:
        "List every tool node available at or below a specific intent tier (greeting / question / task_light / task_write / task_delete / task_multimodal).",
      inputSchema: {
        tier: z.string().describe("Target tier name."),
      },
    },
    async ({ tier }) => {
      const tools = options.tree.toolsForTier(tier);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tools, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "tree_list_bindable",
    {
      description:
        "List every tool node that accepts SKILL.md frontmatter binding (skillBindable=true). Use this to pick targets for skill_generate + skill_manage update flows.",
      inputSchema: {},
    },
    async () => {
      const tools = options.tree.toRegistry();
      const bindable = tools.filter((t) => t.skillBindable);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              bindable.map((t) => ({
                id: t.id,
                toolName: t.toolName,
                runtimeOwner: t.runtimeOwner,
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

// ── Natural-language SKILL tools ────────────────────────────────────

function registerSkillSuggest(
  server: McpServer,
  options: CreateServerOptions,
): void {
  server.registerTool(
    "skill_suggest",
    {
      description:
        "Recommend a SKILL.md template based on a free-form description. Returns the recommended template name, alternatives, the template body, and customization hints.",
      inputSchema: {
        userRequest: z
          .string()
          .describe("Free-form description of what the SKILL should do."),
        preferredCapabilities: z
          .array(z.string())
          .optional()
          .describe(
            "Optional capability hints (tool names / categories) used to boost confidence.",
          ),
      },
    },
    async ({ userRequest, preferredCapabilities }) => {
      const out = await executeSkillSuggest(
        {
          userRequest,
          ...(preferredCapabilities !== undefined && {
            preferredCapabilities,
          }),
        },
        { templatesDir: options.templatesDir },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      };
    },
  );
}

function registerSkillGenerate(
  server: McpServer,
  options: CreateServerOptions,
): void {
  server.registerTool(
    "skill_generate",
    {
      description:
        "Validate-then-save a SKILL.md draft authored by the client LLM. Returns parse / validation errors when the draft is malformed.",
      inputSchema: {
        skillMdContent: z.string().describe("Full SKILL.md source."),
        baseTemplate: z
          .enum(["tool", "operations", "agent", "subsystem", "internal"])
          .optional(),
        skillDir: z
          .string()
          .describe("Filesystem directory under which to persist."),
        noOverwrite: z.boolean().optional(),
      },
    },
    async ({ skillMdContent, baseTemplate, skillDir, noOverwrite }) => {
      const out = await executeSkillGenerate(
        {
          skillMdContent,
          ...(baseTemplate !== undefined && { baseTemplate }),
          skillDir,
          ...(noOverwrite !== undefined && { noOverwrite }),
        },
        {
          ...(options.workspaceRoot !== undefined && {
            workspaceRoot: options.workspaceRoot,
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      };
    },
  );
}

function registerSkillManage(
  server: McpServer,
  options: CreateServerOptions,
): void {
  server.registerTool(
    "skill_manage",
    {
      description:
        "List / get / update / delete / export SKILL.md files in the host's skills directory.",
      inputSchema: {
        action: z.enum(["list", "get", "update", "delete", "export"]),
        treeId: z.string().optional(),
        skillMdContent: z.string().optional(),
        treeGroupFilter: z.string().optional(),
      },
    },
    async ({ action, treeId, skillMdContent, treeGroupFilter }) => {
      const out = await executeSkillManage(
        {
          action,
          ...(treeId !== undefined && { treeId }),
          ...(skillMdContent !== undefined && { skillMdContent }),
          ...(treeGroupFilter !== undefined && { treeGroupFilter }),
        },
        {
          skillsDir: options.skillsDir,
          ...(options.workspaceRoot !== undefined && {
            workspaceRoot: options.workspaceRoot,
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      };
    },
  );
}

function registerSkillActivate(
  server: McpServer,
  options: CreateServerOptions,
): void {
  if (!options.skillResolver) return;

  server.registerTool(
    "skill_activate",
    {
      description:
        "Invoke a SKILL through the three-mode dispatcher to verify runtime behaviour without restarting the server. Routes to prompt / tool / agent dispatcher based on the SKILL's resolved skill_mode.",
      inputSchema: {
        skillName: z.string(),
        modeInput: z
          .object({
            prompt: z.object({ query: z.string().optional() }).optional(),
            tool: z.record(z.string(), z.unknown()).optional(),
            agent: z
              .object({
                task: z.string().optional(),
                timeoutMs: z.number().int().positive().optional(),
              })
              .optional(),
          })
          .optional(),
      },
    },
    async ({ skillName, modeInput }) => {
      const dispatchContext = buildDispatchContext(options);
      const out = await executeSkillActivate(
        {
          skillName,
          ...(modeInput !== undefined && { modeInput }),
        },
        {
          resolver: options.skillResolver!,
          dispatch: dispatchContext,
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      };
    },
  );
}

// ── SKILL parse + validate (folded into one MCP tool with action) ──

function registerSkillParse(server: McpServer): void {
  server.registerTool(
    "skill_parse",
    {
      description:
        "Parse a SKILL.md frontmatter + body and report structured metadata (or parse errors). Includes the seven extended agent_config fields (triggers / sop / review_gate / stall / max_retry / escalation_chain / snapshot_rollback).",
      inputSchema: {
        skillMdContent: z.string(),
        validate: z
          .boolean()
          .optional()
          .describe(
            "When true, also run validateSkillMode and surface the structured error.",
          ),
      },
    },
    async ({ skillMdContent, validate }) => {
      const { parseExtendedSkillFrontmatter, validateSkillMode } = await import(
        "../skill/index.ts"
      );
      const parsed = parseExtendedSkillFrontmatter(skillMdContent);
      const result: Record<string, unknown> = {
        ok: !!parsed,
        ...(parsed !== undefined && {
          metadata: parsed.metadata,
          frontmatter: parsed.frontmatter,
        }),
      };
      if (validate && parsed?.metadata) {
        const error = validateSkillMode(parsed.metadata);
        result["validateError"] = error;
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

// ── Agent-mode SKILL spawn ─────────────────────────────────────────

function registerSpawnAgent(
  server: McpServer,
  options: CreateServerOptions,
): void {
  if (!options.skillResolver || !options.spawnSubagent) return;

  server.registerTool(
    "spawn_agent",
    {
      description:
        "Spawn a sub-agent driven by a skill_mode=agent SKILL. The host's SpawnSubagent callback owns the actual sub-agent execution; this tool walks the SKILL.md, applies permission monotone-decay + handoff二选一 routing, and returns the formatted Agent Result.",
      inputSchema: {
        skillName: z.string(),
        task: z.string(),
        timeoutMs: z.number().int().positive().optional(),
        handoffReason: z.string().optional(),
        handoffContext: z.unknown().optional(),
      },
    },
    async ({
      skillName,
      task,
      timeoutMs,
      handoffReason,
      handoffContext,
    }) => {
      const ctx = buildSpawnContext(options);
      if (!ctx) {
        return {
          content: [
            {
              type: "text",
              text: "[spawn_agent] server is missing skillResolver or spawnSubagent",
            },
          ],
        };
      }
      const text = await executeSpawnAgent(
        {
          skillName,
          task,
          ...(timeoutMs !== undefined && { timeoutMs }),
          ...(handoffReason !== undefined && { handoffReason }),
          ...(handoffContext !== undefined && { handoffContext }),
        },
        ctx,
      );
      return { content: [{ type: "text", text }] };
    },
  );
}

// ── Internal context builders ──────────────────────────────────────

function buildSpawnContext(options: CreateServerOptions): SpawnContext | undefined {
  if (!options.skillResolver || !options.spawnSubagent) return undefined;
  return {
    parentSessionId: "mcp-server", // host typically overrides per-call
    parentToolNames: collectToolNames(options),
    skillResolver: options.skillResolver,
    spawnSubagent: options.spawnSubagent,
    ...(options.interAgentBus !== undefined && {
      interAgentBus: options.interAgentBus,
    }),
    ...(options.logger !== undefined && { logger: options.logger }),
  };
}

function buildDispatchContext(
  options: CreateServerOptions,
): {
  agent?: SpawnContext;
  tool?: { registry: ToolCallbackRegistry; composedStore: ComposedToolStore };
} {
  const agent = buildSpawnContext(options);
  const out: ReturnType<typeof buildDispatchContext> = {};
  if (agent) out.agent = agent;
  if (options.toolRegistry && options.composedStore) {
    out.tool = {
      registry: options.toolRegistry,
      composedStore: options.composedStore,
    };
  }
  return out;
}

function collectToolNames(options: CreateServerOptions): string[] {
  // Prefer the registry when available so the parent set reflects what
  // the host's ExecuteToolFn can actually run; otherwise fall back to
  // the static tree.
  if (options.toolRegistry) {
    return options.toolRegistry.names();
  }
  return options.tree.allStaticTools();
}

// Suppress unused warning for ExecuteToolFn import; kept for the
// dispatch wiring that hosts replicate when constructing their own
// SpawnContext / ToolModeContext.
const _executeToolFnTypeAnchor: ExecuteToolFn | undefined = undefined;
void _executeToolFnTypeAnchor;
