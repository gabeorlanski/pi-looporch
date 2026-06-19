import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import vm from "node:vm";
import * as ts from "typescript";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";

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
  sessionDir?: string;
  sessionFile?: string;
  eventsFile?: string;
  /** Raw child-agent session messages, rendered natively in the inspector. */
  messages?: unknown[];
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
  sessionDir?: string;
  sessionFile?: string;
  eventsFile?: string;
  message?: string;
  error?: string;
  messages?: unknown[];
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

export interface WorkflowSnapshot {
  workflowName: string;
  description: string;
  plannedPhases: WorkflowPhaseMetadata[];
  phases: string[];
  logs: string[];
  traces: WorkflowTraceSnapshot[];
  agents: WorkflowAgentSnapshot[];
  fanOuts: WorkflowFanOutSnapshot[];
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

type WorkflowFunction = (input: unknown) => unknown;
type PipelineStage<T> = ((item: T, index: number) => Promise<T> | T) | { run: (item: T, index: number) => Promise<T> | T };

interface CoerceOptions {
  schema: unknown;
  prompt: string;
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
  maxAttempts?: number;
}

interface MapReduceOptions extends Record<string, unknown> {
  inputPrompt: string;
  mapPrompt: string;
  reducePrompt: string;
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
  maxAttempts?: number;
}

interface VerifierOptions extends Record<string, unknown> {
  criteria: unknown;
  criteriaPrompt: string;
  reducePrompt: string;
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
}

interface VerifierCriterion extends Record<string, unknown> {
  name: string;
  description: string;
  guidelines: string;
  reasoning: string;
  voters: number;
}

const fanOutScope = new AsyncLocalStorage<number>();

interface AgentLaunchQueue {
  acquire: (signal: AbortSignal | undefined) => Promise<() => void>;
}

interface ActiveWorkflowRuntime {
  options: RunWorkflowOptions;
  snapshot: WorkflowSnapshot;
  agentLaunchQueue: AgentLaunchQueue;
  emit: () => void;
  emitEvent: (event: WorkflowEvent) => void;
}

export async function runWorkflowFromDirectory(options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const workflowName = normalizeWorkflowName(options.workflowName);
  const maxParallelAgents = normalizeMaxParallelAgents(options.maxParallelAgents);
  const workflowDir = resolveWorkflowDirectory(options.cwd, workflowName, options.workflowRoots);
  const entryFile = path.join(workflowDir, "workflow.js");
  const source = await readFile(entryFile, "utf8");
  const { metadata } = compileWorkflow(source, entryFile, metadataGlobals(options, workflowDir));
  validateWorkflowMetadata(metadata, workflowName);

  const plannedPhases = cloneSerializable(metadata.phases) as WorkflowPhaseMetadata[];
  const snapshot: WorkflowSnapshot = {
    workflowName,
    description: metadata.description,
    plannedPhases,
    phases: [],
    logs: [],
    traces: [],
    agents: [],
    fanOuts: [],
    input: cloneSerializable(options.input),
  };
  const activeRuntime: ActiveWorkflowRuntime = {
    options: { ...options, maxParallelAgents },
    snapshot,
    agentLaunchQueue: createAgentLaunchQueue(maxParallelAgents),
    emit: () => options.onSnapshot?.(cloneSnapshot(snapshot)),
    emitEvent: (event) => options.onEvent?.(cloneSerializable(event) as WorkflowEvent),
  };
  const compiled = compileWorkflow(source, entryFile, workflowGlobals(activeRuntime, workflowDir));
  validateWorkflowMetadata(compiled.metadata, workflowName);
  activeRuntime.emitEvent({
    type: "run_started",
    workflowName,
    description: metadata.description,
    plannedPhases,
  });
  activeRuntime.emit();
  try {
    const result = cloneSerializable(await compiled.workflow(options.input));
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

export function resolveWorkflowReadPath(cwd: string, workflowDir: string, filePath: string): string {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("Workflow file path must be non-empty");
  if (filePath === "@workflow" || filePath.startsWith("@workflow/")) {
    const workflowPath = filePath === "@workflow" ? "." : filePath.slice("@workflow/".length);
    return resolveInsideRoot(workflowDir, workflowPath, "Workflow-local file escapes workflow directory");
  }
  return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(cwd, filePath);
}

export function validateWorkflowMetadata(metadata: unknown, workflowName: string): asserts metadata is WorkflowMetadata {
  if (typeof metadata !== "object" || metadata === null) throw new Error("workflow.js must export metadata");
  const candidate = metadata as { name?: unknown; description?: unknown; inputInstructions?: unknown; phases?: unknown };
  if (candidate.name !== workflowName) throw new Error(`Workflow metadata name must be '${workflowName}'`);
  if (typeof candidate.description !== "string" || !candidate.description.trim())
    throw new Error("Workflow metadata description must be non-empty");
  if (typeof candidate.inputInstructions !== "string" || !candidate.inputInstructions.trim())
    throw new Error("Workflow metadata inputInstructions must describe how to resolve command input");
  if (!Array.isArray(candidate.phases) || candidate.phases.length === 0)
    throw new Error("Workflow metadata phases must list at least one planned phase");
  candidate.phases.forEach((phase, index) => {
    if (typeof phase !== "object" || phase === null) throw new Error(`Workflow metadata phases[${String(index)}] must be an object`);
    const planned = phase as { title?: unknown; detail?: unknown };
    if (typeof planned.title !== "string" || !planned.title.trim())
      throw new Error(`Workflow metadata phases[${String(index)}].title must be non-empty`);
    if (planned.detail !== undefined && typeof planned.detail !== "string")
      throw new Error(`Workflow metadata phases[${String(index)}].detail must be a string when present`);
  });
}

function metadataGlobals(options: RunWorkflowOptions, workflowDir: string): Record<string, unknown> {
  return {
    args: options.input,
    cwd: path.resolve(options.cwd),
    budget: { agentCount: 0, tokenCount: 0 },
    agent: unavailableMetadataPrimitive("agent"),
    phase: unavailableMetadataPrimitive("phase"),
    log: unavailableMetadataPrimitive("log"),
    trace: unavailableMetadataPrimitive("trace"),
    readText: (filePath: string) => readFileSync(resolveWorkflowReadPath(options.cwd, workflowDir, filePath), "utf8"),
    readJson: (filePath: string) =>
      JSON.parse(readFileSync(resolveWorkflowReadPath(options.cwd, workflowDir, filePath), "utf8")) as unknown,
    renderPrompt: (templatePath: string, values: unknown) => renderWorkflowPrompt(workflowDir, templatePath, values),
    parallel: unavailableMetadataPrimitive("parallel"),
    pipeline: unavailableMetadataPrimitive("pipeline"),
    coerce: unavailableMetadataPrimitive("coerce"),
    mapreduce: unavailableMetadataPrimitive("mapreduce"),
    verifier: unavailableMetadataPrimitive("verifier"),
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
    trace: (label: string, value?: unknown) => recordTrace(runtime, label, value),
    readText: (filePath: string) => readFileSync(resolveWorkflowReadPath(runtime.options.cwd, workflowDir, filePath), "utf8"),
    readJson: (filePath: string) =>
      JSON.parse(readFileSync(resolveWorkflowReadPath(runtime.options.cwd, workflowDir, filePath), "utf8")) as unknown,
    renderPrompt: (templatePath: string, values: unknown) => renderWorkflowPrompt(workflowDir, templatePath, values),
    parallel: <T, R>(items: readonly T[], worker: (item: T, index: number) => Promise<R> | R, fanOutOptions: { label?: string } = {}) =>
      runParallel(runtime, items, worker, fanOutOptions.label),
    pipeline: <T>(items: readonly T[], stages: PipelineStage<T>[]) =>
      Promise.all(items.map((item, index) => runPipelineItem(item, index, stages))),
    coerce: (options: CoerceOptions) => coerceWithAgent(runtime, options),
    mapreduce: (options: MapReduceOptions) => mapReduceWithAgents(runtime, options),
    verifier: (options: VerifierOptions) => verifyWithAgents(runtime, options),
  };
}

function recordTrace(runtime: ActiveWorkflowRuntime, label: string, value?: unknown): void {
  if (typeof label !== "string" || !label.trim()) throw new Error("trace label must be non-empty");
  const phase = runtime.snapshot.phases.at(-1);
  const trace: WorkflowTraceSnapshot = {
    label,
    phaseIndex: runtime.snapshot.phases.length,
    ...(phase ? { phase } : {}),
    ...(value !== undefined ? { value: traceValue(value) } : {}),
  };
  runtime.snapshot.traces.push(trace);
  runtime.emitEvent({ type: "trace", trace });
  runtime.emit();
}

function traceValue(value: unknown): unknown {
  try {
    return cloneSerializable(value);
  } catch {
    return String(value);
  }
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
    running: Math.min(items.length, runtime.options.maxParallelAgents),
    done: 0,
    error: 0,
  };
  runtime.snapshot.fanOuts.push(fanOut);
  runtime.emitEvent({ type: "fanout_started", fanOut: { ...fanOut } });
  runtime.emit();
  return runQueuedParallel(items, runtime.options.maxParallelAgents, async (item, index) => {
    if (index >= runtime.options.maxParallelAgents) {
      fanOut.running++;
      runtime.emitEvent({ type: "fanout_progress", fanOut: { ...fanOut } });
      runtime.emit();
    }
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
  });
}

async function runQueuedParallel<T, R>(
  items: readonly T[],
  maxParallelAgents: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  const errors: unknown[] = [];
  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxParallelAgents, items.length) }, () => runWorker()));
  if (errors.length > 0) throw errors[0];
  return results;
}

