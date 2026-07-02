import { readFile } from "node:fs/promises";
import { discoverWorkflows, type WorkflowReference, workflowRootsForProject } from "../discovery.ts";
import type { WorkflowAgent, WorkflowSnapshot } from "../runtime/types.ts";
import { createInitialWorkflowSnapshot } from "../runtime/snapshot.ts";
import { startBackgroundWorkflowRun, type BackgroundWorkflowRun } from "./background-runs.ts";
import { extractWorkflowInputContract, validateWorkflowInput, type WorkflowInputContract } from "./input-contract.ts";
import { normalizeWorkflowName } from "./paths.ts";
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

async function resolveWorkflowReference(cwd: string, workflowName: string): Promise<WorkflowReference> {
  const normalizedName = normalizeWorkflowName(workflowName);
  const workflow = (await discoverWorkflows(cwd)).find((candidate) => candidate.name === normalizedName);
  if (!workflow) throw new Error(`Workflow '${normalizedName}' not found.`);
  return workflow;
}

export async function readWorkflowInputContract(workflow: WorkflowReference): Promise<WorkflowInputContract> {
  return extractWorkflowInputContract(await readFile(workflow.entryFile, "utf8"));
}

export async function prepareWorkflowRun(options: {
  cwd: string;
  workflowName: string;
  input: unknown;
  agentDir: string;
}): Promise<PreparedWorkflowRun> {
  const workflow = await resolveWorkflowReference(options.cwd, options.workflowName);
  const input = validateWorkflowInput(options.input, workflow.name, await readWorkflowInputContract(workflow));
  const runId = createWorkflowRunId(workflow.name);
  const workflowSettings = await readWorkflowSettings(options.cwd, options.agentDir);
  return {
    runId,
    cwd: options.cwd,
    workflowName: workflow.name,
    workflow,
    input,
    workflowRoots: await workflowRootsForProject(options.cwd),
    maxParallelAgents: workflowSettings.maxParallelAgents,
    initialSnapshot: createInitialWorkflowSnapshot(workflow.name, workflow.metadata, input),
  };
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
