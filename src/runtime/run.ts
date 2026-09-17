/** Provides run behavior. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RunWorkflowOptions, WorkflowRunResult } from "./types.ts";
import { normalizeWorkflowName, resolveWorkflowDirectory } from "../workflow/paths.ts";
import { compileWorkflow } from "../workflow/sandbox.ts";
import { writeWorkflowFinalOutput, writeWorkflowOutputManifest } from "../workflow/outputs.ts";
import { drainWorkflowCalls, type ActiveWorkflowRuntime } from "./context.ts";
import { workflowGlobals } from "./globals.ts";
import { parseWorkflowSourceMetadata } from "../workflow/metadata.ts";
import { appendRunMessage } from "./messages.ts";
import { createAgentLaunchQueue } from "./queue.ts";
import { createInitialWorkflowSnapshot } from "./snapshot.ts";
import { cloneSerializable, cloneSnapshot } from "./serialization.ts";
import { errorMessage } from "../errors.ts";
import { throwIfWorkflowAborted } from "./abort.ts";

/** Provides the runWorkflowFromDirectory function contract. */
export async function runWorkflowFromDirectory(options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  throwIfWorkflowAborted(options.signal);
  const workflowName = normalizeWorkflowName(options.workflowName);
  if (!Number.isInteger(options.maxParallelAgents) || options.maxParallelAgents < 1)
    throw new Error("maxParallelAgents must be a positive integer");
  const workflowDir = resolveWorkflowDirectory(options.cwd, workflowName, options.workflowRoots);
  const entryFile = path.join(workflowDir, "workflow.js");
  const source = await readFile(entryFile, "utf8");
  const metadata = parseWorkflowSourceMetadata(source, workflowName, entryFile);

  const snapshot = createInitialWorkflowSnapshot(workflowName, metadata, options.input);
  const runtime: ActiveWorkflowRuntime = {
    options: { ...options },
    snapshot,
    agentLaunchQueue: createAgentLaunchQueue(options.maxParallelAgents),
    executionCounters: new Map(),
    inFlightCalls: new Set(),
    emit: () => options.onSnapshot?.(cloneSnapshot(snapshot)),
  };
  const compiled = compileWorkflow(source, entryFile, workflowGlobals(runtime, workflowDir));
  if (options.outputsDir) await writeWorkflowOutputManifest({ outputsDir: options.outputsDir, workflowName, snapshot });
  appendRunMessage(runtime, { phaseIndex: 0, level: "info", message: `workflow ${workflowName} started` });
  runtime.emit();
  try {
    throwIfWorkflowAborted(options.signal);
    const result = cloneSerializable(await compiled.workflow(options.input));
    await drainWorkflowCalls(runtime);
    throwIfWorkflowAborted(options.signal);
    options.onBeforeComplete?.();
    snapshot.status = "done";
    const resultPath = options.outputsDir ? await writeWorkflowFinalOutput(options.outputsDir, result) : undefined;
    if (options.outputsDir) await writeWorkflowOutputManifest({ outputsDir: options.outputsDir, workflowName, resultPath, snapshot });
    appendRunMessage(runtime, {
      phaseIndex: snapshot.phases.length,
      phase: snapshot.phases.at(-1),
      level: "info",
      message: "workflow completed",
    });
    runtime.emit();
    return { workflowName, workflowDir, metadata, result, snapshot: cloneSnapshot(snapshot), outputsDir: options.outputsDir, resultPath };
  } catch (error) {
    await drainWorkflowCalls(runtime);
    const aborted = options.signal?.aborted === true;
    snapshot.status = aborted ? "aborted" : "error";
    appendRunMessage(runtime, {
      phaseIndex: snapshot.phases.length,
      phase: snapshot.phases.at(-1),
      level: aborted ? "warning" : "error",
      message: aborted ? "workflow aborted" : `workflow failed: ${errorMessage(error)}`,
    });
    if (options.outputsDir)
      await writeWorkflowOutputManifest({
        outputsDir: options.outputsDir,
        workflowName,
        snapshot,
        ...(aborted ? {} : { error }),
      });
    runtime.emit();
    throw error;
  }
}
