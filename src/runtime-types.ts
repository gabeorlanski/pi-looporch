/** Child-agent reasoning effort labels accepted by workflow APIs and forwarded to Pi model sessions. */
export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Static phase metadata declared by workflow authors for previews and run planning. */
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

/** Compact recent tool-call summary stored in live workflow snapshots. */
export interface WorkflowToolCallSnapshot {
  tool: string;
  args: string;
}

/** Incremental child-agent progress reported by the Pi adapter to the workflow runtime. */
export interface WorkflowAgentProgress {
  statusMessage?: string;
  tokenCount?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  toolCallCount?: number;
  stepCount?: number;
  model?: string;
  recentToolCall?: WorkflowToolCallSnapshot;
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
  tokenCount: number;
  inputTokenCount: number;
  outputTokenCount: number;
  toolCallCount: number;
  stepCount: number;
  fanOutId?: number;
  outputPath?: string;
  outputPreview?: string;
  promptPreview?: string;
  promptLineCount?: number;
  recentToolCalls?: WorkflowToolCallSnapshot[];
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
  logs: string[];
  traces: WorkflowTraceSnapshot[];
  agents: WorkflowAgentSnapshot[];
  fanOuts: WorkflowFanOutSnapshot[];
  messages?: WorkflowRunMessageSnapshot[];
  input?: unknown;
  result?: unknown;
}

/** Structured event stream emitted by workflow execution for logs and external progress consumers. */
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
  onEvent?: (event: WorkflowEvent) => void;
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
