import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readActiveWorkflowSnapshots } from "../src/workflow/active-run-snapshots.ts";
import { writeWorkflowOutputManifest, writeWorkflowSnapshot } from "../src/workflow/outputs.ts";
import { writeRunRecord } from "../src/workflow/run-record.ts";
import { workflowRunDirectory } from "../src/workflow/run-storage.ts";
import { readWorkflowStatusList } from "../src/workflow/status.ts";

void test("workflow status reads canonical running records for the requested session scope", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-status-"));
  await Promise.all([
    writeRunningWorkflow(project, "session-a", "run-a", "alpha", 1),
    writeRunningWorkflow(project, "session-b", "run-b", "beta", 2),
    writeTerminalWorkflowRecord(project, "session-a", "run-complete"),
    writeMismatchedWorkflowRecord(project),
  ]);

  const projectStatuses = await readWorkflowStatusList(project, {
    scope: "project",
    ownerSessionId: "session-a",
    ref: "latest",
    includeCompleted: false,
    now: 3_000,
  });
  assert.deepEqual(
    projectStatuses.map((status) => status.runId),
    ["run-b", "run-a"],
  );

  const sessionStatuses = await readWorkflowStatusList(project, {
    scope: "current-session",
    ownerSessionId: "session-a",
    ref: "latest",
    includeCompleted: false,
    now: 3_000,
  });
  assert.deepEqual(
    sessionStatuses.map((status) => status.runId),
    ["run-a"],
  );
  assert.deepEqual(sessionStatuses[0]?.outputsDir, workflowRunDirectory(project, "session-a", "run-a"));
  assert.deepEqual(
    (await readActiveWorkflowSnapshots(project, "session-a")).map((snapshot) => snapshot.runId),
    ["run-a"],
  );
});

void test("workflow status includes terminal aborted records only when requested", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-status-"));
  await writeRunRecord(workflowRunDirectory(project, "session-a", "run-aborted"), {
    runId: "run-aborted",
    workflowName: "review",
    cwd: project,
    input: {},
    ownerSessionId: "session-a",
    ownerProcessId: process.pid,
    startedAt: 1,
    resumeCount: 0,
    status: "aborted",
  });

  const active = await readWorkflowStatusList(project, {
    scope: "current-session",
    ownerSessionId: "session-a",
    ref: "latest",
    includeCompleted: false,
    now: 2_000,
  });
  const completed = await readWorkflowStatusList(project, {
    scope: "current-session",
    ownerSessionId: "session-a",
    ref: "latest",
    includeCompleted: true,
    now: 2_000,
  });

  assert.deepEqual(active, []);
  assert.equal(completed[0]?.status, "aborted");
  assert.equal(completed[0]?.resultPath, null);
});

void test("workflow status degrades a canonical running record when its output projection is unavailable", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-status-"));
  await writeRunRecord(workflowRunDirectory(project, "session-a", "run-a"), {
    runId: "run-a",
    workflowName: "alpha",
    cwd: project,
    input: {},
    ownerSessionId: "session-a",
    ownerProcessId: process.pid,
    startedAt: 1,
    resumeCount: 0,
    status: "running",
  });

  const statuses = await readWorkflowStatusList(project, {
    scope: "current-session",
    ownerSessionId: "session-a",
    ref: "latest",
    includeCompleted: false,
    now: 2_000,
  });

  assert.equal(statuses[0]?.runId, "run-a");
  assert.equal(statuses[0]?.status, "running");
  assert.equal(statuses[0]?.snapshotAvailable, false);
  assert.match(statuses[0]?.currentPhase ?? "", /snapshot unavailable/);
});

void test("workflow status retains a valid snapshot when the manifest is absent", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-status-"));
  const outputsDir = workflowRunDirectory(project, "session-a", "run-a");
  await writeRunRecord(outputsDir, {
    runId: "run-a",
    workflowName: "alpha",
    cwd: project,
    input: {},
    ownerSessionId: "session-a",
    ownerProcessId: process.pid,
    startedAt: 1,
    resumeCount: 0,
    status: "running",
  });
  await writeWorkflowSnapshot(outputsDir, {
    workflowName: "alpha",
    description: "alpha",
    plannedPhases: [],
    phases: ["inspect"],
    traces: [],
    agents: [
      {
        id: 1,
        label: "researcher",
        phaseIndex: 0,
        phase: "inspect",
        status: "running",
        startedAt: 1_000,
        inputTokenCount: 12,
        cacheReadTokenCount: 3,
        outputTokenCount: 4,
        cost: { knownUsd: 0, complete: true },
        toolCallCount: 2,
        stepCount: 5,
      },
    ],
    llms: [],
    fanOuts: [],
    messages: [],
    status: "running",
  });

  const [status] = await readWorkflowStatusList(project, {
    scope: "current-session",
    ownerSessionId: "session-a",
    ref: "latest",
    includeCompleted: false,
    now: 2_000,
  });

  assert.ok(status);
  assert.equal(status.snapshotAvailable, true);
  assert.equal(status.currentPhase, "inspect");
  assert.equal(status.activeAgents[0]?.label, "researcher");
  assert.equal(status.resultPath, null);
  assert.ok(status.errors[0]);
  assert.match(status.errors[0], /manifest\.json/);
});

void test("active workflow snapshots ignore only an expected missing snapshot race", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-status-"));
  const outputsDir = workflowRunDirectory(project, "session-a", "run-a");
  await writeRunRecord(outputsDir, {
    runId: "run-a",
    workflowName: "alpha",
    cwd: project,
    input: {},
    ownerSessionId: "session-a",
    ownerProcessId: process.pid,
    startedAt: 1,
    resumeCount: 0,
    status: "running",
  });

  assert.deepEqual(await readActiveWorkflowSnapshots(project, "session-a"), []);

  await writeFile(path.join(outputsDir, "snapshot.json"), "{", "utf8");
  await assert.rejects(readActiveWorkflowSnapshots(project, "session-a"), SyntaxError);
});

async function writeMismatchedWorkflowRecord(project: string): Promise<void> {
  await writeRunRecord(workflowRunDirectory(project, "session-a", "misplaced"), {
    runId: "different-run",
    workflowName: "misplaced",
    cwd: project,
    input: {},
    ownerSessionId: "session-b",
    ownerProcessId: process.pid,
    startedAt: 3,
    resumeCount: 0,
    status: "running",
  });
}

async function writeTerminalWorkflowRecord(project: string, ownerSessionId: string, runId: string): Promise<void> {
  await writeRunRecord(workflowRunDirectory(project, ownerSessionId, runId), {
    runId,
    workflowName: "complete",
    cwd: project,
    input: {},
    ownerSessionId,
    ownerProcessId: process.pid,
    startedAt: 0,
    resumeCount: 0,
    status: "done",
  });
}

async function writeRunningWorkflow(
  project: string,
  ownerSessionId: string,
  runId: string,
  workflowName: string,
  startedAt: number,
): Promise<void> {
  const outputsDir = workflowRunDirectory(project, ownerSessionId, runId);
  await writeRunRecord(outputsDir, {
    runId,
    workflowName,
    cwd: project,
    input: {},
    ownerSessionId,
    ownerProcessId: process.pid,
    startedAt,
    resumeCount: 0,
    status: "running",
  });
  await writeWorkflowSnapshot(outputsDir, {
    workflowName,
    description: workflowName,
    plannedPhases: [],
    phases: [],
    traces: [],
    agents: [],
    llms: [],
    fanOuts: [],
    messages: [],
    status: "running",
  });
  await writeWorkflowOutputManifest({ outputsDir, workflowName });
}
