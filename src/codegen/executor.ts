// ComposedSubsystem — Skill-to-Tool execution engine + template engine.
//
// Translated from crabclaw composed/executor.go (300 LoC Go → ~340 TS).
// All public-facing semantics preserved 1:1:
//
//   - Execution variables: `{ input: <userInput>, <step.outputAs>: <result>, item: <loopElem> }`
//   - Template engine: `{{path.to.value}}` (pure variable reference returns
//     the raw value, mixed string interpolation joins via `String(value)`).
//   - On-error: "abort" (default) → return immediately; "skip" → record
//     the error and continue; "retry" → re-run up to 2 extra times.
//   - Loop: `loop_over: "{{ items }}"` iterates the resolved array, binding
//     each element to `item` for the inner template.
//
// Deliberate divergence from Go:
//   - context.Context → AbortSignal. The Go side polls `ctx.Done()` between
//     steps; we check `signal?.aborted` at the same boundaries.
//   - slog.* logging dropped — observation goes through the formatted result
//     string + per-step `StepResult.error`.
//   - Output truncation kept at 2000 chars to keep MCP tool replies bounded.

import {
  type CompiledStep,
  type ComposedToolDef,
  type StepResult,
} from "./types.ts";
import { type ComposedToolStore } from "./store.ts";

// ── Public types ───────────────────────────────────────────────────

/**
 * Underlying single-tool executor. Composed steps invoke this for the
 * `tool` they reference. Implementations should treat `inputJson` as
 * already-validated against the tool's input schema.
 */
export interface ExecuteToolFn {
  (
    toolName: string,
    inputJson: string,
    signal?: AbortSignal,
  ): Promise<string>;
}

/** Output of `getToolDef` lookup. */
export interface ComposedToolDefSummary {
  inputSchema: unknown;
  description: string;
}

/**
 * Composed-tool execution engine. Construct one per (store, executor)
 * pair; safe to share across MCP tool calls — there is no per-call
 * mutable state on the subsystem itself, only on the variable map
 * created inside `executeTool`.
 */
export class ComposedSubsystem {
  constructor(
    private readonly store: ComposedToolStore,
    private readonly executeToolFn: ExecuteToolFn,
  ) {}

  /** Names of all registered composed tools. */
  toolNames(): string[] {
    return this.store.names();
  }

  /** Lookup a composed tool's input schema + description. */
  getToolDef(name: string): ComposedToolDefSummary | undefined {
    const def = this.store.get(name);
    if (!def) return undefined;
    return {
      inputSchema: def.inputSchema,
      description: def.description,
    };
  }

  /**
   * Execute a composed tool by name. `inputJson` is the user-supplied
   * input as a JSON string (matches the MCP tool surface).
   *
   * Returns a markdown-formatted string suitable for an MCP `text`
   * content reply. Errors during step execution are surfaced inside
   * the returned string per the per-step `on_error` policy; only an
   * unparseable user input or "abort" failure causes an early return.
   */
  async executeTool(
    name: string,
    inputJson: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const def = this.store.get(name);
    if (!def) {
      return `[composed tool ${JSON.stringify(name)} not registered]`;
    }

    let userInput: Record<string, unknown>;
    try {
      const parsed = JSON.parse(inputJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return `[composed tool ${JSON.stringify(name)} input must be a JSON object]`;
      }
      userInput = parsed as Record<string, unknown>;
    } catch (err) {
      return `[composed tool ${JSON.stringify(name)} input parse failed: ${errMsg(err)}]`;
    }

    const varMap: Record<string, unknown> = { input: userInput };
    const results: StepResult[] = [];

    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i]!;

      if (signal?.aborted) {
        return formatComposedResult(
          name,
          results,
          `aborted: ${signal.reason ?? "AbortSignal triggered"}`,
        );
      }

      // 1. Loop step (resolved before template substitution because
      //    `{{item}}` is only valid inside the loop body).
      if (step.loopOver) {
        const items = resolveVar(step.loopOver, varMap);
        let loopResults: unknown[];
        try {
          loopResults = await this.executeLoop(step, items, varMap, signal);
        } catch (err) {
          const message = errMsg(err);
          if (step.onError === "skip") {
            results.push({ action: step.action, error: message });
            continue;
          }
          return `[step ${i + 1}/${def.steps.length} ${step.action} ${message}]`;
        }
        if (step.outputAs) {
          varMap[step.outputAs] = loopResults;
        }
        results.push({ action: step.action, output: loopResults });
        continue;
      }

      // 2. Template substitution.
      let stepInput: Record<string, unknown>;
      try {
        stepInput = resolveInputMap(step.inputMap, varMap);
      } catch (err) {
        const message = `input resolve failed: ${errMsg(err)}`;
        if (step.onError === "skip") {
          results.push({ action: step.action, error: message });
          continue;
        }
        return `[step ${i + 1}/${def.steps.length} ${step.action} ${message}]`;
      }

      // 3. Execute underlying tool.
      const stepInputJson = JSON.stringify(stepInput);
      let output: string;
      try {
        output = await this.runStepWithRetry(step, stepInputJson, signal);
      } catch (err) {
        const message = errMsg(err);
        switch (step.onError) {
          case "skip":
            results.push({ action: step.action, error: message });
            continue;
          case "retry":
            return `[step ${i + 1}/${def.steps.length} ${step.action} retry exhausted: ${message}]`;
          default:
            return `[step ${i + 1}/${def.steps.length} ${step.action} failed: ${message}]`;
        }
      }

