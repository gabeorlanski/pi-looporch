import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { WorkflowAgent } from "../src/runtime/types.ts";
import { runWorkflowFromDirectory } from "../src/runtime/run.ts";
import { writeWorkflow } from "./runtime-helpers.ts";

void test("agent cwd resolves relative to the project", async () => {
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

void test("schema agent prepends a terminal contract", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "structured-agent",
    `export const metadata = { name: "structured-agent", description: "Structured agent", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Analyze", detail: "Return structured data" }] };
export default async function workflow() {
  return agent("Analyze the input", {
    label: "analysis",
    extensions: ["./extensions/todo.ts"],
    tools: ["read", "todo_write"],
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
  const agent: WorkflowAgent = (prompt) => {
    prompts.push(prompt);
    return Promise.resolve({
      message: null,
      name: "analysis",
      steps: 1,
      usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 },
      ok: true,
      summary: "done",
    });
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "structured-agent",
    input: {},
    agent,
  });

  assert.deepEqual(result.result, {
    message: null,
    name: "analysis",
    steps: 1,
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 },
    ok: true,
    summary: "done",
  });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? "", /^Use the StructuredOutput tool to finish this task\./);
  assert.match(prompts[0] ?? "", /"summary"/);
  assert.match(prompts[0] ?? "", /Analyze the input/);
  assert.equal(result.snapshot.agents.length, 1);
  assert.deepEqual(result.snapshot.traces, []);
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

void test("template tasks persist the agent launch prompt", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const outputsDir = path.join(project, "outputs");
  await writeWorkflow(
    project,
    "templated-prompt-artifact",
    `export const metadata = { name: "templated-prompt-artifact", description: "Template prompt artifact", inputInstructions: "No input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent({ template: "review.txt", values: { file: "src/index.ts" } }, { label: "review" });
}`,
    { "prompts/review.txt": "Review {{file}}." },
  );
  const prompts: string[] = [];
  const agent: WorkflowAgent = (prompt, _options, reporter) => {
    prompts.push(prompt);
    reporter.launched({ prompt });
    return Promise.resolve("ok");
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "templated-prompt-artifact",
    input: {},
    agent,
    outputsDir,
  });

  assert.deepEqual(prompts, ["Review src/index.ts."]);
  assert.equal(await readFile(result.snapshot.agents[0]?.promptPath ?? "", "utf8"), "Review src/index.ts.\n");
});

void test("workflow tracks agent prompt, tools, and output", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const outputsDir = path.join(project, "outputs");
  await writeWorkflow(
    project,
    "progress-log",
    `export const metadata = { name: "progress-log", description: "Progress log", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent("work", { label: "worker" });
}`,
  );
  const agent: WorkflowAgent = (_prompt, _options, reporter) => {
    reporter.launched({ prompt: "exact prompt sent to child" });
    reporter.progress({ statusMessage: "thinking" });
    reporter.progress({ statusMessage: "read", toolCallCount: 1, toolActivity: [{ name: "read", arguments: { path: "src/index.ts" } }] });
    reporter.progress({ statusMessage: "read", toolCallCount: 1, toolActivity: [{ name: "read", arguments: { path: "src/index.ts" } }] });
    reporter.progress({
      statusMessage: "bash",
      toolCallCount: 2,
      toolActivity: [
        { name: "read", arguments: { path: "src/index.ts" } },
        { name: "bash", arguments: { command: "npm test" } },
      ],
    });
    reporter.progress({
      statusMessage: "done",
      toolCallCount: 2,
      toolActivity: [
        { name: "read", arguments: { path: "src/index.ts" } },
        { name: "bash", arguments: { command: "npm test" } },
      ],
    });
    return Promise.resolve("ok");
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "progress-log",
    input: {},
    agent,
    outputsDir,
  });

  assert.deepEqual(
    result.snapshot.messages.map((message) => message.message),
    ["workflow progress-log started", "worker started", "worker done", "workflow completed"],
  );
  assert.equal(result.snapshot.agents[0]?.message, "done");
  assert.match(result.snapshot.agents[0]?.promptPath ?? "", /prompt\.txt$/);
  assert.match(result.snapshot.agents[0]?.activityPath ?? "", /activity\.jsonl$/);
  assert.match(result.snapshot.agents[0]?.outputPath ?? "", /agent-001-worker\.json$/);
  assert.equal(await readFile(result.snapshot.agents[0]?.promptPath ?? "", "utf8"), "exact prompt sent to child\n");
  assert.deepEqual(JSON.parse(await readFile(result.snapshot.agents[0]?.outputPath ?? "", "utf8")), "ok");
  assert.equal(result.snapshot.agents[0]?.toolCallCount, 2);
  assert.deepEqual(
    (await readFile(result.snapshot.agents[0]?.activityPath ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown),
    [
      { name: "read", arguments: { path: "src/index.ts" } },
      { name: "bash", arguments: { command: "npm test" } },
    ],
  );
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
  const agent: WorkflowAgent = (_prompt, options, reporter) => {
    sessionLogs.push(options.sessionLog);
    const sessionLog = options.sessionLog;
    if (!sessionLog) throw new Error("expected session log context");
    reporter.progress({ sessionFile: `/tmp/${sessionLog.agentKey}.jsonl` });
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
