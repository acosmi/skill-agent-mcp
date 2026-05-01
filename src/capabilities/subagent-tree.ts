// Sub-agent capability sub-tree registry. Translated from
// crabclaw/backend/internal/agents/capabilities/capability_tree.go
// (sub-agent registry section).
//
// Sub-agent subsystems (e.g. media, coder) implement SubAgentToolProvider
// and register with this module to expose their working tools to the LLM.

import type { SubAgentToolDef } from "./types.ts";

/**
 * Implemented by sub-agent subsystems (media, coder, etc.) to register
 * their working tools in the capability tree.
 *
 * - registerSubAgentTree(provider) wires the provider into the registry.
 * - subAgentTreeFor(agentType) returns the registered provider or undefined.
 * - The runner reads toolDefs() to inject LLM tools at session start.
 * - The dispatcher calls executeTool() to dispatch tool calls.
 */
export interface SubAgentToolProvider {
  /** Sub-agent type identifier (e.g. "media"). */
  agentType(): string;

  /**
   * Capability-tree group node ID for the sub-tree (e.g.
   * "subagent_trees/media"). Tools registered here belong to this group.
   */
  subTreeGroupId(): string;

  /** LLM tool definitions to inject into the sub-agent's tool list. */
  toolDefs(): SubAgentToolDef[];

  /**
   * Dispatches a tool call to the sub-agent's executor. Returns the
   * tool's stringified output (LLM-facing).
   */
  executeTool(name: string, inputJson: unknown): Promise<string>;
}

const _registry = new Map<string, SubAgentToolProvider>();

/** Register a SubAgentToolProvider for its declared agent type. */
export function registerSubAgentTree(provider: SubAgentToolProvider): void {
  _registry.set(provider.agentType(), provider);
}

/**
 * Returns the registered provider for the given agent type, or undefined
 * (e.g. main agent or unknown type).
 */
export function subAgentTreeFor(
  agentType: string,
): SubAgentToolProvider | undefined {
  return _registry.get(agentType);
}

/** Test-only: clear the registry. */
export function resetSubAgentTreeRegistryForTesting(): void {
  _registry.clear();
}
