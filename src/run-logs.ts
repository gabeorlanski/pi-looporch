import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { WorkflowEvent, WorkflowMetadata, WorkflowSnapshot } from "./runtime.ts";

export interface WorkflowRunLogOptions {
  cwd: string;
  workflowName: string;
  workflowDir: string;
  metadata: WorkflowMetadata;
  source: string;
  input: unknown;
  runId?: string;
}

export interface WorkflowRunLog {
  runDir: string;
  recordEvent: (event: WorkflowEvent) => void;
  complete: (result: unknown, snapshot: WorkflowSnapshot) => Promise<void>;
  fail: (error: unknown, snapshot: WorkflowSnapshot | undefined) => Promise<void>;
}

interface WorkflowRunLogEnvelope {
  seq: number;
  time: string;
  event: WorkflowEvent;
}

export async function createWorkflowRunLog(options: WorkflowRunLogOptions): Promise<WorkflowRunLog> {
  const startedAt = new Date();
  const runId = options.runId ?? createWorkflowRunId(options.workflowName, startedAt);
  const runDir = path.join(path.resolve(options.cwd), ".pi", "workflow-runs", runId);
  const eventsFile = path.join(runDir, "events.jsonl");
  let seq = 0;

  await mkdir(runDir, { recursive: true });
  await Promise.all([
    writeJson(path.join(runDir, "metadata.json"), {
      runId,
      workflowName: options.workflowName,
      workflowDir: options.workflowDir,
      startedAt: startedAt.toISOString(),
      metadata: options.metadata,
    }),
    writeJson(path.join(runDir, "input.json"), options.input),
    writeFile(path.join(runDir, "workflow.js"), options.source, "utf8"),
    writeFile(eventsFile, "", "utf8"),
  ]);

  return {
    runDir,
    recordEvent(event) {
      const envelope: WorkflowRunLogEnvelope = { seq: ++seq, time: new Date().toISOString(), event };
      appendFileSync(eventsFile, `${JSON.stringify(envelope)}\n`, "utf8");
    },
    async complete(result, snapshot) {
      await Promise.all([
        writeJson(path.join(runDir, "result.json"), result),
        writeJson(path.join(runDir, "final-snapshot.json"), snapshot),
      ]);
    },
    async fail(error, snapshot) {
      await Promise.all([
        writeJson(path.join(runDir, "error.json"), { message: error instanceof Error ? error.message : String(error) }),
        ...(snapshot ? [writeJson(path.join(runDir, "final-snapshot.json"), snapshot)] : []),
      ]);
    },
  };
}

export function createWorkflowRunId(workflowName: string, startedAt = new Date()): string {
  return `${startedAt.toISOString().replace(/[:.]/g, "-")}-${workflowName}-${randomUUID().slice(0, 8)}`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value, null, 2);
  await writeFile(filePath, `${serialized}\n`, "utf8");
}
