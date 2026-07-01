import { readFile } from "node:fs/promises";
import { startBackgroundWorkflowRun, type BackgroundWorkflowRun } from "../background-runs.ts";
import { discoverWorkflowsUnlocked, type WorkflowReference, workflowRootsForProject } from "../discovery.ts";
import { extractWorkflowInputContract, validateWorkflowInput, type WorkflowInputContract } from "../input.ts";
import type { WorkflowAgent, WorkflowSnapshot } from "../runtime/types.ts";
import { normalizeWorkflowName } from "./paths.ts";
import { withWorkflowPublishLock } from "./publish-lock.ts";
import { createWorkflowRunId } from "./run-id.ts";
import { readWorkflowSettings } from "./settings.ts";

export interface PreparedWorkflowRun {
  runId: string;
  cwd: string;
  workflowName: string;
  workflow: WorkflowReference;
  input: unknown;
  workflowRoots: string[];
  maxParallelAgents: number;
  initialSnapshot: WorkflowSnapshot;
}

export interface StartedWorkflowRun extends PreparedWorkflowRun {
  run: BackgroundWorkflowRun;
}

export async function resolveWorkflowReference(cwd: string, workflowName: string, projectTrusted: boolean): Promise<WorkflowReference> {
  return await withWorkflowPublishLock(cwd, () => resolveWorkflowReferenceUnlocked(cwd, workflowName, projectTrusted));
}

async function resolveWorkflowReferenceUnlocked(cwd: string, workflowName: string, projectTrusted: boolean): Promise<WorkflowReference> {
  const normalizedName = normalizeWorkflowName(workflowName);
  const workflow = (await discoverWorkflowsUnlocked(cwd, projectTrusted)).find((candidate) => candidate.name === normalizedName);
  if (!workflow) throw new Error(`Workflow '${normalizedName}' not found.`);
  return workflow;
}

export async function readWorkflowInputContract(workflow: WorkflowReference): Promise<WorkflowInputContract> {
  return extractWorkflowInputContract(await readFile(workflow.entryFile, "utf8"));
}

/** Resolves a workflow and reads its input contract while holding the workflow publish lock. */
export async function resolveWorkflowInputContract(options: {
  cwd: string;
  workflowName: string;
  projectTrusted: boolean;
}): Promise<{ workflow: WorkflowReference; inputContract: WorkflowInputContract }> {
  return await withWorkflowPublishLock(options.cwd, async () => {
    const workflow = await resolveWorkflowReferenceUnlocked(options.cwd, options.workflowName, options.projectTrusted);
    return { workflow, inputContract: await readWorkflowInputContract(workflow) };
  });
}

export async function prepareWorkflowRun(options: {
  cwd: string;
  workflowName: string;
  input: unknown;
  agentDir: string;
  projectTrusted: boolean;
}): Promise<PreparedWorkflowRun> {
  const workflowSettings = await readWorkflowSettings(options.cwd, options.agentDir, options.projectTrusted);
  return await withWorkflowPublishLock(options.cwd, async () => {
    const workflow = await resolveWorkflowReferenceUnlocked(options.cwd, options.workflowName, options.projectTrusted);
    const input = validateWorkflowInput(options.input, workflow.name, await readWorkflowInputContract(workflow));
    const runId = createWorkflowRunId(workflow.name);
    return {
      runId,
      cwd: options.cwd,
      workflowName: workflow.name,
      workflow,
      input,
      workflowRoots: await workflowRootsForProject(options.cwd, options.projectTrusted),
      maxParallelAgents: workflowSettings.maxParallelAgents,
      initialSnapshot: initialWorkflowSnapshot(workflow, input),
    };
  });
}

export async function startPreparedWorkflowRun(options: {
  prepared: PreparedWorkflowRun;
  agent: WorkflowAgent;
  ownerSessionId: string;
  signal?: AbortSignal;
  onSnapshot?: (snapshot: WorkflowSnapshot) => void;
}): Promise<BackgroundWorkflowRun> {
  const { prepared } = options;
  return startBackgroundWorkflowRun({
    runId: prepared.runId,
    cwd: prepared.cwd,
    workflowName: prepared.workflowName,
    input: prepared.input,
    agent: options.agent,
    workflowRoots: prepared.workflowRoots,
    agentLogParentId: prepared.runId,
    maxParallelAgents: prepared.maxParallelAgents,
    ownerSessionId: options.ownerSessionId,
    signal: options.signal,
    onSnapshot: options.onSnapshot,
  });
}

export async function startWorkflowRun(options: {
  cwd: string;
  workflowName: string;
  input: unknown;
  agentDir: string;
  agent: WorkflowAgent;
  ownerSessionId: string;
  projectTrusted: boolean;
  signal?: AbortSignal;
  onSnapshot?: (snapshot: WorkflowSnapshot) => void;
}): Promise<StartedWorkflowRun> {
  const prepared = await prepareWorkflowRun(options);
  const run = await startPreparedWorkflowRun({
    prepared,
    agent: options.agent,
    ownerSessionId: options.ownerSessionId,
    signal: options.signal,
    onSnapshot: options.onSnapshot,
  });
  return { ...prepared, run };
}

function initialWorkflowSnapshot(workflow: WorkflowReference, input: unknown): WorkflowSnapshot {
  return {
    workflowName: workflow.name,
    description: workflow.metadata.description,
    plannedPhases: workflow.metadata.phases,
    phases: [],
    traces: [],
    agents: [],
    fanOuts: [],
    messages: [],
    status: "running",
    input,
  };
}
