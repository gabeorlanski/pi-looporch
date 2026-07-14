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

void test("workflow_agent_schema_retries_and_returns_parsed_json", async () => {
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
  assert.match(prompts[0], /return exactly one JSON value that validates/);
  assert.match(prompts[0], /Analyze the input/);
  assert.match(prompts[1], /Repair the rejected response/);
  assert.match(prompts[1], /\{"ok":"yes"\}/);
  assert.doesNotMatch(prompts[1], /Schema-conforming example/);
  assert.doesNotMatch(prompts[1], /Task:\nAnalyze the input/);
  assert.deepEqual(
    optionsSeen.map((options) => (options as { schema?: unknown; tools?: unknown }).schema),
    [undefined, undefined],
  );
  assert.deepEqual(
    optionsSeen.map((options) => Array.from((options as { extensions?: string[] }).extensions ?? [])),
    [["./extensions/todo.ts"], []],
  );
  assert.deepEqual(
    optionsSeen.map((options) => Array.from((options as { tools?: string[] }).tools ?? [])),
    [["read", "todo_write"], []],
  );
  assert.equal(result.snapshot.agents.length, 2);
  assert.deepEqual(result.snapshot.traces, [
    {
      label: "analysis schema validation failed",
      phaseIndex: 0,
      value: {
        attempt: 1,
        error:
          'schema validation failed: / is missing required properties ["summary"]; received {"ok":"yes"}; /ok must be boolean; received "yes"',
        rejectedResponse: '"{\\"ok\\":\\"yes\\"}"',
      },
    },
  ]);
});

void test("structured agent preflights dynamic schemas before launching a child", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "invalid-dynamic-schema",
    `export const metadata = { name: "invalid-dynamic-schema", description: "Invalid schema", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  const schema = { type: "string", pattern: "[" };
  return agent("work", { schema });
}`,
  );
  let launches = 0;
  await assert.rejects(
    runWorkflowFromDirectory({
      maxParallelAgents: 4,
      cwd: project,
      workflowName: "invalid-dynamic-schema",
      input: {},
      agent: () => {
        launches++;
        return Promise.resolve("unused");
      },
    }),
    /schema is invalid/,
  );
  assert.equal(launches, 0);
});

void test("structured repair receives bounded task context when the first response is empty", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "empty-structured-agent",
    `export const metadata = { name: "empty-structured-agent", description: "Empty response", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent("Summarize the selected source without rerunning analysis.", { label: "summary", maxAttempts: 2, schema: { type: "string" } });
}`,
  );
  const prompts: string[] = [];
  const optionsSeen: unknown[] = [];
  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "empty-structured-agent",
    input: {},
    agent: (prompt, options) => {
      prompts.push(prompt);
      optionsSeen.push(options);
      return Promise.resolve(prompts.length === 1 ? undefined : '"done"');
    },
  });

  assert.equal(result.result, "done");
  assert.match(prompts[1] ?? "", /Original task context/);
  assert.match(prompts[1] ?? "", /Summarize the selected source/);
  assert.deepEqual(Array.from((optionsSeen[1] as { extensions?: string[] }).extensions ?? []), []);
  assert.deepEqual(Array.from((optionsSeen[1] as { tools?: string[] }).tools ?? []), []);
  assert.equal((result.snapshot.traces[0]?.value as { rejectedResponse?: unknown }).rejectedResponse, "undefined");
});

void test("structured agent retains rejected output artifacts", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const outputsDir = path.join(project, "outputs");
  await writeWorkflow(
    project,
    "structured-artifacts",
    `export const metadata = { name: "structured-artifacts", description: "Artifacts", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent("work", { label: "writer", maxAttempts: 2, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } });
}`,
  );
  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "structured-artifacts",
    input: {},
    outputsDir,
    agent: () => Promise.resolve('{"ok":"no"}'),
  }).catch((error: unknown) => error);
  assert.match(String(result), /schema validation/);
  const firstOutput = path.join(outputsDir, "outputs", "agent-001-writer.json");
  const secondOutput = path.join(outputsDir, "outputs", "agent-002-writer-repair-2.json");
  assert.equal(await readFile(firstOutput, "utf8"), '"{\\"ok\\":\\"no\\"}"\n');
  assert.equal(await readFile(secondOutput, "utf8"), '"{\\"ok\\":\\"no\\"}"\n');
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
  const agent: WorkflowAgent = () =>
    new Promise((resolve) =>
      setTimeout(() => {
        resolve("done");
      }, 1100),
    );
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
