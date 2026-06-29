import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { WorkflowAgent } from "../src/runtime/types.ts";
import { runWorkflowFromDirectory } from "../src/runtime/run.ts";
import { writeWorkflow } from "./runtime-helpers.ts";

void test("workflow_agent_cwd_option_resolves_relative_paths_from_project_cwd", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const scratch = path.join(project, "scratch");
  await mkdir(scratch, { recursive: true });
  await writeWorkflow(
    project,
    "agent-cwd",
    `export const metadata = { name: "agent-cwd", description: "Agent cwd", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent("inspect", { label: "scratch", cwd: "scratch" });
}`,
  );
  const optionsSeen: unknown[] = [];
  const agent: WorkflowAgent = (_prompt, options) => {
    optionsSeen.push(options);
    return Promise.resolve(options.cwd);
  };

  const result = await runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "agent-cwd", input: {}, agent });

  assert.equal(result.result, scratch);
  assert.deepEqual(
    optionsSeen.map((options) => (options as { cwd?: unknown }).cwd),
    [scratch],
  );
  assert.equal(result.snapshot.agents[0]?.cwd, scratch);
});

void test("workflow_agent_schema_retries_and_returns_parsed_json", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "structured-agent",
    `export const metadata = { name: "structured-agent", description: "Structured agent", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Analyze", detail: "Return structured data" }] };
export default async function workflow() {
  return agent("Analyze the input", {
    label: "analysis",
    maxAttempts: 2,
    schema: {
      type: "object",
      properties: { ok: { type: "boolean" }, summary: { type: "string" } },
      required: ["ok", "summary"],
      additionalProperties: false,
    },
  });
}`,
  );
  const prompts: string[] = [];
  const optionsSeen: unknown[] = [];
  const agent: WorkflowAgent = (prompt, options) => {
    prompts.push(prompt);
    optionsSeen.push(options);
    return Promise.resolve(prompts.length === 1 ? '{"ok":"yes"}' : '{"ok":true,"summary":"done"}');
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "structured-agent",
    input: {},
    agent,
  });

  assert.deepEqual(result.result, { ok: true, summary: "done" });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /return only JSON that validates/);
  assert.match(prompts[1], /Previous response failed validation/);
  assert.deepEqual(
    optionsSeen.map((options) => (options as { schema?: unknown }).schema),
    [undefined, undefined],
  );
  assert.equal(result.snapshot.agents.length, 2);
  assert.deepEqual(result.snapshot.traces, [
    {
      label: "analysis schema validation failed",
      phaseIndex: 0,
      value: { attempt: 1, error: "/ must have required properties summary; /ok must be boolean" },
    },
  ]);
});

void test("workflow_emits_heartbeat_snapshots_while_agent_is_running", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "heartbeat",
    `export const metadata = { name: "heartbeat", description: "Heartbeat", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent("wait", { label: "slow" });
}`,
  );
  const agent: WorkflowAgent = () => new Promise((resolve) => setTimeout(() => resolve("done"), 1100));
  let snapshots = 0;

  await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "heartbeat",
    input: {},
    agent,
    onSnapshot: () => {
      snapshots++;
    },
  });

  assert.ok(snapshots >= 4);
});

void test("workflow_tracks_agent_progress_without_auto_logging_tool_names", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "progress-log",
    `export const metadata = { name: "progress-log", description: "Progress log", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent("work", { label: "worker" });
}`,
  );
  const agent: WorkflowAgent = (_prompt, _options, reportProgress) => {
    reportProgress({ statusMessage: "thinking" });
    reportProgress({ statusMessage: "read", toolCallCount: 1 });
    reportProgress({ statusMessage: "read", toolCallCount: 1 });
    reportProgress({ statusMessage: "bash", toolCallCount: 2 });
    reportProgress({ statusMessage: "done", toolCallCount: 2 });
    return Promise.resolve("ok");
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "progress-log",
    input: {},
    agent,
  });

  assert.deepEqual(
    result.snapshot.messages.map((message) => message.message),
    ["workflow progress-log started", "worker started", "worker done", "workflow completed"],
  );
  assert.equal(result.snapshot.agents[0]?.message, "done");
  assert.equal(result.snapshot.agents[0]?.toolCallCount, 2);
});

void test("workflow_passes_session_log_context_to_each_launched_agent", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "logged",
    `export const metadata = { name: "logged", description: "Logged agents", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  phase("scan");
  await agent("first", { label: "Review src/index.ts" });
  return agent("second", { label: "synthesis", reasoning: "medium" });
}`,
  );
  const sessionLogs: unknown[] = [];
  const agent: WorkflowAgent = (_prompt, options, reportProgress) => {
    sessionLogs.push(options.sessionLog);
    const sessionLog = options.sessionLog;
    if (!sessionLog) throw new Error("expected session log context");
    reportProgress({ sessionFile: `/tmp/${sessionLog.agentKey}.jsonl` });
    return Promise.resolve("ok");
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "logged",
    input: {},
    agent,
    agentLogParentId: "parent-1",
  });

  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.sessionFile),
    ["/tmp/phase-001-scan--agent-001-review-src-index.ts.jsonl", "/tmp/phase-001-scan--agent-002-synthesis.jsonl"],
  );
  assert.deepEqual(sessionLogs, [
    {
      parentId: "parent-1",
      agentId: 1,
      agentKey: "phase-001-scan--agent-001-review-src-index.ts",
      workflowName: "logged",
      label: "Review src/index.ts",
      phaseIndex: 1,
      phase: "scan",
    },
    {
      parentId: "parent-1",
      agentId: 2,
      agentKey: "phase-001-scan--agent-002-synthesis",
      workflowName: "logged",
      label: "synthesis",
      phaseIndex: 1,
      phase: "scan",
    },
  ]);
});
