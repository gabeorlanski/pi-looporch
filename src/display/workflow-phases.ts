import type { WorkflowAgentSnapshot, WorkflowSnapshot } from "../runtime.ts";

export interface WorkflowPhaseView {
  index: number;
  title: string;
  agents: WorkflowAgentSnapshot[];
  isCurrent: boolean;
  isStarted: boolean;
}

export function workflowPhaseViews(snapshot: WorkflowSnapshot, options: { includePlanned?: boolean } = {}): WorkflowPhaseView[] {
  const includePlanned = options.includePlanned === true;
  const runtimeCount = snapshot.phases.length;
  const phaseCount = includePlanned ? Math.max(snapshot.plannedPhases.length, runtimeCount) : runtimeCount;
  const explicitPhases = Array.from({ length: phaseCount }, (_unused, index) => {
    const phaseIndex = index + 1;
    return phaseView(
      snapshot,
      phaseIndex,
      snapshot.phases.at(index) ?? snapshot.plannedPhases.at(index)?.title ?? `Phase ${String(phaseIndex)}`,
    );
  });
  const startupAgents = snapshot.agents.filter((agent) => agent.phaseIndex === 0);
  if (startupAgents.length === 0 && explicitPhases.length > 0) return explicitPhases;
  return [phaseView(snapshot, 0, "startup"), ...explicitPhases];
}

function phaseView(snapshot: WorkflowSnapshot, index: number, title: string): WorkflowPhaseView {
  const agents = snapshot.agents.filter((agent) => agent.phaseIndex === index);
  return {
    index,
    title,
    agents,
    isCurrent: snapshot.result === undefined && index === snapshot.phases.length,
    isStarted: index === 0 || snapshot.phases.length >= index,
  };
}
