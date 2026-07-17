/** Provides workflow inspector model behavior. */
import { workflowCalls } from "../runtime/calls.ts";
import type { WorkflowAgentSnapshot, WorkflowCost, WorkflowLLMSnapshot, WorkflowSnapshot, WorkflowSnapshotCall } from "../runtime/types.ts";
import { workflowUsageTotals } from "../runtime/usage.ts";

type WorkflowStatus = "running" | "done" | "error";
type PhaseStatus = "done" | "running" | "pending" | "error";
type CallStatus = "completed" | "running" | "failed";

export type WorkflowUiCall = {
  id: number;
  displayName: string;
  model: string;
  status: CallStatus;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  cost: WorkflowCost;
  durationSeconds: number;
  detailLines: string[];
  promptPath?: string;
  outputPath?: string;
  error?: string;
} & ({ kind: "agent"; toolCalls: number; steps: number; activityPath?: string; message?: string } | { kind: "llm" });

export interface WorkflowUiPhase {
  index: number;
  name: string;
  detail?: string;
  status: PhaseStatus;
  callsDone: number;
  callsTotal: number;
  calls: WorkflowUiCall[];
}

interface WorkflowUiWorkflow {
  name: string;
  subtitle: string;
  status: WorkflowStatus;
  agentsDone: number;
  agentsTotal: number;
  llmsDone: number;
  llmsTotal: number;
  elapsed: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  tokensTotal: number;
  cost: WorkflowCost;
  phases: WorkflowUiPhase[];
}

/** Provides the WorkflowInspectorModel class contract. */
export class WorkflowInspectorModel {
  private readonly startedAt: number;
  private snapshot: WorkflowSnapshot;
  tick = 0;

  constructor(
    snapshot: WorkflowSnapshot,
    private readonly now: () => number = Date.now,
  ) {
    this.snapshot = snapshot;
    this.startedAt = now();
  }

  update(snapshot: WorkflowSnapshot): void {
    this.snapshot = snapshot;
  }

  advanceFrame(): void {
    this.tick++;
  }

  workflow(): WorkflowUiWorkflow {
    const calls = workflowCalls(this.snapshot);
    const phases = workflowPhases(this.snapshot, calls, this.now());
    const agents = calls.filter((call) => call.kind === "agent");
    const llms = calls.filter((call) => call.kind === "llm");
    const usage = workflowUsageTotals(this.snapshot);
    return {
      name: `workflow ${this.snapshot.workflowName}`,
      subtitle: this.snapshot.description,
      status: this.snapshot.status,
      agentsDone: agents.filter((agent) => agent.status !== "running").length,
      agentsTotal: agents.length,
      llmsDone: llms.filter((llm) => llm.status !== "running").length,
      llmsTotal: llms.length,
      elapsed: Math.max(0, Math.floor((this.now() - this.startedAt) / 1000)),
      ...usage,
      phases,
    };
  }
}

function workflowPhases(snapshot: WorkflowSnapshot, calls: readonly WorkflowSnapshotCall[], now: number): WorkflowUiPhase[] {
  const setup = setupPhase(snapshot, calls, now);
  const plannedOffset = setup?.name === snapshot.plannedPhases[0]?.title ? 1 : 0;
  const actualPhases = snapshot.phases.map((phase, index) => phaseFromSnapshot(snapshot, calls, index + 1, phase, now, plannedOffset));
  const plannedPending = snapshot.plannedPhases
    .slice(actualPhases.length + plannedOffset)
    .map((phase, index) => pendingPhase(phase, actualPhases.length + index + 1));
  const phases = [...(setup ? [setup] : []), ...actualPhases, ...plannedPending];
  if (phases.length > 0) return phases;
  return [{ index: 1, name: "Starting", status: "running", callsDone: 0, callsTotal: 0, calls: [] }];
}

function setupPhase(snapshot: WorkflowSnapshot, allCalls: readonly WorkflowSnapshotCall[], now: number): WorkflowUiPhase | undefined {
  const calls = phaseCalls(allCalls, 0, now);
  const hasSetupMessages = snapshot.messages.some((message) => message.phaseIndex === 0);
  const hasSetupTraces = snapshot.traces.some((trace) => trace.phaseIndex === 0);
  if (calls.length === 0 && !hasSetupMessages && !hasSetupTraces) return undefined;
  return {
    index: 0,
    name: "Setup",
    status: phaseStatus(snapshot, allCalls, 0),
    callsDone: calls.filter((call) => call.status !== "running").length,
    callsTotal: calls.length,
    calls,
  };
}

