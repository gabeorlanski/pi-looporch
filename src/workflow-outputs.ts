import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from "./runtime-types.ts";

export type WorkflowOutputStatus = "done" | "error" | "running";

export interface WorkflowOutputManifestEntry {
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

export async function createWorkflowOutputsDir(runId: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `pi-workflow-${runId}-`));
}

export function workflowFinalOutputPath(outputsDir: string): string {
  return path.join(outputsDir, "outputs", "final.json");
}

export function workflowAgentOutputPath(outputsDir: string, agentId: number, label: string): string {
  return path.join(outputsDir, "outputs", `agent-${String(agentId).padStart(3, "0")}-${slugText(label, 72)}.json`);
}

export async function writeWorkflowFinalOutput(outputsDir: string, output: unknown): Promise<string> {
  const outputPath = workflowFinalOutputPath(outputsDir);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJsonFileAtomic(outputPath, output);
  return outputPath;
}

export async function writeWorkflowAgentOutput(outputsDir: string, agentId: number, label: string, output: unknown): Promise<string> {
  const outputPath = workflowAgentOutputPath(outputsDir, agentId, label);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJsonFileAtomic(outputPath, output);
  return outputPath;
}

export async function writeWorkflowOutputManifest(options: {
  outputsDir: string;
  workflowName: string;
  status: WorkflowOutputStatus;
  resultPath?: string;
  snapshot?: WorkflowSnapshot;
  error?: unknown;
}): Promise<void> {
  await mkdir(options.outputsDir, { recursive: true });
  await writeJsonFileAtomic(path.join(options.outputsDir, "manifest.json"), workflowOutputManifest(options));
}

export function workflowOutputManifest(options: {
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

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") return String(error);
  if (typeof error === "symbol") return error.description ?? "symbol";
  return JSON.stringify(error);
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