function normalizeMaxParallelAgents(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("maxParallelAgents must be a positive integer");
  return value;
}

function createAgentLaunchQueue(maxParallelAgents: number): AgentLaunchQueue {
  let activeAgents = 0;
  const waiting: {
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    signal: AbortSignal | undefined;
    abort: () => void;
  }[] = [];

  const releaseNext = (): void => {
    while (activeAgents < maxParallelAgents && waiting.length > 0) {
      const waiter = waiting.shift();
      if (!waiter) return;
      waiter.signal?.removeEventListener("abort", waiter.abort);
      if (waiter.signal?.aborted) {
        waiter.reject(new Error("Workflow aborted"));
        continue;
      }
      activeAgents++;
      waiter.resolve(releaseOnce());
      return;
    }
  };

  const releaseOnce = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeAgents = Math.max(0, activeAgents - 1);
      releaseNext();
    };
  };

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(new Error("Workflow aborted"));
      if (activeAgents < maxParallelAgents) {
        activeAgents++;
        return Promise.resolve(releaseOnce());
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve,
          reject,
          signal,
          abort: () => {
            const index = waiting.indexOf(waiter);
            if (index >= 0) waiting.splice(index, 1);
            reject(new Error("Workflow aborted"));
          },
        };
        waiting.push(waiter);
        signal?.addEventListener("abort", waiter.abort, { once: true });
      });
    },
  };
}

