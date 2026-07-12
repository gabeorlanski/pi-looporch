import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startBackgroundWorkflowRun } from "../src/workflow/background-runs.ts";
import { workflowAgentSessionLogParentDirectory } from "../src/session-logs.ts";
import type { WorkflowAgent } from "../src/runtime/types.ts";
import { readActiveWorkflowRuns } from "../src/workflow/active-runs.ts";

async function writeWorkflow(project: string, name: string, source: string): Promise<void> {
  const workflowDir = path.join(project, ".pi", "workflows", name);
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "workflow.js"), source, "utf8");
}

void test("background run returns early and writes outputs", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-background-"));
  await writeWorkflow(
    project,
    "slow",
    `export const metadata = { name: "slow", description: "Slow workflow", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  const child = await agent("wait", { label: "slow child" });
  return { child };
}`,
  );

  let releaseAgent: ((value: unknown) => void) | undefined;
  let finished = false;
  const agent: WorkflowAgent = () =>
    new Promise((resolve) => {
      releaseAgent = resolve;
    });

  const run = await startBackgroundWorkflowRun({
    runId: "run-test",
    cwd: project,
    workflowName: "slow",
    input: {},
    agent,
    maxParallelAgents: 1,
    ownerSessionId: "test-session",
  });
  void run.finished.then(() => {
    finished = true;
  });

  while (!releaseAgent) await new Promise((resolve) => setImmediate(resolve));

  assert.equal(finished, false);
  assert.match(run.outputsDir, /pi-workflow-run-test-/);
  assert.equal(run.snapshot()?.agents[0]?.status, "running");
  assert.deepEqual(JSON.parse(await readFile(path.join(run.outputsDir, "manifest.json"), "utf8")), {
    workflowName: "slow",
    status: "running",
    outputs: [],
  });

  releaseAgent({ ok: true });
  const result = await run.finished;

  assert.equal(finished, true);
  assert.equal(result.outputsDir, run.outputsDir);
  assert.match(result.sessionLogDir, /run-test/);
  assert.deepEqual(JSON.parse(await readFile(result.resultPath ?? "", "utf8")), { child: { ok: true } });
  const doneManifest = JSON.parse(await readFile(path.join(run.outputsDir, "manifest.json"), "utf8")) as { status?: unknown };
  assert.equal(doneManifest.status, "done");
});

void test("background run respects an aborted parent", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-background-"));
  await writeWorkflow(
    project,
    "aborted",
    `export const metadata = { name: "aborted", description: "Aborted workflow", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  await agent("must not run", { label: "blocked child" });
  return { ok: true };
}`,
  );

  const controller = new AbortController();
  controller.abort();
  let agentCalls = 0;
  const agent: WorkflowAgent = () => {
    agentCalls++;
    return Promise.resolve("unexpected");
  };

  const run = await startBackgroundWorkflowRun({
    runId: "run-aborted",
    cwd: project,
    workflowName: "aborted",
    input: {},
    agent,
    maxParallelAgents: 1,
    signal: controller.signal,
    ownerSessionId: "test-session",
  });

  await assert.rejects(run.finished, /Workflow aborted/);
  assert.equal(agentCalls, 0);
  assert.equal(run.snapshot(), undefined);
});

void test("background abort stops the child and clears its record", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-background-"));
  await writeWorkflow(
    project,
    "abort-running",
    `export const metadata = { name: "abort-running", description: "Abort running workflow", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  await agent("wait", { label: "running child" });
  return { ok: true };
}`,
  );

  let markChildStarted: () => void = () => undefined;
  const childStarted = new Promise<void>((resolve) => {
    markChildStarted = resolve;
  });
  let childAbortSeen = false;
  const agent: WorkflowAgent = (_prompt, options) =>
    new Promise((_resolve, reject) => {
      markChildStarted();
      options.signal?.addEventListener(
        "abort",
        () => {
          childAbortSeen = true;
          reject(new Error("child aborted"));
        },
        { once: true },
      );
    });
  const run = await startBackgroundWorkflowRun({
    runId: "run-abort-running",
    cwd: project,
    workflowName: "abort-running",
    input: {},
    agent,
    maxParallelAgents: 1,
    ownerSessionId: "test-session",
  });

  await childStarted;
  run.abort();

  await assert.rejects(run.finished, /child aborted/);
  assert.equal(childAbortSeen, true);
  assert.deepEqual(await readActiveWorkflowRuns(project), []);
  assert.deepEqual(JSON.parse(await readFile(path.join(run.outputsDir, "manifest.json"), "utf8")), {
    workflowName: "abort-running",
    status: "error",
    error: "child aborted",
    outputs: [],
  });
});

void test("background failure writes an error manifest", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-background-"));
  await writeWorkflow(
    project,
    "fail",
    `export const metadata = { name: "fail", description: "Fail workflow", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  await agent("fail", { label: "bad child" });
}`,
  );

  const agent: WorkflowAgent = () => Promise.reject(new Error("child exploded"));
  const run = await startBackgroundWorkflowRun({
    runId: "run-fail",
    cwd: project,
    workflowName: "fail",
    input: {},
    agent,
    maxParallelAgents: 1,
    ownerSessionId: "test-session",
  });

  await assert.rejects(run.finished, /child exploded/);
  assert.deepEqual(JSON.parse(await readFile(path.join(run.outputsDir, "manifest.json"), "utf8")), {
    workflowName: "fail",
    status: "error",
    error: "child exploded",
    outputs: [],
  });
});

void test("background body failure persists its terminal snapshot", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-background-"));
  await writeWorkflow(
    project,
    "body-fail",
    `export const metadata = { name: "body-fail", description: "Fail in workflow body", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  phase("body");
  throw new Error("body exploded");
}`,
  );

  const agent: WorkflowAgent = () => Promise.resolve("unused");
  const run = await startBackgroundWorkflowRun({
    runId: "run-body-fail",
    cwd: project,
    workflowName: "body-fail",
    input: {},
    agent,
    maxParallelAgents: 1,
    ownerSessionId: "test-session",
  });

  await assert.rejects(run.finished, /body exploded/);

  assert.equal(run.snapshot()?.status, "error");
  assert.deepEqual(
    run.snapshot()?.messages.map((message) => message.message),
    ["workflow body-fail started", "phase body", "workflow failed: body exploded"],
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(run.outputsDir, "manifest.json"), "utf8")), {
    workflowName: "body-fail",
    status: "error",
    error: "body exploded",
    outputs: [],
  });
  const summaryDir = workflowAgentSessionLogParentDirectory(project, "run-body-fail");
  const summary = JSON.parse(await readFile(path.join(summaryDir, "workflow-summary.json"), "utf8")) as {
    status?: unknown;
    messages?: { message?: unknown }[];
    error?: unknown;
  };
  assert.equal(summary.status, "error");
  assert.deepEqual(
    summary.messages?.map((message) => message.message),
    ["workflow body-fail started", "phase body", "workflow failed: body exploded"],
  );
  assert.equal(summary.error, "body exploded");
});
