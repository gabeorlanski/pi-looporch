/** Provides outputs behavior. */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { errorMessage } from "../errors.ts";
import type { WorkflowAgentSnapshot, WorkflowSnapshot, WorkflowToolActivitySnapshot } from "../runtime/types.ts";
import { writeJsonFileAtomic, writeTextFileAtomic } from "./files.ts";

type WorkflowOutputStatus = "done" | "error" | "running";

interface WorkflowOutputManifestEntry {
  agentId: number;
  label: string;
  phaseIndex: number;
  phase?: string;
  path: string;
}

export interface WorkflowOutputManifest {
  workflowName: string;
  status: WorkflowOutputStatus;
  resultPath?: string;
  error?: string;
  outputs: WorkflowOutputManifestEntry[];
}

/** Provides the createWorkflowOutputsDir function contract. */
export async function createWorkflowOutputsDir(runId: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `pi-workflow-${runId}-`));
}

/** Provides the workflowFinalOutputPath function contract. */
export function workflowFinalOutputPath(outputsDir: string): string {
  return path.join(outputsDir, "outputs", "final.json");
}

/** Provides the workflowSnapshotPath function contract. */
export function workflowSnapshotPath(outputsDir: string): string {
  return path.join(outputsDir, "snapshot.json");
}

function workflowAgentOutputPath(outputsDir: string, agentId: number, label: string): string {
  return path.join(outputsDir, "outputs", `agent-${String(agentId).padStart(3, "0")}-${slugText(label, 72)}.json`);
}

function workflowAgentArtifactDir(outputsDir: string, agentId: number, label: string): string {
  return path.join(outputsDir, "agents", `agent-${String(agentId).padStart(3, "0")}-${slugText(label, 72)}`);
}

function workflowAgentPromptPath(outputsDir: string, agentId: number, label: string): string {
  return path.join(workflowAgentArtifactDir(outputsDir, agentId, label), "prompt.txt");
}

function workflowAgentActivityPath(outputsDir: string, agentId: number, label: string): string {
  return path.join(workflowAgentArtifactDir(outputsDir, agentId, label), "activity.jsonl");
}

/** Provides the writeWorkflowFinalOutput function contract. */
export async function writeWorkflowFinalOutput(outputsDir: string, output: unknown): Promise<string> {
  const outputPath = workflowFinalOutputPath(outputsDir);
  await writeJsonFileAtomic(outputPath, output);
  return outputPath;
}

/** Provides the writeWorkflowAgentOutput function contract. */
export async function writeWorkflowAgentOutput(outputsDir: string, agentId: number, label: string, output: unknown): Promise<string> {
  const outputPath = workflowAgentOutputPath(outputsDir, agentId, label);
  await writeJsonFileAtomic(outputPath, output);
  return outputPath;
}

/** Provides the writeWorkflowAgentPrompt function contract. */
export async function writeWorkflowAgentPrompt(outputsDir: string, agentId: number, label: string, prompt: string): Promise<string> {
  const promptPath = workflowAgentPromptPath(outputsDir, agentId, label);
  await writeTextFileAtomic(promptPath, prompt.endsWith("\n") ? prompt : `${prompt}\n`);
  return promptPath;
}

/** Provides the writeWorkflowAgentActivity function contract. */
export async function writeWorkflowAgentActivity(
  outputsDir: string,
  agentId: number,
  label: string,
  activity: WorkflowToolActivitySnapshot[],
): Promise<string> {
  const activityPath = workflowAgentActivityPath(outputsDir, agentId, label);
  const body = activity.map((entry) => JSON.stringify(entry)).join("\n");
  await writeTextFileAtomic(activityPath, body ? `${body}\n` : "");
  return activityPath;
}

/** Provides the readWorkflowOutputManifest function contract. */
export async function readWorkflowOutputManifest(outputsDir: string): Promise<WorkflowOutputManifest> {
  return JSON.parse(await readFile(path.join(outputsDir, "manifest.json"), "utf8")) as WorkflowOutputManifest;
}

/** Provides the readWorkflowSnapshot function contract. */
export async function readWorkflowSnapshot(outputsDir: string): Promise<WorkflowSnapshot> {
  return JSON.parse(await readFile(workflowSnapshotPath(outputsDir), "utf8")) as WorkflowSnapshot;
}

/** Provides the writeWorkflowSnapshot function contract. */
export async function writeWorkflowSnapshot(outputsDir: string, snapshot: WorkflowSnapshot): Promise<void> {
  await writeJsonFileAtomic(workflowSnapshotPath(outputsDir), snapshot);
}

/** Provides the writeWorkflowOutputManifest function contract. */
export async function writeWorkflowOutputManifest(options: {
  outputsDir: string;
  workflowName: string;
  status: WorkflowOutputStatus;
  resultPath?: string;
  snapshot?: WorkflowSnapshot;
  error?: unknown;
}): Promise<void> {
  await writeJsonFileAtomic(path.join(options.outputsDir, "manifest.json"), workflowOutputManifest(options));
}

function workflowOutputManifest(options: {
  workflowName: string;
  status: WorkflowOutputStatus;
  resultPath?: string;
  snapshot?: WorkflowSnapshot;
  error?: unknown;
}): WorkflowOutputManifest {
  return {
    workflowName: options.workflowName,
    status: options.status,
    ...(options.resultPath ? { resultPath: options.resultPath } : {}),
    ...(options.error !== undefined ? { error: errorMessage(options.error) } : {}),
    outputs: outputManifestEntries(options.snapshot?.agents ?? []),
  };
}

function outputManifestEntries(agents: WorkflowAgentSnapshot[]): WorkflowOutputManifestEntry[] {
  return agents
    .filter((agent): agent is WorkflowAgentSnapshot & { outputPath: string } => agent.outputPath !== undefined)
    .map((agent) => ({
      agentId: agent.id,
      label: agent.label,
      phaseIndex: agent.phaseIndex,
      ...(agent.phase ? { phase: agent.phase } : {}),
      path: agent.outputPath,
    }));
}

function slugText(value: string, maxLength: number): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength)
      .replace(/^-+|-+$/g, "") || "agent"
  );
}