      // 4. Bind output to variable map.
      if (step.outputAs) {
        varMap[step.outputAs] = output;
      }
      results.push({ action: step.action, output });
    }

    return formatComposedResult(name, results, "");
  }

  /**
   * Run the underlying tool, applying `on_error: retry` semantics.
   * On "retry" we re-attempt up to 2 extra times after the initial
   * call; on success we return early. Other policies bubble the
   * thrown error to the caller.
   */
  private async runStepWithRetry(
    step: CompiledStep,
    stepInputJson: string,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      return await this.executeToolFn(step.tool, stepInputJson, signal);
    } catch (err) {
      if (step.onError !== "retry") throw err;
      let lastErr: unknown = err;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted) throw new Error("aborted during retry");
        try {
          return await this.executeToolFn(step.tool, stepInputJson, signal);
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    }
  }

  /**
   * Iterate `items` (array) running `step` once per element with `item`
   * bound in the variable map. `on_error: skip` swallows individual
   * iteration errors; anything else aborts the whole loop and returns
   * the partial result list.
   */
  private async executeLoop(
    step: CompiledStep,
    items: unknown,
    varMap: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown[]> {
    const loopItems = coerceLoopItems(items);
    const loopResults: unknown[] = [];
    for (const item of loopItems) {
      if (signal?.aborted) return loopResults;
      const loopVarMap: Record<string, unknown> = { ...varMap, item };
      let stepInput: Record<string, unknown>;
      try {
        stepInput = resolveInputMap(step.inputMap, loopVarMap);
      } catch (err) {
        loopResults.push({ error: errMsg(err) });
        if (step.onError === "skip") continue;
        return loopResults;
      }
      const stepInputJson = JSON.stringify(stepInput);
      try {
        const output = await this.executeToolFn(
          step.tool,
          stepInputJson,
          signal,
        );
        loopResults.push(output);
      } catch (err) {
        loopResults.push({ error: errMsg(err) });
        if (step.onError === "skip") continue;
        return loopResults;
      }
    }
    return loopResults;
  }
}

// ── Template engine ────────────────────────────────────────────────

const TEMPLATE_VAR_RE = /\{\{(.+?)\}\}/g;

/**
 * Resolve every value in `inputMap` against `vars`, returning a fresh
 * object suitable for JSON.stringify into the underlying tool's input.
 */
export function resolveInputMap(
  inputMap: Record<string, string>,
  vars: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, tmpl] of Object.entries(inputMap)) {
    try {
      result[k] = resolveTemplate(tmpl, vars);
    } catch (err) {
      throw new Error(`field ${JSON.stringify(k)}: ${errMsg(err)}`);
    }
  }
  return result;
}

/**
 * Resolve a template string. Supports two forms:
 *   - Pure variable reference (`{{path.to.value}}`) — returns the raw
 *     value, preserving its type (object / array / number / etc).
 *   - Mixed interpolation (`prefix {{a}} infix {{b}} suffix`) — returns
 *     a string with each marker replaced by `String(value)`.
 */
export function resolveTemplate(
  tmpl: string,
  vars: Record<string, unknown>,
): unknown {
  const trimmed = tmpl.trim();
  if (
    trimmed.startsWith("{{") &&
    trimmed.endsWith("}}") &&
    countOccurrences(trimmed, "{{") === 1
  ) {
    const path = trimmed.slice(2, trimmed.length - 2).trim();
    return lookupPath(path, vars);
  }

  let lastErr: Error | undefined;
  const resolved = tmpl.replace(TEMPLATE_VAR_RE, (match) => {
    const path = match.slice(2, match.length - 2).trim();
    try {
      const val = lookupPath(path, vars);
      return formatScalar(val);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      return match;
    }
  });
  if (lastErr) throw lastErr;
  return resolved;
}

/**
 * Resolve a "{{path}}" reference (used by `loop_over`). Falls back to
 * the literal string when the input is not in `{{...}}` form.
 */
export function resolveVar(
  ref: string,
  vars: Record<string, unknown>,
): unknown {
  const trimmed = ref.trim();
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    const path = trimmed.slice(2, trimmed.length - 2).trim();
    try {
      return lookupPath(path, vars);
    } catch {
      return undefined;
    }
  }
  return ref;
}

/**
 * Walk a dot-separated path through nested objects.
 *
 * Throws when an intermediate node is missing or not indexable
 * (matches the Go `lookupPath` error semantics).
 */
export function lookupPath(
  path: string,
  vars: Record<string, unknown>,
): unknown {
  const parts = path.split(".");
  let current: unknown = vars;
  for (const part of parts) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      throw new Error(
        `path ${JSON.stringify(path)}: cannot index into ${typeof current} at ${JSON.stringify(part)}`,
      );
    }
    const obj = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(obj, part)) {
      throw new Error(
        `path ${JSON.stringify(path)}: key ${JSON.stringify(part)} not found`,
      );
    }
    current = obj[part];
  }
  return current;
}

// ── Result formatting ──────────────────────────────────────────────

/** Markdown-format the per-step results into a single response body. */
export function formatComposedResult(
  toolName: string,
  results: readonly StepResult[],
  abortMsg: string,
): string {
  let out = `## Composed tool ${toolName} result\n\n`;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.error) {
      out += `### Step ${i + 1}: ${r.action} [error]\n${r.error}\n\n`;
    } else {
      let output = formatScalar(r.output);
      if (output.length > 2000) {
        output = output.slice(0, 2000) + "...(truncated)";
      }
      out += `### Step ${i + 1}: ${r.action} [done]\n${output}\n\n`;
    }
  }
  if (abortMsg) {
    out += `**Aborted**: ${abortMsg}\n`;
  }
  return out;
}

// ── Helpers ────────────────────────────────────────────────────────

function coerceLoopItems(items: unknown): unknown[] {
  if (Array.isArray(items)) return items;
  const got = items === null ? "null" : typeof items;
  throw new Error(`loop_over expects array, got ${got}`);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
