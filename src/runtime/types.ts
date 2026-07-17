/** Reasoning effort labels accepted by workflow model calls. */
export const reasoningLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningLevel = (typeof reasoningLevels)[number];

/** Static phase metadata declared by workflow authors for run planning. */
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

/** A workflow-owned prompt template and the values used to render it at agent launch. */
export interface WorkflowAgentTemplateTask {
  template: string;
  values: Record<string, unknown>;
}

/** Workflow task text or a workflow-owned template rendered immediately before launch. */
export type WorkflowAgentTask = string | WorkflowAgentTemplateTask;

/** Options passed from workflow source to a launched child agent. */
export interface WorkflowAgentOptions {
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
  taskFile?: string;
  cwd?: string;
  schema?: unknown;
  signal?: AbortSignal;
  sessionLog?: WorkflowAgentSessionLog;
  extensions?: string[];
  tools?: string[];
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

/** Exact child-agent tool invocation recorded for live inspection. */
export interface WorkflowToolActivitySnapshot {
  name: string;
  arguments?: unknown;
}

/** Stable child-agent launch metadata reported by the Pi adapter to the workflow runtime. */
export interface WorkflowAgentLaunchMetadata {
  prompt: string;
}

/** Known workflow cost and whether it includes every observed provider response. */
export interface WorkflowCost {
  knownUsd: number;
  complete: boolean;
}

/** Incremental child-agent progress reported by the Pi adapter to the workflow runtime. */
export interface WorkflowAgentProgress {
  statusMessage?: string;
  inputTokenCount?: number;
  cacheReadTokenCount?: number;
  outputTokenCount?: number;
  cost?: WorkflowCost;
  toolCallCount?: number;
  toolActivity?: WorkflowToolActivitySnapshot[];
  stepCount?: number;
  model?: string;
  sessionDir?: string;
  sessionFile?: string;
  eventsFile?: string;
}

/** Callback surface used by child-agent implementations to report launch metadata and progress. */
export interface WorkflowAgentReporter {
  launched(metadata: WorkflowAgentLaunchMetadata): void;
  progress(progress: WorkflowAgentProgress): void;
}

/** Injected child-agent function used by the runtime; implementations must report progress and honor abort options. */
export type WorkflowAgent = (prompt: string, options: WorkflowAgentOptions, reporter: WorkflowAgentReporter) => Promise<unknown>;

/** Plain text message supplied to a direct workflow LLM completion. */
export interface WorkflowLLMMessage {
  role: "user" | "assistant";
  content: string;
}

/** Fully constructed request passed to the injected direct model-call adapter. */
export interface WorkflowLLMRequest {
  messages: WorkflowLLMMessage[];
  system?: string;
  model?: string;
  reasoning?: ReasoningLevel;
  signal?: AbortSignal;
}

/** Standard provider token usage exposed by direct workflow LLM calls. */
export interface WorkflowLLMUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/** Completed direct model response returned by the injected adapter. */
export interface WorkflowLLMCompletion {
  text: string;
  usage: WorkflowLLMUsage;
  cost: WorkflowCost;
  model?: string;
  provider?: string;
  stopReason?: string;
}

/** Injected generation-only model call used by the workflow runtime. */
export type WorkflowLLM = (request: WorkflowLLMRequest) => Promise<WorkflowLLMCompletion>;

/** State shared by every model call recorded in a workflow snapshot. */
export interface WorkflowCallSnapshot {
  id: number;
  phaseIndex: number;
  phase?: string;
  model?: string;
  reasoning?: ReasoningLevel;
  status: "running" | "done" | "error";
  startedAt: number;
  endedAt?: number;
  inputTokenCount: number;
  cacheReadTokenCount: number;
  outputTokenCount: number;
  cost: WorkflowCost;
  promptPath?: string;
  outputPath?: string;
  error?: string;
}

/** Live and final state for one child-agent launch inside a workflow run. */
export type WorkflowAgentSnapshot = WorkflowCallSnapshot & {
  label: string;
  cwd?: string;
  tools?: string[];
  toolCallCount: number;
  stepCount: number;
  fanOutId?: number;
  activityPath?: string;
  sessionDir?: string;
  sessionFile?: string;
  eventsFile?: string;
  message?: string;
};

/** Live and final state for one direct generation-only model call. */
export type WorkflowLLMSnapshot = WorkflowCallSnapshot & {
  provider?: string;
  stopReason?: string;
};

/** Canonical discriminated view of a recorded workflow model call. */
export type WorkflowSnapshotCall = Readonly<WorkflowAgentSnapshot & { kind: "agent" }> | Readonly<WorkflowLLMSnapshot & { kind: "llm" }>;

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
  llms: WorkflowLLMSnapshot[];
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
  llm: WorkflowLLM;
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
