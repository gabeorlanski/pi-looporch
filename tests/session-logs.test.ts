import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLoggedWorkflowAgentSession } from "../src/session/agent-logs.ts";
import { writeWorkflowSessionSummary } from "../src/session/logs.ts";
import { parseSessionTokens } from "../src/session/usage.ts";
import { readWorkflowSnapshot, workflowSnapshotPath } from "../src/workflow/outputs.ts";
import type { WorkflowSnapshot } from "../src/runtime/types.ts";

void test("workflow_snapshot_normalizes_pre_usage_tracking_agents", async () => {
  const outputsDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-old-snapshot-"));
  await writeFile(
    workflowSnapshotPath(outputsDir),
    JSON.stringify({
      workflowName: "review",
      description: "Review files",
      plannedPhases: [],
      phases: [],
      traces: [],
      messages: [],
      fanOuts: [],
      status: "running",
      agents: [
        {
          id: 1,
          label: "worker",
          phaseIndex: 0,
          status: "running",
          startedAt: 0,
          inputTokenCount: 1,
          outputTokenCount: 2,
          toolCallCount: 0,
          stepCount: 0,
        },
      ],
    }),
    "utf8",
  );

  const snapshot = await readWorkflowSnapshot(outputsDir);

  assert.equal(snapshot.agents[0]?.cacheReadTokenCount, 0);
  assert.deepEqual(snapshot.agents[0]?.cost, { knownUsd: 0, complete: false });
  assert.deepEqual(snapshot.llms, []);
});

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
        model: "recorded-model",
        reasoning: "low",
        endedAt: 10,
        inputTokenCount: 9,
        cacheReadTokenCount: 0,
        outputTokenCount: 3,
        cost: { knownUsd: 0.02, complete: true },
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
    llms: [],
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
    agents?: Record<string, unknown>[];
    llms: unknown;
    resultPath: string;
  };

  assert.equal(summary.status, "done");
  assert.deepEqual(summary.phases, [{ index: 1, title: "scan" }]);
  assert.deepEqual(summary.traces, [
    { label: "selected files", phaseIndex: 1, phase: "scan", value: { count: 1, files: ["src/runtime/run.ts"] } },
  ]);
  assert.deepEqual(summary.messages, [
    { phaseIndex: 1, phase: "scan", agentId: 1, agentLabel: "worker", level: "debug", message: "worker: reading" },
  ]);
  assert.equal(summary.agents?.length, 1);
  const summaryAgent = summary.agents[0];
  assert.equal(summaryAgent.label, "worker");
  assert.equal(summaryAgent.status, "done");
  assert.deepEqual(summaryAgent.cost, { knownUsd: 0.02, complete: true });
  assert.equal(summaryAgent.outputPath, "/tmp/run/agent-1/output.json");
  assert.equal("message" in summaryAgent, false);
  assert.deepEqual(summary.llms, []);
  assert.equal(summary.resultPath, resultPath);
});

void test("agent event logs persist lifecycle metadata without transcript content", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-event-log-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-dir-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const logged = await createLoggedWorkflowAgentSession(project, project, {
    parentId: "parent-1",
    agentId: 1,
    agentKey: "agent-001-review",
    workflowName: "review",
    label: "review",
    phaseIndex: 1,
  }).finally(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  assert.equal(logged.eventsFile.startsWith(agentDir), true);

  logged.recordEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "streamed secret" },
  });
  logged.recordEvent({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "final transcript content" }],
      usage: { input: 10, output: 3 },
      provider: "openai-codex",
    },
  });
  logged.recordEvent({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "read",
    args: { path: "secret.md" },
    result: { content: [{ type: "text", text: "large tool output" }] },
    isError: false,
  });
  logged.recordEvent({
    type: "agent_end",
    messages: [{ role: "user" }, { role: "assistant" }],
    willRetry: false,
  });

  const text = await readFile(logged.eventsFile, "utf8");
  const events = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { event: Record<string, unknown> });

  assert.deepEqual(
    events.map(({ event }) => event.type),
    ["message_end", "tool_execution_end", "agent_end"],
  );
  assert.match(text, /"provider":"openai-codex"/);
  assert.match(text, /"messageCount":2/);
  assert.doesNotMatch(text, /streamed secret|final transcript content|secret\.md|large tool output/);
});

void test("session tokens parse provider usage aliases", async () => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-session-tokens-"));
  await writeFile(
    path.join(sessionDir, "workflow-agent-1.jsonl"),
    [
      JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2, cache_read_input_tokens: 500 } }),
      JSON.stringify({ message: { usage: { input_tokens: 5, output_tokens: 7, total_tokens: 900 } } }),
      JSON.stringify({ usage: { totalTokens: 1234, cacheRead: 1000 } }),
    ].join("\n"),
    "utf8",
  );

  assert.deepEqual(parseSessionTokens(sessionDir), {
    input: 8,
    cacheRead: 1500,
    cacheWrite: 0,
    output: 9,
    total: 17,
    cost: { knownUsd: 0, complete: false },
  });
});

void test("workflow_session_tokens_parse_actual_usage_from_session_file", async () => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-session-"));
  await writeFile(
    path.join(sessionDir, "session.jsonl"),
    [
      JSON.stringify({ type: "session", id: "session-1" }),
      JSON.stringify({ message: { usage: { inputTokens: 10, cacheRead: 2, outputTokens: 4, cost: { total: 0.01 } } } }),
      "not json",
      JSON.stringify({ usage: { input: 3, cacheRead: 1, output: 2, cost: { total: 0.02 } } }),
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(path.join(sessionDir, "events.jsonl"), `${JSON.stringify({ usage: { input: 100, output: 100 } })}\n`, "utf8");

  assert.deepEqual(parseSessionTokens(sessionDir), {
    input: 13,
    cacheRead: 3,
    cacheWrite: 0,
    output: 6,
    total: 19,
    cost: { knownUsd: 0.03, complete: true },
  });
});
