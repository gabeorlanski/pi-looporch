import type { WorkflowAgentSnapshot, WorkflowRunMessageSnapshot, WorkflowSnapshot } from "../runtime/types.ts";

export type WorkflowUiStatus = "running" | "done" | "error";
export type WorkflowUiPhaseStatus = "done" | "running" | "pending" | "error";
export type WorkflowUiAgentStatus = "completed" | "running" | "failed";

export interface WorkflowUiAgent {
  id: number;
  displayName: string;
  model: string;
  status: WorkflowUiAgentStatus;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  steps: number;
  durationSeconds: number;
  detailLines: string[];
  activity: string[];
  outcome: string;
}

export interface WorkflowUiPhase {
  index: number;
  name: string;
  detail?: string;
  status: WorkflowUiPhaseStatus;
  agentsDone: number;
  agentsTotal: number;
  agents: WorkflowUiAgent[];
}

export interface WorkflowUiWorkflow {
  name: string;
  subtitle: string;
  status: WorkflowUiStatus;
  agentsDone: number;
  agentsTotal: number;
  elapsed: number;
  tokensTotal: number;
  phases: WorkflowUiPhase[];
}

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
    const phases = workflowPhases(this.snapshot, this.now());
    const agentsDone = this.snapshot.agents.filter((agent) => agent.status !== "running").length;
    return {
      name: `workflow ${this.snapshot.workflowName}`,
      subtitle: this.snapshot.description,
      status: this.snapshot.status,
      agentsDone,
      agentsTotal: this.snapshot.agents.length,
      elapsed: Math.max(0, Math.floor((this.now() - this.startedAt) / 1000)),
      tokensTotal: this.snapshot.agents.reduce((total, agent) => total + agent.inputTokenCount + agent.outputTokenCount, 0),
      phases,
    };
  }
}

function workflowPhases(snapshot: WorkflowSnapshot, now: number): WorkflowUiPhase[] {
  const actualPhases = snapshot.phases.map((phase, index) => phaseFromSnapshot(snapshot, index + 1, phase, now));
  const setup = setupPhase(snapshot, now);
  const plannedPending = snapshot.plannedPhases
    .slice(actualPhases.length)
    .map((phase, index) => pendingPhase(phase, actualPhases.length + index + 1));
  const phases = [...(setup ? [setup] : []), ...actualPhases, ...plannedPending];
  if (phases.length > 0) return phases;
  return [{ index: 1, name: "Starting", status: "running", agentsDone: 0, agentsTotal: 0, agents: [] }];
}

function setupPhase(snapshot: WorkflowSnapshot, now: number): WorkflowUiPhase | undefined {
  const setupAgents = snapshot.agents.filter((agent) => agent.phaseIndex === 0).map((agent) => uiAgent(agent, snapshot, now));
  const hasSetupMessages = snapshot.messages.some((message) => message.phaseIndex === 0);
  const hasSetupTraces = snapshot.traces.some((trace) => trace.phaseIndex === 0);
  if (setupAgents.length === 0 && !hasSetupMessages && !hasSetupTraces) return undefined;
  return {
    index: 0,
    name: "Setup",
    status: phaseStatus(snapshot, 0),
    agentsDone: setupAgents.filter((agent) => agent.status !== "running").length,
    agentsTotal: setupAgents.length,
    agents: setupAgents,
  };
}

function phaseFromSnapshot(snapshot: WorkflowSnapshot, index: number, name: string, now: number): WorkflowUiPhase {
  const agents = snapshot.agents.filter((agent) => agent.phaseIndex === index).map((agent) => uiAgent(agent, snapshot, now));
  return {
    index,
    name,
    detail: snapshot.plannedPhases[index - 1]?.detail,
    status: phaseStatus(snapshot, index),
    agentsDone: agents.filter((agent) => agent.status !== "running").length,
    agentsTotal: agents.length,
    agents,
  };
}

function pendingPhase(phase: WorkflowSnapshot["plannedPhases"][number], index: number): WorkflowUiPhase {
  return {
    index,
    name: phase.title,
    detail: phase.detail,
    status: "pending",
    agentsDone: 0,
    agentsTotal: 0,
    agents: [],
  };
}

function phaseStatus(snapshot: WorkflowSnapshot, phaseIndex: number): WorkflowUiPhaseStatus {
  if (snapshot.status === "error" && snapshot.agents.some((agent) => agent.phaseIndex === phaseIndex && agent.status === "error"))
    return "error";
  if (snapshot.status === "running" && phaseIndex === snapshot.phases.length) return "running";
  if (snapshot.status === "running" && phaseIndex === 0 && snapshot.phases.length === 0) return "running";
  return "done";
}

function uiAgent(agent: WorkflowAgentSnapshot, snapshot: WorkflowSnapshot, now: number): WorkflowUiAgent {
  const detailLines = [
    `id: ${String(agent.id)}`,
    `label: ${agent.label}`,
    `status: ${agent.status}`,
    `phase: ${agent.phase ?? (agent.phaseIndex === 0 ? "Setup" : `phase ${String(agent.phaseIndex)}`)}`,
    `model: ${agent.model ?? "default"}`,
    `reasoning: ${agent.reasoning ?? "default"}`,
    ...(agent.cwd ? [`cwd: ${agent.cwd}`] : []),
    ...(agent.sessionDir ? [`session dir: ${agent.sessionDir}`] : []),
    ...(agent.sessionFile ? [`session file: ${agent.sessionFile}`] : []),
    ...(agent.eventsFile ? [`events file: ${agent.eventsFile}`] : []),
    ...(agent.outputPath ? [`output: ${agent.outputPath}`] : []),
  ];
  return {
    id: agent.id,
    displayName: `#${String(agent.id)} ${agent.label}`,
    model: agent.model ?? "default",
    status: agentStatus(agent.status),
    inputTokens: agent.inputTokenCount,
    outputTokens: agent.outputTokenCount,
    toolCalls: agent.toolCallCount,
    steps: agent.stepCount,
    durationSeconds: agentDurationSeconds(agent, now),
    detailLines,
    activity: agentActivity(agent, snapshot.messages),
    outcome: agentOutcome(agent),
  };
}

function agentStatus(status: WorkflowAgentSnapshot["status"]): WorkflowUiAgentStatus {
  if (status === "done") return "completed";
  if (status === "error") return "failed";
  return "running";
}

function agentDurationSeconds(agent: WorkflowAgentSnapshot, now: number): number {
  return Math.max(0, Math.floor(((agent.endedAt ?? now) - agent.startedAt) / 1000));
}

function agentActivity(agent: WorkflowAgentSnapshot, messages: WorkflowRunMessageSnapshot[]): string[] {
  const agentMessages = messages.filter((message) => message.agentId === agent.id).map((message) => `${message.level}: ${message.message}`);
  const live = agent.message ? [`status: ${agent.message}`] : [];
  return [...agentMessages, ...live];
}

function agentOutcome(agent: WorkflowAgentSnapshot): string {
  if (agent.error) return agent.error;
  if (agent.outputPath) return `Agent output saved to ${agent.outputPath}`;
  if (agent.status === "running") return agent.message ?? "Agent is still running.";
  return "Agent completed. See the session transcript for details.";
}
