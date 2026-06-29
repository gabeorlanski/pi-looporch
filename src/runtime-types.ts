/** Child-agent reasoning effort labels accepted by workflow APIs and forwarded to Pi model sessions. */
export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Static phase metadata declared by workflow authors for approval and run planning. */
export interface WorkflowPhaseMetadata {
  title: string;
  detail?: string;
}

/** Static workflow metadata exported from workflow.js and validated before execution. */
export interface WorkflowMetadata {
  name: string;
  description: string;
  inputInstructions: string;
  phases: WorkflowPhaseMetadata[];
}

/** Options passed from workflow source to a launched child agent. */
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

/** Persistent session-log identity attached to each child-agent SDK session. */
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

/** Incremental child-agent progress reported by the Pi adapter to the workflow runtime. */
export interface WorkflowAgentProgress {
  statusMessage?: string;
  inputTokenCount?: number;
  outputTokenCount?: number;
  toolCallCount?: number;
  stepCount?: number;
  model?: string;
  sessionDir?: string;
  sessionFile?: string;
  eventsFile?: string;
}

/** Injected child-agent function used by the runtime; implementations must report progress and honor abort options. */
export type WorkflowAgent = (
  prompt: string,
  options: WorkflowAgentOptions,
  reportProgress: (progress: WorkflowAgentProgress) => void,
) => Promise<unknown>;

/** Live and final state for one child-agent launch inside a workflow run. */
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
  inputTokenCount: number;
  outputTokenCount: number;
  toolCallCount: number;
  stepCount: number;
  fanOutId?: number;
  outputPath?: string;
  sessionDir?: string;
  sessionFile?: string;
  eventsFile?: string;
  message?: string;
  error?: string;
}

/** Aggregate progress for a workflow fan-out launched through the parallel primitive. */
export interface WorkflowFanOutSnapshot {
  id: number;
  label: string;
  total: number;
  running: number;
  done: number;
  error: number;
}

/** Structured debug value recorded by workflow source with trace(...). */
export interface WorkflowTraceSnapshot {
  label: string;
  phaseIndex: number;
  phase?: string;
  value?: unknown;
}

/** Chronological workflow runtime message used for logs, summaries, and review. */
export interface WorkflowRunMessageSnapshot {
  phaseIndex: number;
  phase?: string;
  agentId?: number;
  agentLabel?: string;
  level: "debug" | "error" | "info" | "warning";
  message: string;
}

/** Serializable state snapshot emitted during and after workflow execution. */
export interface WorkflowSnapshot {
  workflowName: string;
  description: string;
  plannedPhases: WorkflowPhaseMetadata[];
  phases: string[];
  traces: WorkflowTraceSnapshot[];
  agents: WorkflowAgentSnapshot[];
  fanOuts: WorkflowFanOutSnapshot[];
  messages: WorkflowRunMessageSnapshot[];
  status: "running" | "done" | "error";
  input?: unknown;
}

/** Fully normalized inputs and injected dependencies required to execute a saved workflow. */
export interface RunWorkflowOptions {
  cwd: string;
  workflowName: string;
  input: unknown;
  agent: WorkflowAgent;
  workflowRoots?: string[];
  agentLogParentId?: string;
  outputsDir?: string;
  maxParallelAgents: number;
  signal?: AbortSignal;
  onSnapshot?: (snapshot: WorkflowSnapshot) => void;
}

/** Final workflow execution result returned after successful completion. */
export interface WorkflowRunResult {
  workflowName: string;
  workflowDir: string;
  metadata: WorkflowMetadata;
  result: unknown;
  snapshot: WorkflowSnapshot;
  outputsDir?: string;
  resultPath?: string;
}
