import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readActiveWorkflowRuns, registerActiveWorkflowRun, removeActiveWorkflowRun } from "../src/workflow/active-runs.ts";

void test("active_workflow_runs_are_independent_per_run_files", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-active-runs-"));

  await Promise.all([
    registerActiveWorkflowRun(project, {
      runId: "run-a",
      workflowName: "a",
      outputsDir: path.join(project, "outputs", "a"),
      startedAt: 1,
    }),
    registerActiveWorkflowRun(project, {
      runId: "run-b",
      workflowName: "b",
      outputsDir: path.join(project, "outputs", "b"),
      startedAt: 2,
    }),
  ]);

  assert.deepEqual((await readActiveWorkflowRuns(project)).map((record) => record.runId).sort(), ["run-a", "run-b"]);

  await removeActiveWorkflowRun(project, "run-a");

  assert.deepEqual(
    (await readActiveWorkflowRuns(project)).map((record) => record.runId),
    ["run-b"],
  );
});
