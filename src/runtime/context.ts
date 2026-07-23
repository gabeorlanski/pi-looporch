/** Provides context behavior. */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ReasoningLevel, RunWorkflowOptions, WorkflowSnapshot } from "./types.ts";

/** A pipeline stage transforms one item. */
export type PipelineStage<T> = (item: T, index: number) => Promise<T> | T;

/** Options for splitting source context, mapping each item through agents, and reducing the mapped outputs. */
export interface MapReduceOptions extends Record<string, unknown> {
  inputPrompt: string;
  mapPrompt: string;
  reducePrompt: string;
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
  extensions?: string[];
  tools?: string[];
}

/** Options for adversarial criterion voters followed by a reducer agent. */
export interface VerifierOptions extends Record<string, unknown> {
  criteria: unknown;
  criteriaPrompt: string;
  reducePrompt: string;
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
  extensions?: string[];
  tools?: string[];
}

/** One verifier voting criterion and the number of voters to launch for it. */
export interface VerifierCriterion extends Record<string, unknown> {
  name: string;
  description: string;
  guidelines: string;
  reasoning: string;
  voters: number;
}

/** Queue abstraction that bounds concurrent child-agent launches and releases slots explicitly. */
export interface AgentLaunchQueue {
  acquire: (signal: AbortSignal | undefined) => Promise<() => void>;
}

/** Mutable workflow execution state shared by runtime primitives during one run. */
export interface ActiveWorkflowRuntime {
  options: RunWorkflowOptions;
  snapshot: WorkflowSnapshot;
  agentLaunchQueue: AgentLaunchQueue;
  executionCounters: Map<string, number>;
  emit: () => void;
}

/** Context passed to a primitive when binding its globals into a workflow sandbox. */
export interface WorkflowPrimitiveContext {
  runtime: ActiveWorkflowRuntime;
  workflowDir: string;
}

/** Author-facing documentation for one sandbox global exposed by a runtime primitive. */
export interface WorkflowPrimitiveGlobalDoc {
  name: string;
  signature: string;
  summary: string;
}

/** Runtime primitive contract for exposing one or more sandbox globals. */
export interface WorkflowPrimitive<TGlobals extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  docs: readonly WorkflowPrimitiveGlobalDoc[];
  globals: (context: WorkflowPrimitiveContext) => TGlobals;
}

/** Async-local identifier that associates nested child-agent launches with the active fan-out. */
export const fanOutScope = new AsyncLocalStorage<number>();

/** Async-local deterministic execution scope used for resumable model-call identities. */
export const executionScope = new AsyncLocalStorage<string>();

/** Assigns the next deterministic execution identity within the current workflow scope. */
export function nextExecutionId(
  runtime: ActiveWorkflowRuntime,
  kind: "agent" | "llm" | "parallel" | "pipeline",
  identityHash?: string,
): string {
  const scope = executionScope.getStore() ?? "root";
  const counter = identityHash === undefined ? scope : `${scope}/${kind}/${identityHash}`;
  const ordinal = (runtime.executionCounters.get(counter) ?? 0) + 1;
  runtime.executionCounters.set(counter, ordinal);
  return identityHash === undefined
    ? `${scope}/${String(ordinal).padStart(4, "0")}-${kind}`
    : `${scope}/${kind}-${identityHash}-${String(ordinal).padStart(4, "0")}`;
}
