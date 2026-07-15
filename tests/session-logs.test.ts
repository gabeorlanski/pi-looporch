import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { workflowAgentSessionLogParentDirectory, writeWorkflowSessionSummary } from "../src/session-logs.ts";
import type { WorkflowSnapshot } from "../src/runtime/types.ts";

void test("workflow_session_summary_saves_structured_run_metadata", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-session-summary-"));
  const sessionsRoot = await mkdtemp(path.join(tmpdir(), "pi-workflow-sessions-"));
  const snapshot: WorkflowSnapshot = {
    workflowName: "review",
    description: "Review files",
    plannedPhases: [],
    phases: ["scan"],
    traces: [{ label: "selected files", phaseIndex: 1, phase: "scan", value: { count: 1, files: ["src/runtime/run.ts"] } }],
    messages: [{ phaseIndex: 1, phase: "scan", agentId: 1, agentLabel: "worker", level: "debug", message: "worker: reading" }],
    agents: [
      {
        id: 1,
        label: "worker",
        phaseIndex: 1,
        phase: "scan",
        status: "done",
        startedAt: 0,
        model: "fake-model",
        reasoning: "low",
        endedAt: 10,
        inputTokenCount: 9,
        cacheReadTokenCount: 0,
        outputTokenCount: 3,
        costUsd: 0.02,
        toolCallCount: 2,
        stepCount: 4,
        promptPath: "/tmp/run/agent-1/prompt.txt",
        activityPath: "/tmp/run/agent-1/activity.jsonl",
        outputPath: "/tmp/run/agent-1/output.json",
        sessionDir: "/tmp/session-dir",
        sessionFile: "/tmp/session-dir/workflow-agent-1.jsonl",
        eventsFile: "/tmp/session-dir/events.jsonl",
      },
    ],
    fanOuts: [{ id: 1, label: "files", total: 1, running: 0, done: 1, error: 0 }],
    status: "done",
  };

  const resultPath = path.join(project, "outputs", "final.json");
  const runDir = await writeWorkflowSessionSummary({ cwd: project, parentId: "parent-1", snapshot, resultPath, sessionsRoot });
  const summary = JSON.parse(await readFile(path.join(runDir, "workflow-summary.json"), "utf8")) as {
    status: string;
    phases: unknown;
    traces: unknown;
    messages: unknown;
    agents: unknown;
    resultPath: string;
  };

  assert.equal(runDir, workflowAgentSessionLogParentDirectory(project, "parent-1", sessionsRoot));
  assert.equal(summary.status, "done");
  assert.deepEqual(summary.phases, [{ index: 1, title: "scan" }]);
  assert.deepEqual(summary.traces, [
    { label: "selected files", phaseIndex: 1, phase: "scan", value: { count: 1, files: ["src/runtime/run.ts"] } },
  ]);
  assert.deepEqual(summary.messages, [
    { phaseIndex: 1, phase: "scan", agentId: 1, agentLabel: "worker", level: "debug", message: "worker: reading" },
  ]);
  assert.deepEqual(summary.agents, [
    {
      id: 1,
      label: "worker",
      phaseIndex: 1,
      phase: "scan",
      model: "fake-model",
      reasoning: "low",
      status: "done",
      startedAt: 0,
      endedAt: 10,
      inputTokenCount: 9,
      cacheReadTokenCount: 0,
      outputTokenCount: 3,
      costUsd: 0.02,
      toolCallCount: 2,
      stepCount: 4,
      promptPath: "/tmp/run/agent-1/prompt.txt",
      activityPath: "/tmp/run/agent-1/activity.jsonl",
      outputPath: "/tmp/run/agent-1/output.json",
      sessionDir: "/tmp/session-dir",
      sessionFile: "/tmp/session-dir/workflow-agent-1.jsonl",
      eventsFile: "/tmp/session-dir/events.jsonl",
    },
  ]);
  assert.equal(summary.resultPath, resultPath);
});
