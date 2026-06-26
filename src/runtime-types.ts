export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface WorkflowPhaseMetadata {
  title: string;
  detail?: string;
}

export interface WorkflowMetadata {
  name: string;
  description: string;
  inputInstructions: string;
  phases: WorkflowPhaseMetadata[];
}

export interface WorkflowAgentOptions {
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
  taskFile?: string;
  cwd?: string;
  schema?: unknown;
  maxAttempts?: number;
  signal?: AbortSignal;
  sessionLog?: WorkflowAgentSessionLog;
  tools?: boolean;
}

export interface WorkflowAgentSessionLog {
  parentId: string;
  agentId: number;
  agentKey: string;
  workflowName: string;
  label: string;
  phaseIndex: number;
  phase?: string;
  fanOutId?: number;
}

export interface WorkflowAgentProgress {
  statusMessage?: string;
  tokenCount?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  toolCallCount?: number;
  stepCount?: number;
  model?: string;
  sessionDir?: string;
  sessionFile?: string;
  eventsFile?: string;
}

export type WorkflowAgent = (
  prompt: string,
  options: WorkflowAgentOptions,
  reportProgress: (progress: WorkflowAgentProgress) => void,
) => Promise<unknown>;

export interface WorkflowAgentSnapshot {
  id: number;
  label: string;
  phaseIndex: number;
  phase?: string;
  cwd?: string;
  model?: string;
  reasoning?: ReasoningLevel;
  status: "running" | "done" | "error";
  startedAt: number;
  endedAt?: number;
  tokenCount: number;
  inputTokenCount: number;
  outputTokenCount: number;
  toolCallCount: number;
  stepCount: number;
  fanOutId?: number;
  sessionDir?: string;
  sessionFile?: string;
  eventsFile?: string;
  message?: string;
  error?: string;
}

export interface WorkflowFanOutSnapshot {
  id: number;
  label: string;
  total: number;
  running: number;
  done: number;
  error: number;
}

export interface WorkflowTraceSnapshot {
  label: string;
  phaseIndex: number;
  phase?: string;
  value?: unknown;
}

export interface WorkflowRunMessageSnapshot {
  phaseIndex: number;
  phase?: string;
  agentId?: number;
  agentLabel?: string;
  level: "debug" | "error" | "info" | "warning";
  message: string;
}

export interface WorkflowSnapshot {
  workflowName: string;
  description: string;
  plannedPhases: WorkflowPhaseMetadata[];
  phases: string[];
  logs: string[];
  traces: WorkflowTraceSnapshot[];
  agents: WorkflowAgentSnapshot[];
  fanOuts: WorkflowFanOutSnapshot[];
  messages?: WorkflowRunMessageSnapshot[];
  input?: unknown;
  result?: unknown;
}

export type WorkflowEvent =
  | { type: "run_started"; workflowName: string; description: string; plannedPhases: WorkflowPhaseMetadata[] }
  | { type: "phase"; title: string; index: number }
  | { type: "log"; message: string }
  | { type: "trace"; trace: WorkflowTraceSnapshot }
  | { type: "agent_schema_validation_failed"; agentId: number; attempt: number; error: string }
  | { type: "fanout_started"; fanOut: WorkflowFanOutSnapshot }
  | { type: "fanout_progress"; fanOut: WorkflowFanOutSnapshot }
  | { type: "agent_started"; agent: WorkflowAgentSnapshot }
  | {
      type: "agent_progress";
      agentId: number;
      message?: string;
      tokenCount: number;
      inputTokenCount: number;
      outputTokenCount: number;
      toolCallCount: number;
      stepCount: number;
      model?: string;
    }
  | { type: "agent_done"; agentId: number }
  | { type: "agent_error"; agentId: number; error: string }
  | { type: "run_completed"; result: unknown }
  | { type: "run_failed"; error: string };

export interface RunWorkflowOptions {
  cwd: string;
  workflowName: string;
  input: unknown;
  agent: WorkflowAgent;
  workflowRoots?: string[];
  agentLogParentId?: string;
  maxParallelAgents: number;
  signal?: AbortSignal;
  onSnapshot?: (snapshot: WorkflowSnapshot) => void;
  onEvent?: (event: WorkflowEvent) => void;
}

export interface WorkflowRunResult {
  workflowName: string;
  workflowDir: string;
  metadata: WorkflowMetadata;
  result: unknown;
  snapshot: WorkflowSnapshot;
}
