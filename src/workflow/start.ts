/** Provides start behavior. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discoverWorkflows, type WorkflowReference, workflowRootsForProject } from "../discovery.ts";
import type { WorkflowAgent, WorkflowAgentDefaults, WorkflowLLM, WorkflowSnapshot } from "../runtime/types.ts";
import { createInitialWorkflowSnapshot } from "../runtime/snapshot.ts";
import { startBackgroundWorkflowRun, type BackgroundWorkflowRun, type WorkflowRunAttempt } from "./background-runs.ts";
import { extractWorkflowInputContract, validateWorkflowInput, type WorkflowInputContract } from "./input-contract.ts";
import { normalizeWorkflowName } from "./paths.ts";
import { createWorkflowRunId } from "./run-id.ts";
import { readWorkflowSettings } from "./settings.ts";
import { claimRunRecord } from "./run-record.ts";

export interface PreparedWorkflowRun {
  runId: string;
  cwd: string;
  workflowName: string;
  workflow: WorkflowReference;
  input: unknown;
  workflowRoots: string[];
  maxParallelAgents: number;
  agentDefaults: WorkflowAgentDefaults;
  initialSnapshot: WorkflowSnapshot;
  attempt: WorkflowRunAttempt;
}

/** Provides the readWorkflowInputContract function contract. */
export async function readWorkflowInputContract(workflow: WorkflowReference): Promise<WorkflowInputContract> {
  return extractWorkflowInputContract(await readFile(workflow.entryFile, "utf8"));
}

/** Provides the prepareWorkflowRun function contract. */
export async function prepareWorkflowRun(options: {
  cwd: string;
  workflowName: string;
  input: unknown;
  agentDir: string;
}): Promise<PreparedWorkflowRun> {
  const workflowName = normalizeWorkflowName(options.workflowName);
  const workflow = (await discoverWorkflows(options.cwd)).find((candidate) => candidate.name === workflowName);
  if (!workflow) throw new Error(`Workflow '${workflowName}' not found.`);
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
    agentDefaults: {
      extensions: workflowSettings.childAgentExtensions,
      tools: workflowSettings.childAgentTools,
    },
    initialSnapshot: createInitialWorkflowSnapshot(workflow.name, workflow.metadata, input),
    attempt: { kind: "new" },
  };
}

/** Prepares a failed or aborted run for deterministic replay in its owning live session. */
export async function prepareWorkflowResume(options: {
  cwd: string;
  runId: string;
  ownerSessionId: string;
  agentDir: string;
}): Promise<PreparedWorkflowRun> {
  const claim = await claimRunRecord(options.cwd, options.ownerSessionId, options.runId);
  const { record } = claim;
  try {
    if (
      record.runId !== options.runId ||
      record.ownerSessionId !== options.ownerSessionId ||
      path.resolve(record.cwd) !== path.resolve(options.cwd)
    ) {
      throw new Error(`Workflow run '${options.runId}' does not belong to the current project session.`);
    }
    if (record.ownerProcessId !== process.pid) throw new Error(`Workflow run '${options.runId}' belongs to a different Pi process.`);
    if (record.status !== "error" && record.status !== "aborted") {
      throw new Error(`Workflow run '${options.runId}' cannot be resumed because its status is '${record.status}'.`);
    }
    const workflow = (await discoverWorkflows(options.cwd)).find((candidate) => candidate.name === record.workflowName);
    if (!workflow) throw new Error(`Workflow '${record.workflowName}' not found.`);
    const input = validateWorkflowInput(record.input, workflow.name, await readWorkflowInputContract(workflow));
    const workflowSettings = await readWorkflowSettings(options.cwd, options.agentDir);
    return {
      runId: record.runId,
      cwd: options.cwd,
      workflowName: workflow.name,
      workflow,
      input,
      workflowRoots: await workflowRootsForProject(options.cwd),
      maxParallelAgents: workflowSettings.maxParallelAgents,
      agentDefaults: {
        extensions: workflowSettings.childAgentExtensions,
        tools: workflowSettings.childAgentTools,
      },
      initialSnapshot: createInitialWorkflowSnapshot(workflow.name, workflow.metadata, input),
      attempt: {
        kind: "resume",
        startedAt: record.startedAt,
        resumeCount: record.resumeCount + 1,
        releaseClaim: claim.release,
      },
    };
  } catch (error) {
    await claim.release();
    throw error;
  }
}

/** Provides the startPreparedWorkflowRun function contract. */
export async function startPreparedWorkflowRun(options: {
  prepared: PreparedWorkflowRun;
  agent: WorkflowAgent;
  llm: WorkflowLLM;
  ownerSessionId: string;
  signal?: AbortSignal;
  onSnapshot?: (snapshot: WorkflowSnapshot) => void;
}): Promise<BackgroundWorkflowRun> {
  const { prepared } = options;
  try {
    return await startBackgroundWorkflowRun({
      runId: prepared.runId,
      cwd: prepared.cwd,
      workflowName: prepared.workflowName,
      input: prepared.input,
      agent: options.agent,
      agentDefaults: prepared.agentDefaults,
      llm: options.llm,
      workflowRoots: prepared.workflowRoots,
      agentLogParentId: prepared.runId,
      maxParallelAgents: prepared.maxParallelAgents,
      ownerSessionId: options.ownerSessionId,
      attempt: prepared.attempt,
      signal: options.signal,
      onSnapshot: options.onSnapshot,
    });
  } catch (error) {
    if (prepared.attempt.kind === "resume") await prepared.attempt.releaseClaim();
    throw error;
  }
}
