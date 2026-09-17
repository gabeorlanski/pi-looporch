import assert from "node:assert/strict";
import { mkdir, writeFile, mkdtemp, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { workflowLogReviewMessage } from "../src/log-review.ts";
import { workflowAgentSessionLogParentDirectory } from "../src/session/logs.ts";

void test("log review reports tokens, tools, and repeated commands", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-log-review-"));
  const sessionsRoot = await mkdtemp(path.join(tmpdir(), "pi-workflow-sessions-"));
  const runDir = workflowAgentSessionLogParentDirectory(project, "run-1", sessionsRoot);
  const firstAgentDir = path.join(runDir, "phase-001-scan--agent-001-worker-1");
  const secondAgentDir = path.join(runDir, "phase-001-scan--agent-002-worker-2");
  await Promise.all([mkdir(firstAgentDir, { recursive: true }), mkdir(secondAgentDir, { recursive: true })]);
  await writeFile(
    path.join(runDir, "workflow-summary.json"),
    `${JSON.stringify(
      {
        workflowName: "expensive",
        description: "Find cost sinks",
        phases: [{ index: 1, title: "scan" }],
        agents: [
          {
            id: 1,
            label: "worker 1",
            phase: "scan",
            inputTokenCount: 99_999,
            outputTokenCount: 88_888,
            toolCallCount: 77,
            sessionDir: firstAgentDir,
            sessionFile: path.join(firstAgentDir, "workflow-agent-1.jsonl"),
            eventsFile: path.join(firstAgentDir, "events.jsonl"),
          },
          {
            id: 2,
            label: "worker 2",
            phase: "scan",
            inputTokenCount: 99_999,
            outputTokenCount: 88_888,
            toolCallCount: 77,
            sessionDir: secondAgentDir,
            sessionFile: path.join(secondAgentDir, "workflow-agent-2.jsonl"),
            eventsFile: path.join(secondAgentDir, "events.jsonl"),
          },
        ],
        fanOuts: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await Promise.all([
    writeFile(
      path.join(firstAgentDir, "workflow-agent-1.jsonl"),
      `${JSON.stringify({ message: { usage: { input: 12000, output: 1000 }, content: [{ type: "toolCall", name: "bash", arguments: { command: "npm test" } }] } })}\n`,
      "utf8",
    ),
    writeFile(
      path.join(secondAgentDir, "workflow-agent-2.jsonl"),
      `${JSON.stringify({ message: { usage: { input: 2000, output: 500 }, content: [{ type: "toolCall", name: "bash", arguments: { command: "npm test" } }] } })}\n`,
      "utf8",
    ),
    writeFile(
      path.join(firstAgentDir, "events.jsonl"),
      [
        JSON.stringify({ event: { type: "tool_execution_start", toolCallId: "read-1", toolName: "read" } }),
        JSON.stringify({ event: { type: "tool_execution_start", toolCallId: "bash-1", toolName: "bash" } }),
        "",
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      path.join(secondAgentDir, "events.jsonl"),
      `${JSON.stringify({ event: { type: "tool_execution_start", toolCallId: "bash-2", toolName: "bash" } })}\n`,
      "utf8",
    ),
  ]);

  const message = await workflowLogReviewMessage({ cwd: project, target: runDir, sessionsRoot });

  assert.match(message, /Workflow log cost review: expensive/);
  assert.match(message, /Total: 15\.5k tokens \(14k input \/ 1\.5k output\)/);
  assert.match(message, /across 2 agents and 3 tool calls/);
  assert.match(message, /worker 1.*13k tokens/);
  assert.match(message, /read: 1 calls/);
  assert.match(message, /bash: 2 calls/);
  assert.match(message, /2× across 2 agent\(s\): `npm test`/);
  assert.match(message, /Run it once in setup and pass the artifact\/path to later agents/);
});

void test("log review uses the declared transcript instead of a newer session file", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-log-review-"));
  const sessionsRoot = await mkdtemp(path.join(tmpdir(), "pi-workflow-sessions-"));
  const runDir = workflowAgentSessionLogParentDirectory(project, "run-1", sessionsRoot);
  const agentDir = path.join(runDir, "phase-001-scan--agent-001-worker");
  const declaredSessionFile = path.join(agentDir, "workflow-agent-1.jsonl");
  await mkdir(agentDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(runDir, "workflow-summary.json"),
      `${JSON.stringify({
        workflowName: "declared",
        phases: [],
        agents: [
          {
            id: 1,
            label: "worker",
            sessionDir: agentDir,
            sessionFile: declaredSessionFile,
            eventsFile: path.join(agentDir, "events.jsonl"),
          },
        ],
      })}\n`,
      "utf8",
    ),
    writeFile(
      declaredSessionFile,
      `${JSON.stringify({ message: { usage: { input: 10, output: 2 }, content: [{ type: "toolCall", name: "bash", arguments: { command: "npm test" } }] } })}\n`,
      "utf8",
    ),
    writeFile(path.join(agentDir, "events.jsonl"), "", "utf8"),
    writeFile(
      path.join(agentDir, "later.jsonl"),
      `${JSON.stringify({ message: { usage: { input: 900_000, output: 100_000 }, content: [{ type: "toolCall", name: "bash", arguments: { command: "rm -rf project" } }] } })}\n`,
      "utf8",
    ),
  ]);

  const message = await workflowLogReviewMessage({ cwd: project, target: runDir, sessionsRoot });

  assert.match(message, /Total: 12 tokens \(10 input \/ 2 output\)/);
  assert.match(message, /`npm test`/);
  assert.doesNotMatch(message, /900k|rm -rf project/);
});

void test("workflow_log_review_defaults_to_the_genuinely_newest_project_summary", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-log-review-"));
  const sessionsRoot = await mkdtemp(path.join(tmpdir(), "pi-workflow-sessions-"));
  const olderRunDir = workflowAgentSessionLogParentDirectory(project, "run-older", sessionsRoot);
  const newerRunDir = workflowAgentSessionLogParentDirectory(project, "run-newer", sessionsRoot);
  await Promise.all([mkdir(olderRunDir, { recursive: true }), mkdir(newerRunDir, { recursive: true })]);
  const olderSummary = path.join(olderRunDir, "workflow-summary.json");
  const newerSummary = path.join(newerRunDir, "workflow-summary.json");
  await Promise.all([
    writeFile(olderSummary, `${JSON.stringify({ workflowName: "older", phases: [], agents: [], fanOuts: [] })}\n`, "utf8"),
    writeFile(newerSummary, `${JSON.stringify({ workflowName: "newer", phases: [], agents: [], fanOuts: [] })}\n`, "utf8"),
  ]);
  await Promise.all([utimes(olderSummary, new Date(1_000), new Date(1_000)), utimes(newerSummary, new Date(2_000), new Date(2_000))]);

  const message = await workflowLogReviewMessage({ cwd: project, target: "latest", sessionsRoot });

  assert.match(message, /Workflow log cost review: newer/);
  assert.doesNotMatch(message, /Workflow log cost review: older/);
});