async function coerceWithAgent(runtime: ActiveWorkflowRuntime, options: CoerceOptions): Promise<unknown> {
  if (typeof options.prompt !== "string" || !options.prompt.trim()) throw new Error("coerce prompt must be non-empty");
  const maxAttempts = normalizeAttemptCount(options.maxAttempts, "coerce");
  let validationFailure: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await runAgent(runtime, coercePrompt(options.prompt, options.schema, validationFailure), {
      label: options.label ?? "coerce",
      model: options.model,
      reasoning: options.reasoning,
      tools: false,
    });
    const validation = parseAndValidateJsonResponse(response, options.schema);
    if (validation.ok) return validation.value;
    validationFailure = validation.error;
  }
  throw new Error(`coerce failed schema validation after ${String(maxAttempts)} attempts: ${validationFailure ?? "unknown error"}`);
}

function normalizeAttemptCount(maxAttempts: number | undefined, primitive: string): number {
  if (maxAttempts === undefined) return 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error(`${primitive} maxAttempts must be a positive integer`);
  return maxAttempts;
}

function coercePrompt(prompt: string, schema: unknown, validationFailure: string | undefined): string {
  return jsonSchemaPrompt(
    "Return only JSON that validates against this JSON Schema. Do not include markdown fences, commentary, or extra text.",
    prompt,
    schema,
    validationFailure,
  );
}

type JsonResponseResult = { ok: true; value: unknown } | { ok: false; error: string };

function parseAndValidateJsonResponse(response: unknown, schema: unknown): JsonResponseResult {
  const parsed = parseJsonResponse(response);
  if (!parsed.ok) return parsed;
  if (Value.Check(schema as TSchema, parsed.value)) return parsed;
  return { ok: false, error: schemaValidationFailure(schema, parsed.value) };
}

