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
}

export type WorkflowAgent = (
  prompt: string,
  options: WorkflowAgentOptions,
  reportProgress: (progress: WorkflowAgentProgress) => void,
) => Promise<unknown>;

export interface WorkflowAgentSnapshot {
  id: number;
  label: string;
  status: "running" | "done" | "error";
  tokenCount: number;
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

export interface RunWorkflowOptions {
  cwd: string;
  workflowName: string;
  input: unknown;
  agent: WorkflowAgent;
  workflowRoots?: string[];
  signal?: AbortSignal;
  onSnapshot?: (snapshot: WorkflowSnapshot) => void;
}

export interface WorkflowRunResult {
  workflowName: string;
  workflowDir: string;
  metadata: WorkflowMetadata;
  result: unknown;
  snapshot: WorkflowSnapshot;
}

type WorkflowFunction = () => Promise<unknown> | unknown;
type PipelineStage<T> = ((item: T, index: number) => Promise<T> | T) | { run: (item: T, index: number) => Promise<T> | T };
const fanOutScope = new AsyncLocalStorage<number>();

export async function runWorkflowFromDirectory(options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const workflowName = normalizeWorkflowName(options.workflowName);
  const workflowDir = await resolveWorkflowDirectory(options.cwd, workflowName, options.workflowRoots);
  const entryFile = path.join(workflowDir, "workflow.js");
  const source = await readFile(entryFile, "utf8");
  const { metadata } = compileWorkflow(source, entryFile, workflowGlobals(options, workflowDir));
  validateWorkflowMetadata(metadata, workflowName);

  const snapshot: WorkflowSnapshot = { workflowName, description: metadata.description, phases: [], logs: [], agents: [], fanOuts: [] };
  const emit = () => options.onSnapshot?.(cloneSnapshot(snapshot));
  const runtime = compileWorkflow(source, entryFile, workflowGlobals(options, workflowDir, snapshot, emit));
  validateWorkflowMetadata(runtime.metadata, workflowName);
  emit();
  const result = cloneSerializable(await runtime.workflow());
  snapshot.result = result;
  emit();
  return { workflowName, workflowDir, metadata, result, snapshot: cloneSnapshot(snapshot) };
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

export async function resolveWorkflowDirectory(cwd: string, workflowName: string, workflowRoots: string[] | undefined): Promise<string> {
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
  if (typeof candidate.description !== "string" || !candidate.description.trim()) throw new Error("Workflow metadata description must be non-empty");
}

function workflowGlobals(
  options: RunWorkflowOptions,
  workflowDir: string,
  snapshot?: WorkflowSnapshot,
  emit?: () => void,
): Record<string, unknown> {
  return {
    args: options.input,
    cwd: path.resolve(options.cwd),
    budget: {
      get agentCount() {
        return snapshot?.agents.length ?? 0;
      },
      get tokenCount() {
        return snapshot?.agents.reduce((total, agent) => total + agent.tokenCount, 0) ?? 0;
      },
    },
    agent: (prompt: string, agentOptions: WorkflowAgentOptions = {}) => runAgent(options, snapshot, emit, prompt, agentOptions),
    phase: (title: string) => {
      if (!snapshot || !emit) throw new Error("Workflow phase primitive is not available during metadata loading");
      snapshot.phases.push(String(title));
      emit();
    },
    log: (message: string) => {
      if (!snapshot || !emit) throw new Error("Workflow log primitive is not available during metadata loading");
      snapshot.logs.push(String(message));
      emit();
    },
    readText: (relativePath: string) => readFileSync(resolveInsideWorkflow(workflowDir, relativePath), "utf8"),
    readJson: (relativePath: string) => JSON.parse(readFileSync(resolveInsideWorkflow(workflowDir, relativePath), "utf8")) as unknown,
    parallel: <T, R>(items: readonly T[], worker: (item: T, index: number) => Promise<R> | R, fanOutOptions: { label?: string } = {}) =>
      runParallel(snapshot, emit, items, worker, fanOutOptions.label),
    pipeline: <T>(items: readonly T[], stages: Array<PipelineStage<T>>) =>
      Promise.all(items.map((item, index) => runPipelineItem(item, index, stages))),
  };
}

async function runParallel<T, R>(
  snapshot: WorkflowSnapshot | undefined,
  emit: (() => void) | undefined,
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R> | R,
  label: string | undefined,
): Promise<R[]> {
  if (!snapshot || !emit) throw new Error("Workflow parallel primitive is not available during metadata loading");
  const fanOut: WorkflowFanOutSnapshot = {
    id: snapshot.fanOuts.length + 1,
    label: label ?? `parallel ${snapshot.fanOuts.length + 1}`,
    total: items.length,
    running: items.length,
    done: 0,
    error: 0,
  };
  snapshot.fanOuts.push(fanOut);
  emit();
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
        emit();
      }
    }),
  );
}

async function runAgent(
  options: RunWorkflowOptions,
  snapshot: WorkflowSnapshot | undefined,
  emit: (() => void) | undefined,
  prompt: string,
  agentOptions: WorkflowAgentOptions,
): Promise<unknown> {
  if (!snapshot || !emit) throw new Error("Workflow agent primitive is not available during metadata loading");
  if (options.signal?.aborted) throw new Error("Workflow aborted");
  const agent: WorkflowAgentSnapshot = {
    id: snapshot.agents.length + 1,
    label: agentOptions.label ?? `agent ${snapshot.agents.length + 1}`,
    status: "running",
    tokenCount: 0,
    fanOutId: fanOutScope.getStore(),
  };
  snapshot.agents.push(agent);
  emit();
  try {
    const result = await options.agent(prompt, options.signal ? { ...agentOptions, signal: options.signal } : agentOptions, (progress) => {
      agent.message = progress.statusMessage;
      if (progress.tokenCount !== undefined) agent.tokenCount = progress.tokenCount;
      emit();
    });
    if (options.signal?.aborted) throw new Error("Workflow aborted");
    agent.status = "done";
    emit();
    return result;
  } catch (error) {
    agent.status = "error";
    agent.error = error instanceof Error ? error.message : String(error);
    emit();
    throw error;
  }
}

async function runPipelineItem<T>(item: T, index: number, stages: Array<PipelineStage<T>>): Promise<T> {
  let current = item;
  for (const stage of stages) current = typeof stage === "function" ? await stage(current, index) : await stage.run(current, index);
  return current;
}

function compileWorkflow(source: string, filePath: string, globals: Record<string, unknown>): { metadata: unknown; workflow: WorkflowFunction } {
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
    .replace(/\bexport\s+default\s+async\s+function\s*([A-Za-z_$][\w$]*)?\s*\(/, (_match, name: string | undefined) => `const workflow = async function ${name ?? ""}(`)
    .replace(/\bexport\s+default\s+function\s*([A-Za-z_$][\w$]*)?\s*\(/, (_match, name: string | undefined) => `const workflow = function ${name ?? ""}(`)
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
