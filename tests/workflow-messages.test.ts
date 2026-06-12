import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowCompleteMessage, workflowFailureMessage, workflowSnapshotMessages, workflowStartMessage } from "../src/workflow-messages.ts";
import type { WorkflowSnapshot } from "../src/workflow-runtime.ts";

void test("workflow_boundary_messages_are_visible_text", () => {
  assert.equal(workflowStartMessage("review"), "Starting workflow 'review'...");
  assert.equal(workflowCompleteMessage("review", { ok: true }), "Workflow 'review' complete.\n\n{\n  \"ok\": true\n}");
  assert.equal(workflowFailureMessage("review", new Error("boom")), "Workflow 'review' failed: boom");
});

void test("workflow_snapshot_messages_report_new_phases_logs_and_agent_status", () => {
  const previous: WorkflowSnapshot = {
    workflowName: "review",
    description: "Review files",
    phases: [],
    logs: [],
    agents: [],
    fanOuts: [],
  };
  const next: WorkflowSnapshot = {
    workflowName: "review",
    description: "Review files",
    phases: ["fanout"],
    logs: ["reading files"],
    agents: [{ id: 1, label: "worker", status: "running", tokenCount: 0 }],
    fanOuts: [{ id: 1, label: "file reviews", total: 2, running: 1, done: 1, error: 0 }],
  };

  assert.deepEqual(workflowSnapshotMessages(previous, next), [
    "Workflow review phase: fanout",
    "Workflow review log: reading files",
    "Workflow review fan-out file reviews: 1/2 done, 1 running, 0 errors",
    "Workflow review agent worker: running",
  ]);
});