function parseJsonResponse(response: unknown): JsonResponseResult {
  if (response !== null && typeof response === "object") return { ok: true, value: response };
  if (typeof response !== "string") return { ok: false, error: `response was ${typeof response}, not JSON text` };
  const trimmed = response.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  try {
    return { ok: true, value: JSON.parse(fenced?.[1] ?? trimmed) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function mapReduceWithAgents(runtime: ActiveWorkflowRuntime, options: MapReduceOptions): Promise<unknown> {
  const { inputPrompt, mapPrompt, reducePrompt, label: labelOption, model, reasoning, maxAttempts, ...context } = options;
  const label = typeof labelOption === "string" && labelOption.trim() ? labelOption : "mapreduce";
  const input = await coerceWithAgent(runtime, {
    schema: mapReduceInputSchema,
    prompt: renderPromptTemplate(inputPrompt, context),
    label: `${label} input`,
    model,
    reasoning,
    maxAttempts,
  });
  const items = (input as { items: unknown[] }).items;
  const mapped = await runParallel(
    runtime,
    items,
    (item, index) =>
      runAgent(runtime, renderPromptTemplate(mapPrompt, { ...context, item, index, items }), {
        label: `${label} map ${String(index + 1)}`,
        model,
        reasoning,
      }),
    `${label} map`,
  );
  return runAgent(runtime, renderPromptTemplate(reducePrompt, { ...context, items, results: mapped }), {
    label: `${label} reduce`,
    model,
    reasoning,
  });
}

const mapReduceInputSchema = {
  type: "object",
  properties: { items: { type: "array", items: {} } },
  required: ["items"],
  additionalProperties: true,
};

function renderPromptTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/{{\s*([A-Za-z_$][\w$]*)\s*}}/g, (_match, key: string) => promptTemplateValue(context[key]));
}

function renderWorkflowPrompt(workflowDir: string, templatePath: string, values: unknown): string {
  if (typeof templatePath !== "string" || !templatePath.trim()) throw new Error("renderPrompt templatePath must be non-empty");
  if (typeof values !== "object" || values === null || Array.isArray(values)) throw new Error("renderPrompt values must be an object");
  const resolvedTemplate = resolvePromptTemplate(workflowPromptDirectory(workflowDir), templatePath);
  return renderPromptTemplate(readFileSync(resolvedTemplate, "utf8"), values as Record<string, unknown>);
}

function workflowPromptDirectory(workflowDir: string): string {
  return path.join(workflowDir, "prompts");
}

function resolvePromptTemplate(promptDir: string, templatePath: string): string {
  const resolved = resolveInsideRoot(promptDir, templatePath, "Prompt template escapes workflow prompt directory");
  if (existsSync(resolved)) return resolved;
  throw new Error(`Prompt template not found: ${templatePath}`);
}

function resolveInsideRoot(root: string, relativePath: string, escapeMessage: string): string {
  const target = path.resolve(root, relativePath.replace(/^@/, ""));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${escapeMessage}: ${relativePath}`);
  return target;
}

function promptTemplateValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

async function verifyWithAgents(runtime: ActiveWorkflowRuntime, options: VerifierOptions): Promise<unknown> {
  const { criteria: rawCriteria, criteriaPrompt, reducePrompt, label: labelOption, model, reasoning, ...context } = options;
  const label = typeof labelOption === "string" && labelOption.trim() ? labelOption : "verifier";
  const criteria = normalizeVerifierCriteria(rawCriteria);
  const voterInputs = criteria.flatMap((criterion) =>
    Array.from({ length: criterion.voters }, (_value, voterIndex) => ({ criterion, voter: voterIndex + 1 })),
  );
  const votes = await runParallel(
    runtime,
    voterInputs,
    ({ criterion, voter }) =>
      runAgent(runtime, renderPromptTemplate(criteriaPrompt, { ...context, ...criterion, criterion, voter, criteria }), {
        label: `${label} ${criterion.name} voter ${String(voter)}`,
        model,
        reasoning,
      }),
    `${label} voters`,
  );
  return runAgent(runtime, renderPromptTemplate(reducePrompt, { ...context, criteria, votes }), {
    label: `${label} reduce`,
    model,
    reasoning,
  });
}

function normalizeVerifierCriteria(criteria: unknown): VerifierCriterion[] {
  if (!Array.isArray(criteria) || criteria.length === 0) throw new Error("verifier criteria must be a non-empty array");
  return criteria.map((criterion, index) => {
    if (typeof criterion !== "object" || criterion === null) throw new Error(`verifier criteria[${String(index)}] must be an object`);
    const candidate = criterion as Record<string, unknown>;
    const voters = candidate.voters ?? 1;
    for (const key of ["name", "description", "guidelines", "reasoning"]) {
      if (typeof candidate[key] !== "string" || !candidate[key].trim())
        throw new Error(`verifier criteria[${String(index)}].${key} must be a non-empty string`);
    }
    if (typeof voters !== "number" || !Number.isInteger(voters) || voters < 1)
      throw new Error(`verifier criteria[${String(index)}].voters must be a positive integer`);
    return { ...candidate, voters } as VerifierCriterion;
  });
}

async function runAgent(runtime: ActiveWorkflowRuntime, prompt: string, agentOptions: WorkflowAgentOptions): Promise<unknown> {
  if (agentOptions.schema === undefined) return runRawAgent(runtime, prompt, agentOptions);
  const { schema, maxAttempts, ...launchOptions } = agentOptions;
  const attempts = normalizeAttemptCount(maxAttempts, "agent");
  let validationFailure: string | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await runRawAgent(runtime, structuredAgentPrompt(prompt, schema, validationFailure), launchOptions);
    const validation = parseAndValidateJsonResponse(result, schema);
    if (validation.ok) return validation.value;
    validationFailure = validation.error;
    const lastAgent = runtime.snapshot.agents.at(-1);
    if (lastAgent) runtime.emitEvent({ type: "agent_schema_validation_failed", agentId: lastAgent.id, attempt, error: validationFailure });
    recordTrace(runtime, `${launchOptions.label ?? "agent"} schema validation failed`, { attempt, error: validationFailure });
  }
  throw new Error(`agent failed schema validation after ${String(attempts)} attempts: ${validationFailure ?? "unknown error"}`);
}

function structuredAgentPrompt(prompt: string, schema: unknown, validationFailure: string | undefined): string {
  return jsonSchemaPrompt(
    "Complete the task, then return only JSON that validates against this JSON Schema. Do not include markdown fences, commentary, or extra text outside the JSON value.",
    prompt,
    schema,
    validationFailure,
  );
}

function jsonSchemaPrompt(instruction: string, task: string, schema: unknown, validationFailure: string | undefined): string {
  return [
    instruction,
    `Schema:\n${JSON.stringify(schema, null, 2)}`,
    `Task:\n${task}`,
    ...(validationFailure ? [`Previous response failed validation:\n${validationFailure}\nReturn corrected JSON only.`] : []),
  ].join("\n\n");
}

function schemaValidationFailure(schema: unknown, value: unknown): string {
  const errors = [...Value.Errors(schema as TSchema, value)].slice(0, 5).map((error) => `${error.instancePath || "/"} ${error.message}`);
  return errors.length ? errors.join("; ") : "response did not match schema";
}

async function runRawAgent(runtime: ActiveWorkflowRuntime, prompt: string, agentOptions: WorkflowAgentOptions): Promise<unknown> {
  if (runtime.options.signal?.aborted) throw new Error("Workflow aborted");
  const releaseAgentSlot = await runtime.agentLaunchQueue.acquire(runtime.options.signal);
  try {
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
        result = await runtime.options.agent(prompt, workflowAgentOptionsForLaunch(runtime, agent, agentOptions), (progress) => {
          if (progress.statusMessage !== undefined) agent.message = progress.statusMessage;
          if (progress.inputTokenCount !== undefined) agent.inputTokenCount = progress.inputTokenCount;
          if (progress.outputTokenCount !== undefined) agent.outputTokenCount = progress.outputTokenCount;
          if (progress.toolCallCount !== undefined) agent.toolCallCount = progress.toolCallCount;
          if (progress.sessionDir !== undefined) agent.sessionDir = progress.sessionDir;
          if (progress.sessionFile !== undefined) agent.sessionFile = progress.sessionFile;
          if (progress.eventsFile !== undefined) agent.eventsFile = progress.eventsFile;
          if (progress.messages !== undefined) agent.messages = progress.messages;
          agent.tokenCount = progress.tokenCount ?? agent.inputTokenCount + agent.outputTokenCount;
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
        });
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
  } finally {
    releaseAgentSlot();
  }
}

function workflowAgentOptionsForLaunch(
  runtime: ActiveWorkflowRuntime,
  agent: WorkflowAgentSnapshot,
  agentOptions: WorkflowAgentOptions,
): WorkflowAgentOptions {
  const launchOptions: WorkflowAgentOptions = { ...agentOptions };
  delete launchOptions.schema;
  delete launchOptions.maxAttempts;
  return {
    ...launchOptions,
    ...(runtime.options.signal ? { signal: runtime.options.signal } : {}),
    ...(runtime.options.agentLogParentId
      ? {
          sessionLog: {
            parentId: runtime.options.agentLogParentId,
            agentId: agent.id,
            agentKey: workflowAgentSessionKey(agent),
            workflowName: runtime.snapshot.workflowName,
            label: agent.label,
            phaseIndex: agent.phaseIndex,
            ...(agent.phase ? { phase: agent.phase } : {}),
            ...(agent.fanOutId !== undefined ? { fanOutId: agent.fanOutId } : {}),
          },
        }
      : {}),
  };
}

function workflowAgentSessionKey(agent: WorkflowAgentSnapshot): string {
  return [
    phaseSessionSlug(agent),
    agent.fanOutId !== undefined ? `fanout-${String(agent.fanOutId).padStart(3, "0")}` : undefined,
    agentSessionSlug(agent),
  ]
    .filter((part): part is string => part !== undefined)
    .join("--");
}

function phaseSessionSlug(agent: WorkflowAgentSnapshot): string {
  const phaseLabel = agent.phase ?? (agent.phaseIndex === 0 ? "setup" : `phase-${String(agent.phaseIndex)}`);
  return `phase-${String(agent.phaseIndex).padStart(3, "0")}-${slugText(phaseLabel, 36)}`;
}

function agentSessionSlug(agent: WorkflowAgentSnapshot): string {
  return `agent-${String(agent.id).padStart(3, "0")}-${slugText(agent.label, 48)}`;
}

function slugText(value: string, maxLength: number): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength) || "unlabeled"
  );
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
  const sourceFile = ts.createSourceFile("workflow.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = workflowModuleEdits(sourceFile);
  return applySourceEdits(source, edits);
}

interface SourceEdit {
  start: number;
  end: number;
  replacement: string;
}

function workflowModuleEdits(sourceFile: ts.SourceFile): SourceEdit[] {
  const edits: SourceEdit[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) throw new Error("workflow.js cannot import modules");
    if (ts.isExportDeclaration(statement)) throw new Error("workflow.js may only export metadata and a default workflow function");
    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) throw new Error("workflow.js may only export metadata and a default workflow function");
      edits.push({
        start: statement.getStart(sourceFile),
        end: statement.expression.getStart(sourceFile),
        replacement: "const workflow = ",
      });
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exportModifier = modifiers?.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportModifier) continue;
    const defaultModifier = modifiers?.find((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    if (defaultModifier) {
      edits.push({ start: exportModifier.getStart(sourceFile), end: defaultModifier.getEnd(), replacement: "const workflow =" });
      continue;
    }
    if (ts.isVariableStatement(statement) && exportsOnlyMetadata(statement)) {
      edits.push({ start: exportModifier.getStart(sourceFile), end: exportModifier.getEnd(), replacement: "" });
      continue;
    }
    throw new Error("workflow.js may only export metadata and a default workflow function");
  }
  assertNoModuleLoadCalls(sourceFile);
  return edits;
}

function exportsOnlyMetadata(statement: ts.VariableStatement): boolean {
  const declarations = statement.declarationList.declarations;
  if (declarations.length !== 1) return false;
  const declaration = declarations[0];
  return (
    (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === "metadata"
  );
}

function assertNoModuleLoadCalls(sourceFile: ts.SourceFile): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) throw new Error("workflow.js cannot import modules");
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") throw new Error("workflow.js cannot use require()");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function applySourceEdits(source: string, edits: SourceEdit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((updated, edit) => `${updated.slice(0, edit.start)}${edit.replacement}${updated.slice(edit.end)}`, source);
}

function cloneSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return {
    ...snapshot,
    plannedPhases: snapshot.plannedPhases.map((phase) => ({ ...phase })),
    phases: [...snapshot.phases],
    logs: [...snapshot.logs],
    traces: snapshot.traces.map((trace) => ({ ...trace, ...(trace.value !== undefined ? { value: cloneSerializable(trace.value) } : {}) })),
    agents: snapshot.agents.map((agent) => ({ ...agent })),
    fanOuts: snapshot.fanOuts.map((fanOut) => ({ ...fanOut })),
  };
}

function cloneSerializable(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as unknown;
}
