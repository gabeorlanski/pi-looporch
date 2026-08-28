import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { claimRunRecord, writeRunRecord } from "../src/workflow/run-record.ts";
import { removeWorkflowSessionDirectory, workflowRunDirectory } from "../src/workflow/run-storage.ts";

void test("workflow resume records allow only one active claim", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-run-record-"));
  const sessionId = "session-a";
  const runId = "run-a";
  await writeRunRecord(workflowRunDirectory(project, sessionId, runId), {
    runId,
    workflowName: "review",
    cwd: project,
    input: { file: "src/index.ts" },
    ownerSessionId: sessionId,
    ownerProcessId: process.pid,
    startedAt: 1,
    resumeCount: 0,
    status: "error",
  });

  const claim = await claimRunRecord(project, sessionId, runId);
  assert.equal(claim.record.status, "error");
  await assert.rejects(claimRunRecord(project, sessionId, runId), /already being resumed/);

  await claim.release();
  const resumedClaim = await claimRunRecord(project, sessionId, runId);
  await resumedClaim.release();
  await removeWorkflowSessionDirectory(project, sessionId);
});
