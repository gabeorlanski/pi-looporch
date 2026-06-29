import { AsyncLocalStorage } from "node:async_hooks";
import type { ReasoningLevel, RunWorkflowOptions, WorkflowSnapshot } from "./types.ts";

/** A pipeline stage transforms one item and may be a function or object with a run method. */
export type PipelineStage<T> = ((item: T, index: number) => Promise<T> | T) | { run: (item: T, index: number) => Promise<T> | T };

/** Options for no-tool child-agent coercion of text or context into schema-valid JSON. */
export interface CoerceOptions {
  schema: unknown;
  prompt: string;
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
  maxAttempts?: number;
}

/** Options for splitting source context, mapping each item through agents, and reducing the mapped outputs. */
export interface MapReduceOptions extends Record<string, unknown> {
  inputPrompt: string;
  mapPrompt: string;
  reducePrompt: string;
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
  maxAttempts?: number;
}

/** Options for adversarial criterion voters followed by a reducer agent. */
export interface VerifierOptions extends Record<string, unknown> {
  criteria: unknown;
  criteriaPrompt: string;
  reducePrompt: string;
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
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
  emit: () => void;
}

/** Context passed to a primitive when binding its globals into a workflow sandbox. */
export interface WorkflowPrimitiveContext {
  runtime: ActiveWorkflowRuntime;
  workflowDir: string;
}

/** Runtime primitive contract for exposing one or more sandbox globals. */
export interface WorkflowPrimitive<TGlobals extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  globals: (context: WorkflowPrimitiveContext) => TGlobals;
}

/** Async-local identifier that associates nested child-agent launches with the active fan-out. */
export const fanOutScope = new AsyncLocalStorage<number>();
