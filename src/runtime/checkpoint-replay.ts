/** Restores and persists successful model calls for deterministic workflow replay. */
import type { ActiveWorkflowRuntime } from "./context.ts";
import { appendRunMessage } from "./messages.ts";
import { cloneSerializable } from "./serialization.ts";
import type { WorkflowAgentSnapshot, WorkflowLLMSnapshot } from "./types.ts";

type ReplayWorkflowCheckpointOptions = {
  runtime: ActiveWorkflowRuntime;
  executionId: string;
  requestHash: string;
} & ({ kind: "agent"; label: string; fanOutId: number | undefined } | { kind: "llm" });

/** Looks up and records one matching successful checkpoint in the current runtime snapshot. */
export async function replayWorkflowCheckpoint(options: ReplayWorkflowCheckpointOptions): Promise<{ result: unknown } | undefined> {
  const checkpoint = await options.runtime.options.checkpoints?.get(options.kind, options.executionId, options.requestHash);
  const phase = options.runtime.snapshot.phases.at(-1);
  let phaseIndex: number;
  let message: string;
  let agentId: number | undefined;
  if (options.kind === "agent") {
    if (checkpoint?.kind !== "agent") return undefined;
    agentId = options.runtime.snapshot.agents.length + 1;
    phaseIndex = options.runtime.snapshot.phases.length;
    message = options.label;
    const agent: WorkflowAgentSnapshot = {
      ...checkpoint.snapshot,
      id: agentId,
      label: options.label,
      phaseIndex,
      ...(phase ? { phase } : {}),
      fanOutId: options.fanOutId,
      status: "done",
    };
    if (!phase) delete agent.phase;
    options.runtime.snapshot.agents.push(agent);
  } else {
    if (checkpoint?.kind !== "llm") return undefined;
    const id = options.runtime.snapshot.llms.length + 1;
    phaseIndex = options.runtime.snapshot.phases.length;
    message = `LLM #${String(id)}`;
    const llm: WorkflowLLMSnapshot = {
      ...checkpoint.snapshot,
      id,
      phaseIndex,
      ...(phase ? { phase } : {}),
      status: "done",
    };
    if (!phase) delete llm.phase;
    options.runtime.snapshot.llms.push(llm);
  }
  for (const state of ["started", "done"] as const) {
    appendRunMessage(options.runtime, {
      phaseIndex,
      ...(phase ? { phase } : {}),
      ...(agentId === undefined ? {} : { agentId, agentLabel: message }),
      level: "info",
      message: `${message} ${state}`,
    });
  }
  options.runtime.emit();
  return { result: cloneSerializable(checkpoint.result) };
}