function phaseFromSnapshot(
  snapshot: WorkflowSnapshot,
  allCalls: readonly WorkflowSnapshotCall[],
  index: number,
  name: string,
  now: number,
  plannedOffset: number,
): WorkflowUiPhase {
  const calls = phaseCalls(allCalls, index, now);
  return {
    index,
    name,
    detail: snapshot.plannedPhases[index - 1 + plannedOffset]?.detail,
    status: phaseStatus(snapshot, allCalls, index),
    callsDone: calls.filter((call) => call.status !== "running").length,
    callsTotal: calls.length,
    calls,
  };
}

function pendingPhase(phase: WorkflowSnapshot["plannedPhases"][number], index: number): WorkflowUiPhase {
  return {
    index,
    name: phase.title,
    detail: phase.detail,
    status: "pending",
    callsDone: 0,
    callsTotal: 0,
    calls: [],
  };
}

function phaseCalls(calls: readonly WorkflowSnapshotCall[], phaseIndex: number, now: number): WorkflowUiCall[] {
  return calls
    .filter((call) => call.phaseIndex === phaseIndex)
    .map((call) => (call.kind === "agent" ? uiAgent(call, now) : uiLLM(call, now)));
}

function phaseStatus(snapshot: WorkflowSnapshot, calls: readonly WorkflowSnapshotCall[], phaseIndex: number): PhaseStatus {
  if (snapshot.status === "error" && calls.some((call) => call.phaseIndex === phaseIndex && call.status === "error")) return "error";
  if (snapshot.status === "running" && phaseIndex === snapshot.phases.length) return "running";
  if (snapshot.status === "running" && phaseIndex === 0 && snapshot.phases.length === 0) return "running";
  return "done";
}

function uiAgent(agent: WorkflowAgentSnapshot, now: number): WorkflowUiCall {
  const detailLines = [
    `id: ${String(agent.id)}`,
    `label: ${agent.label}`,
    `status: ${agent.status}`,
    `phase: ${agent.phase ?? (agent.phaseIndex === 0 ? "Setup" : `phase ${String(agent.phaseIndex)}`)}`,
    `model: ${agent.model ?? "default"}`,
    `reasoning: ${agent.reasoning ?? "default"}`,
    `tools: ${agent.tools === undefined ? "inherited" : agent.tools.length === 0 ? "none" : agent.tools.join(", ")}`,
  ];
  return {
    kind: "agent",
    id: agent.id,
    displayName: `#${String(agent.id)} ${agent.label}`,
    model: agent.model ?? "default",
    status: callStatus(agent.status),
    inputTokens: agent.inputTokenCount,
    cachedTokens: agent.cacheReadTokenCount,
    outputTokens: agent.outputTokenCount,
    cost: agent.cost,
    toolCalls: agent.toolCallCount,
    steps: agent.stepCount,
    durationSeconds: callDurationSeconds(agent.startedAt, agent.endedAt, now),
    detailLines,
    promptPath: agent.promptPath,
    activityPath: agent.activityPath,
    outputPath: agent.outputPath,
    message: agent.message,
    error: agent.error,
  };
}

function uiLLM(llm: WorkflowLLMSnapshot, now: number): WorkflowUiCall {
  return {
    kind: "llm",
    id: llm.id,
    displayName: `LLM #${String(llm.id)}`,
    model: llm.model ?? "active model",
    status: callStatus(llm.status),
    inputTokens: llm.inputTokenCount,
    cachedTokens: llm.cacheReadTokenCount,
    outputTokens: llm.outputTokenCount,
    cost: llm.cost,
    durationSeconds: callDurationSeconds(llm.startedAt, llm.endedAt, now),
    detailLines: [
      `id: ${String(llm.id)}`,
      "type: direct LLM",
      `status: ${llm.status}`,
      `phase: ${llm.phase ?? (llm.phaseIndex === 0 ? "Setup" : `phase ${String(llm.phaseIndex)}`)}`,
      `model: ${llm.model ?? "active model"}`,
      `reasoning: ${llm.reasoning ?? "default"}`,
      `provider: ${llm.provider ?? "unknown"}`,
      `stop reason: ${llm.stopReason ?? "unknown"}`,
    ],
    promptPath: llm.promptPath,
    outputPath: llm.outputPath,
    error: llm.error,
  };
}

function callStatus(status: WorkflowAgentSnapshot["status"]): CallStatus {
  if (status === "done") return "completed";
  if (status === "error") return "failed";
  return "running";
}

function callDurationSeconds(startedAt: number, endedAt: number | undefined, now: number): number {
  return Math.max(0, Math.floor(((endedAt ?? now) - startedAt) / 1000));
}
