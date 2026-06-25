import assert from "node:assert/strict";
import { test } from "node:test";
import { completeMessage, failureMessage, snapshotMessages, startMessage, workflowStringHandoffMessage } from "../src/display/messages.ts";
import type { WorkflowSnapshot } from "../src/runtime.ts";

void test("workflow_boundary_messages_are_visible_text", () => {
  assert.equal(startMessage("review"), "Starting workflow 'review'...");
  assert.equal(completeMessage("review", { ok: true }), "Workflow 'review' complete.\n\n{\n  \"ok\": true\n}");
  assert.equal(failureMessage("review", new Error("boom")), "Workflow 'review' failed: boom");
});

void test("workflow_complete_message_renders_string_results_without_json_escaping", () => {
  assert.equal(
    completeMessage("review", "Summary\n\n```bash\nnpm test\n```"),
    "Workflow 'review' complete.\n\nSummary\n\n```bash\nnpm test\n```",
  );
});

void test("workflow_string_handoff_message_names_workflow_function_source", () => {
  assert.equal(
    workflowStringHandoffMessage("review", "Summarize these artifacts for the user."),
    "Workflow 'review' returned this handoff from workflow():\n\nSummarize these artifacts for the user.",
  );
});

void test("workflow_snapshot_messages_report_new_phases_logs_and_agent_status", () => {
  const previous: WorkflowSnapshot = {
    workflowName: "review",
    description: "Review files",
    plannedPhases: [],
    phases: [],
    logs: [],
    traces: [],
    agents: [],
    fanOuts: [],
  };
  const next: WorkflowSnapshot = {
    workflowName: "review",
    description: "Review files",
    plannedPhases: [],
    phases: ["fanout"],
    logs: ["reading files"],
    traces: [],
    agents: [
      {
        id: 1,
        label: "worker",
        phaseIndex: 1,
        phase: "fanout",
        status: "running",
        startedAt: 0,
        tokenCount: 0,
        inputTokenCount: 0,
        outputTokenCount: 0,
        toolCallCount: 0,
      },
    ],
    fanOuts: [{ id: 1, label: "file reviews", total: 2, running: 1, done: 1, error: 0 }],
  };

  assert.deepEqual(snapshotMessages(previous, next), [
    "Workflow review phase: fanout",
    "Workflow review log: reading files",
    "Workflow review fan-out file reviews: 1/2 done, 1 running, 0 errors",
    "Workflow review agent worker: running",
  ]);
});
