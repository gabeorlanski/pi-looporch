import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { workflowAgentSessionLogParentDirectory, writeWorkflowSessionSummary } from "../src/session-logs.ts";
import type { WorkflowSnapshot } from "../src/runtime.ts";

void test("workflow_session_summary_saves_structured_run_metadata", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-session-summary-"));
  const sessionsRoot = await mkdtemp(path.join(tmpdir(), "pi-workflow-sessions-"));
  const snapshot: WorkflowSnapshot = {
    workflowName: "review",
    description: "Review files",
    plannedPhases: [],
    phases: ["scan"],
    logs: [],
    traces: [{ label: "selected files", phaseIndex: 1, phase: "scan", value: { count: 1, files: ["src/runtime.ts"] } }],
    agents: [
      {
        id: 1,
        label: "worker",
        phaseIndex: 1,
        phase: "scan",
        status: "done",
        startedAt: 0,
        tokenCount: 0,
        inputTokenCount: 0,
        outputTokenCount: 0,
        toolCallCount: 0,
        sessionDir: "/tmp/session-dir",
        sessionFile: "/tmp/session-dir/workflow-agent-1.jsonl",
        eventsFile: "/tmp/session-dir/events.jsonl",
      },
    ],
    fanOuts: [{ id: 1, label: "files", total: 1, running: 0, done: 1, error: 0 }],
  };

  const runDir = await writeWorkflowSessionSummary({ cwd: project, parentId: "parent-1", snapshot, result: { ok: true }, sessionsRoot });
  const summary = JSON.parse(await readFile(path.join(runDir, "workflow-summary.json"), "utf8")) as {
    phases: unknown;
    traces: unknown;
    agents: unknown;
    result: unknown;
  };

  assert.equal(runDir, workflowAgentSessionLogParentDirectory(project, "parent-1", sessionsRoot));
  assert.deepEqual(summary.phases, [{ index: 1, title: "scan" }]);
  assert.deepEqual(summary.traces, [
    { label: "selected files", phaseIndex: 1, phase: "scan", value: { count: 1, files: ["src/runtime.ts"] } },
  ]);
  assert.deepEqual(summary.agents, [
    {
      id: 1,
      label: "worker",
      phaseIndex: 1,
      phase: "scan",
      status: "done",
      sessionDir: "/tmp/session-dir",
      sessionFile: "/tmp/session-dir/workflow-agent-1.jsonl",
      eventsFile: "/tmp/session-dir/events.jsonl",
    },
  ]);
  assert.deepEqual(summary.result, { ok: true });
});
