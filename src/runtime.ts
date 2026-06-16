import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import vm from "node:vm";

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface WorkflowMetadata {
  name: string;
  description: string;
}

export interface WorkflowAgentOptions {
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
  taskFile?: string;
  signal?: AbortSignal;
}

export interface WorkflowAgentProgress {
  statusMessage?: string;
  tokenCount?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  toolCallCount?: number;
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
  model?: string;
  reasoning?: ReasoningLevel;
  status: "running" | "done" | "error";
  startedAt: number;
  endedAt?: number;
  tokenCount: number;
  inputTokenCount: number;
  outputTokenCount: number;
  toolCallCount: number;
  fanOutId?: number;
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

export interface WorkflowSnapshot {
  workflowName: string;
  description: string;
  phases: string[];
  logs: string[];
  agents: WorkflowAgentSnapshot[];
  fanOuts: WorkflowFanOutSnapshot[];
  result?: unknown;
}

export type WorkflowEvent =
  | { type: "run_started"; workflowName: string; description: string }
  | { type: "phase"; title: string; index: number }
  | { type: "log"; message: string }
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

type WorkflowFunction = () => unknown;
type PipelineStage<T> = ((item: T, index: number) => Promise<T> | T) | { run: (item: T, index: number) => Promise<T> | T };
const fanOutScope = new AsyncLocalStorage<number>();

interface ActiveWorkflowRuntime {
  options: RunWorkflowOptions;
  snapshot: WorkflowSnapshot;
  emit: () => void;
  emitEvent: (event: WorkflowEvent) => void;
}

export async function runWorkflowFromDirectory(options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const workflowName = normalizeWorkflowName(options.workflowName);
  const workflowDir = resolveWorkflowDirectory(options.cwd, workflowName, options.workflowRoots);
  const entryFile = path.join(workflowDir, "workflow.js");
  const source = await readFile(entryFile, "utf8");
  const { metadata } = compileWorkflow(source, entryFile, metadataGlobals(options, workflowDir));
  validateWorkflowMetadata(metadata, workflowName);

  const snapshot: WorkflowSnapshot = { workflowName, description: metadata.description, phases: [], logs: [], agents: [], fanOuts: [] };
  const activeRuntime: ActiveWorkflowRuntime = {
    options,
    snapshot,
    emit: () => options.onSnapshot?.(cloneSnapshot(snapshot)),
    emitEvent: (event) => options.onEvent?.(cloneSerializable(event) as WorkflowEvent),
  };
  const compiled = compileWorkflow(source, entryFile, workflowGlobals(activeRuntime, workflowDir));
  validateWorkflowMetadata(compiled.metadata, workflowName);
  activeRuntime.emitEvent({ type: "run_started", workflowName, description: metadata.description });
  activeRuntime.emit();
  try {
    const result = cloneSerializable(await compiled.workflow());
    snapshot.result = result;
    activeRuntime.emitEvent({ type: "run_completed", result });
    activeRuntime.emit();
    return { workflowName, workflowDir, metadata, result, snapshot: cloneSnapshot(snapshot) };
  } catch (error) {
    activeRuntime.emitEvent({ type: "run_failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function parseWorkflowSourceMetadata(source: string, workflowName: string, filePath = "workflow.js"): WorkflowMetadata {
  const { metadata } = compileWorkflow(source, filePath, {});
  validateWorkflowMetadata(metadata, workflowName);
  return metadata;
}

export function normalizeWorkflowName(workflowName: string): string {
  const normalized = workflowName.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized)) throw new Error(`Invalid workflow name: ${workflowName}`);
  return normalized;
}

export function resolveWorkflowDirectory(cwd: string, workflowName: string, workflowRoots: string[] | undefined): string {
  for (const root of workflowRoots?.length ? workflowRoots : [path.resolve(cwd, ".pi", "workflows")]) {
    const direct = path.resolve(root);
    const child = path.join(direct, workflowName);
    if (existsSync(path.join(child, "workflow.js"))) return child;
  }
  throw new Error(`Workflow '${workflowName}' not found`);
}

export function resolveInsideWorkflow(workflowDir: string, relativePath: string): string {
  const target = path.resolve(workflowDir, relativePath.replace(/^@/, ""));
  const relative = path.relative(workflowDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Workflow file escapes workflow directory: ${relativePath}`);
  return target;
}

export function validateWorkflowMetadata(metadata: unknown, workflowName: string): asserts metadata is WorkflowMetadata {
  if (typeof metadata !== "object" || metadata === null) throw new Error("workflow.js must export metadata");
  const candidate = metadata as { name?: unknown; description?: unknown };
  if (candidate.name !== workflowName) throw new Error(`Workflow metadata name must be '${workflowName}'`);
  if (typeof candidate.description !== "string" || !candidate.description.trim())
    throw new Error("Workflow metadata description must be non-empty");
}

function metadataGlobals(options: RunWorkflowOptions, workflowDir: string): Record<string, unknown> {
  return {
    args: options.input,
    cwd: path.resolve(options.cwd),
    budget: { agentCount: 0, tokenCount: 0 },
    agent: unavailableMetadataPrimitive("agent"),
    phase: unavailableMetadataPrimitive("phase"),
    log: unavailableMetadataPrimitive("log"),
    readText: (relativePath: string) => readFileSync(resolveInsideWorkflow(workflowDir, relativePath), "utf8"),
    readJson: (relativePath: string) => JSON.parse(readFileSync(resolveInsideWorkflow(workflowDir, relativePath), "utf8")) as unknown,
    parallel: unavailableMetadataPrimitive("parallel"),
    pipeline: unavailableMetadataPrimitive("pipeline"),
  };
}

function unavailableMetadataPrimitive(name: string): () => never {
  return () => {
    throw new Error(`Workflow ${name} primitive is not available during metadata loading`);
  };
}

function workflowGlobals(runtime: ActiveWorkflowRuntime, workflowDir: string): Record<string, unknown> {
  return {
    args: runtime.options.input,
    cwd: path.resolve(runtime.options.cwd),
    budget: {
      get agentCount() {
        return runtime.snapshot.agents.length;
      },
      get tokenCount() {
        return runtime.snapshot.agents.reduce((total, agent) => total + agent.tokenCount, 0);
      },
    },
    agent: (prompt: string, agentOptions: WorkflowAgentOptions = {}) => runAgent(runtime, prompt, agentOptions),
    phase: (title: string) => {
      runtime.snapshot.phases.push(title);
      runtime.emitEvent({ type: "phase", title, index: runtime.snapshot.phases.length });
      runtime.emit();
    },
    log: (message: string) => {
      runtime.snapshot.logs.push(message);
      runtime.emitEvent({ type: "log", message });
      runtime.emit();
    },
    readText: (relativePath: string) => readFileSync(resolveInsideWorkflow(workflowDir, relativePath), "utf8"),
    readJson: (relativePath: string) => JSON.parse(readFileSync(resolveInsideWorkflow(workflowDir, relativePath), "utf8")) as unknown,
    parallel: <T, R>(items: readonly T[], worker: (item: T, index: number) => Promise<R> | R, fanOutOptions: { label?: string } = {}) =>
      runParallel(runtime, items, worker, fanOutOptions.label),
    pipeline: <T>(items: readonly T[], stages: PipelineStage<T>[]) =>
      Promise.all(items.map((item, index) => runPipelineItem(item, index, stages))),
  };
}

async function runParallel<T, R>(
  runtime: ActiveWorkflowRuntime,
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R> | R,
  label: string | undefined,
): Promise<R[]> {
  const fanOut: WorkflowFanOutSnapshot = {
    id: runtime.snapshot.fanOuts.length + 1,
    label: label ?? `parallel ${String(runtime.snapshot.fanOuts.length + 1)}`,
    total: items.length,
    running: items.length,
    done: 0,
    error: 0,
  };
  runtime.snapshot.fanOuts.push(fanOut);
  runtime.emitEvent({ type: "fanout_started", fanOut: { ...fanOut } });
  runtime.emit();
  return Promise.all(
    items.map(async (item, index) => {
      try {
        const result = await fanOutScope.run(fanOut.id, () => worker(item, index));
        fanOut.done++;
        return result;
      } catch (error) {
        fanOut.error++;
        throw error;
      } finally {
        fanOut.running = Math.max(0, fanOut.running - 1);
        runtime.emitEvent({ type: "fanout_progress", fanOut: { ...fanOut } });
        runtime.emit();
      }
    }),
  );
}

async function runAgent(runtime: ActiveWorkflowRuntime, prompt: string, agentOptions: WorkflowAgentOptions): Promise<unknown> {
  if (runtime.options.signal?.aborted) throw new Error("Workflow aborted");
  const agent: WorkflowAgentSnapshot = {
    id: runtime.snapshot.agents.length + 1,
    label: agentOptions.label ?? `agent ${String(runtime.snapshot.agents.length + 1)}`,
    phaseIndex: runtime.snapshot.phases.length,
    phase: runtime.snapshot.phases.at(-1),
    model: agentOptions.model,
    reasoning: agentOptions.reasoning,
    status: "running",
    startedAt: Date.now(),
    tokenCount: 0,
    inputTokenCount: 0,
    outputTokenCount: 0,
    toolCallCount: 0,
    fanOutId: fanOutScope.getStore(),
  };
  runtime.snapshot.agents.push(agent);
  runtime.emitEvent({ type: "agent_started", agent: { ...agent } });
  runtime.emit();
  try {
    const heartbeat = setInterval(runtime.emit, 1000);
    let result: unknown;
    try {
      result = await runtime.options.agent(
        prompt,
        runtime.options.signal ? { ...agentOptions, signal: runtime.options.signal } : agentOptions,
        (progress) => {
          agent.message = progress.statusMessage;
          const reportsStructuredTokens = progress.inputTokenCount !== undefined || progress.outputTokenCount !== undefined;
          if (progress.inputTokenCount !== undefined) agent.inputTokenCount = progress.inputTokenCount;
          if (progress.outputTokenCount !== undefined) agent.outputTokenCount = progress.outputTokenCount;
          if (progress.toolCallCount !== undefined) agent.toolCallCount = progress.toolCallCount;
          if (progress.tokenCount !== undefined) {
            agent.tokenCount = progress.tokenCount;
            if (!reportsStructuredTokens) agent.outputTokenCount = progress.tokenCount;
            if (reportsStructuredTokens && progress.outputTokenCount === undefined)
              agent.outputTokenCount = Math.max(0, progress.tokenCount - agent.inputTokenCount);
          } else {
            agent.tokenCount = agent.inputTokenCount + agent.outputTokenCount;
          }
          runtime.emitEvent({
            type: "agent_progress",
            agentId: agent.id,
            message: agent.message,
            tokenCount: agent.tokenCount,
            inputTokenCount: agent.inputTokenCount,
            outputTokenCount: agent.outputTokenCount,
            toolCallCount: agent.toolCallCount,
          });
          runtime.emit();
        },
      );
    } finally {
      clearInterval(heartbeat);
    }
    if (runtime.options.signal?.aborted) throw new Error("Workflow aborted");
    agent.status = "done";
    agent.endedAt = Date.now();
    runtime.emitEvent({ type: "agent_done", agentId: agent.id });
    runtime.emit();
    return result;
  } catch (error) {
    agent.status = "error";
    agent.endedAt = Date.now();
    agent.error = error instanceof Error ? error.message : String(error);
    runtime.emitEvent({ type: "agent_error", agentId: agent.id, error: agent.error });
    runtime.emit();
    throw error;
  }
}

async function runPipelineItem<T>(item: T, index: number, stages: PipelineStage<T>[]): Promise<T> {
  let current = item;
  for (const stage of stages) current = typeof stage === "function" ? await stage(current, index) : await stage.run(current, index);
  return current;
}

function compileWorkflow(
  source: string,
  filePath: string,
  globals: Record<string, unknown>,
): { metadata: unknown; workflow: WorkflowFunction } {
  const context = vm.createContext({ ...globals });
  const script = new vm.Script(
    `${transformWorkflowModule(source)}\n;({ metadata: typeof metadata === "undefined" ? undefined : metadata, workflow: typeof workflow === "undefined" ? undefined : workflow });`,
    { filename: filePath },
  );
  const exports = script.runInContext(context, { timeout: 1000 }) as { metadata?: unknown; workflow?: unknown };
  if (typeof exports.workflow !== "function") throw new Error("workflow.js must export a default function");
  return { metadata: exports.metadata, workflow: exports.workflow as WorkflowFunction };
}

function transformWorkflowModule(source: string): string {
  if (/\bimport\b/.test(source)) throw new Error("workflow.js cannot import modules");
  const transformed = source
    .replace(/\bexport\s+const\s+metadata\s*=/g, "const metadata =")
    .replace(
      /\bexport\s+default\s+async\s+function\s*([A-Za-z_$][\w$]*)?\s*\(/,
      (_match, name: string | undefined) => `const workflow = async function ${name ?? ""}(`,
    )
    .replace(
      /\bexport\s+default\s+function\s*([A-Za-z_$][\w$]*)?\s*\(/,
      (_match, name: string | undefined) => `const workflow = function ${name ?? ""}(`,
    )
    .replace(/\bexport\s+default\s+/g, "const workflow = ");
  if (/\bexport\b/.test(transformed)) throw new Error("workflow.js may only export metadata and a default workflow function");
  return transformed;
}

function cloneSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return {
    ...snapshot,
    phases: [...snapshot.phases],
    logs: [...snapshot.logs],
    agents: snapshot.agents.map((agent) => ({ ...agent })),
    fanOuts: snapshot.fanOuts.map((fanOut) => ({ ...fanOut })),
  };
}

function cloneSerializable(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as unknown;
}
