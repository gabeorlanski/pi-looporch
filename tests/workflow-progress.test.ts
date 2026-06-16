import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatTokenCount,
  initialWorkflowProgressLines,
  initialWorkflowProgressStatusLine,
  workflowProgressLines,
  workflowProgressStatusLine,
  workflowProgressText,
} from "../src/workflow-progress.ts";
import type { WorkflowSnapshot } from "../src/workflow-runtime.ts";

void test("workflow_progress_table_summarizes_active_phase_progress_and_tokens", () => {
  const snapshot: WorkflowSnapshot = {
    workflowName: "review",
    description: "Review files",
    phases: ["fanout"],
    logs: ["hidden from compact progress"],
    agents: [
      { id: 1, label: "a.ts", status: "done", tokenCount: 900, message: "hidden" },
      { id: 2, label: "b.ts", status: "running", tokenCount: 300, message: "hidden" },
    ],
    fanOuts: [{ id: 1, label: "file reviews", total: 2, running: 1, done: 1, error: 0 }],
  };

  assert.deepEqual(workflowProgressLines(snapshot, 72), [
    "─── ◆ workflow: review ──────────────────────────────────────────────────",
    "  Phase: fanout  Progress: 1/2  Tokens: 1.2k tokens",
    "",
    "  phase             progress  tokens",
    "  ────────────────────────────────────────────────────────────────────",
    "  fanout            1/2       1.2k tokens",
  ]);
  assert.equal(
    workflowProgressText(snapshot, 72),
    "─── ◆ workflow: review ──────────────────────────────────────────────────\n" +
      "  Phase: fanout  Progress: 1/2  Tokens: 1.2k tokens\n\n" +
      "  phase             progress  tokens\n" +
      "  ────────────────────────────────────────────────────────────────────\n" +
      "  fanout            1/2       1.2k tokens",
  );
  assert.equal(workflowProgressStatusLine(snapshot), "Phase: fanout  Progress: 1/2  Tokens: 1.2k tokens");
});

void test("workflow_progress_table_falls_back_to_agent_counts_before_fanout", () => {
  const snapshot: WorkflowSnapshot = {
    workflowName: "select",
    description: "Select workflow",
    phases: [],
    logs: [],
    agents: [{ id: 1, label: "selector", status: "running", tokenCount: 1 }],
    fanOuts: [],
  };

  assert.deepEqual(workflowProgressLines(snapshot, 72), [
    "─── ◆ workflow: select ──────────────────────────────────────────────────",
    "  Phase: starting  Progress: 0/1  Tokens: 1 token",
    "",
    "  phase             progress  tokens",
    "  ────────────────────────────────────────────────────────────────────",
    "  starting          0/1       1 token",
  ]);
  assert.equal(workflowProgressStatusLine(snapshot), "Phase: starting  Progress: 0/1  Tokens: 1 token");
});

void test("initial_workflow_progress_uses_empty_table", () => {
  assert.deepEqual(initialWorkflowProgressLines("review", 72), [
    "─── ◆ workflow: review ──────────────────────────────────────────────────",
    "  Phase: starting  Progress: 0/0  Tokens: 0 tokens",
    "",
    "  phase             progress  tokens",
    "  ────────────────────────────────────────────────────────────────────",
    "  starting          0/0       0 tokens",
  ]);
  assert.equal(initialWorkflowProgressStatusLine(), "Phase: starting  Progress: 0/0  Tokens: 0 tokens");
});

void test("format_token_count_uses_readable_suffixes", () => {
  assert.equal(formatTokenCount(999), "999 tokens");
  assert.equal(formatTokenCount(1000), "1k tokens");
  assert.equal(formatTokenCount(1450), "1.4k tokens");
  assert.equal(formatTokenCount(1_000_000), "1M tokens");
});
