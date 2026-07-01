import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RunWorkflowOptions, WorkflowPhaseMetadata, WorkflowRunResult, WorkflowSnapshot } from "./types.ts";
import { normalizeWorkflowName, resolveWorkflowDirectory } from "../workflow/paths.ts";
import { compileWorkflow } from "../workflow/sandbox.ts";
import { writeWorkflowFinalOutput, writeWorkflowOutputManifest } from "../workflow/outputs.ts";
import type { ActiveWorkflowRuntime } from "./context.ts";
import { workflowGlobals } from "./globals.ts";
import { parseWorkflowSourceMetadata } from "../workflow/metadata.ts";
import { appendRunMessage } from "./messages.ts";
import { createAgentLaunchQueue, normalizeMaxParallelAgents } from "./queue.ts";
import { cloneSerializable, cloneSnapshot } from "./serialization.ts";
import { errorMessage } from "../errors.ts";
import { throwIfWorkflowAborted } from "./abort.ts";

export async function runWorkflowFromDirectory(options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  throwIfWorkflowAborted(options.signal);
  const workflowName = normalizeWorkflowName(options.workflowName);
  const maxParallelAgents = normalizeMaxParallelAgents(options.maxParallelAgents);
  const workflowDir = resolveWorkflowDirectory(options.cwd, workflowName, options.workflowRoots);
  const entryFile = path.join(workflowDir, "workflow.js");
  const source = await readFile(entryFile, "utf8");
  const metadata = parseWorkflowSourceMetadata(source, workflowName, entryFile);

  const plannedPhases = cloneSerializable(metadata.phases) as WorkflowPhaseMetadata[];
  const snapshot: WorkflowSnapshot = {
    workflowName,
    description: metadata.description,
    plannedPhases,
    phases: [],
    traces: [],
    agents: [],
    fanOuts: [],
    messages: [],
    status: "running",
    input: cloneSerializable(options.input),
  };
  const runtime: ActiveWorkflowRuntime = {
    options: { ...options, maxParallelAgents },
    snapshot,
    agentLaunchQueue: createAgentLaunchQueue(maxParallelAgents),
    emit: () => options.onSnapshot?.(cloneSnapshot(snapshot)),
  };
  const compiled = compileWorkflow(source, entryFile, workflowGlobals(runtime, workflowDir));
  if (options.outputsDir) await writeWorkflowOutputManifest({ outputsDir: options.outputsDir, workflowName, status: "running", snapshot });
  appendRunMessage(runtime, { phaseIndex: 0, level: "info", message: `workflow ${workflowName} started` });
  runtime.emit();
  try {
    throwIfWorkflowAborted(options.signal);
    const result = cloneSerializable(await compiled.workflow(options.input));
    throwIfWorkflowAborted(options.signal);
    snapshot.status = "done";
    const resultPath = options.outputsDir ? await writeWorkflowFinalOutput(options.outputsDir, result) : undefined;
    if (options.outputsDir)
      await writeWorkflowOutputManifest({ outputsDir: options.outputsDir, workflowName, status: "done", resultPath, snapshot });
    appendRunMessage(runtime, {
      phaseIndex: snapshot.phases.length,
      phase: snapshot.phases.at(-1),
      level: "info",
      message: "workflow completed",
    });
    runtime.emit();
    return { workflowName, workflowDir, metadata, result, snapshot: cloneSnapshot(snapshot), outputsDir: options.outputsDir, resultPath };
  } catch (error) {
    snapshot.status = "error";
    appendRunMessage(runtime, {
      phaseIndex: snapshot.phases.length,
      phase: snapshot.phases.at(-1),
      level: "error",
      message: `workflow failed: ${errorMessage(error)}`,
    });
    if (options.outputsDir)
      await writeWorkflowOutputManifest({ outputsDir: options.outputsDir, workflowName, status: "error", snapshot, error });
    runtime.emit();
    throw error;
  }
}
