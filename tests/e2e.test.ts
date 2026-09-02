import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startBackgroundWorkflowRun } from "../src/workflow/background-runs.ts";
import type { WorkflowAgent } from "../src/runtime/types.ts";

void test("arithmetic workflow returns the sum", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-e2e-"));
  const workflowDirectory = path.join(project, ".pi", "workflows", "add");
  await mkdir(workflowDirectory, { recursive: true });
  await writeFile(
    path.join(workflowDirectory, "workflow.js"),
    `export const metadata = { name: "add", description: "Add two numbers", inputInstructions: "Provide left and right numbers.", phases: [{ title: "Calculate" }] };
export default async function workflow({ left, right }) {
  phase("Calculate");
  return agent(JSON.stringify({ left, right }), { label: "addition" });
}`,
    "utf8",
  );

  const agent: WorkflowAgent = (prompt, _options, reporter) => {
    reporter.launched(prompt);
    const input = JSON.parse(prompt) as { left: number; right: number };
    reporter.progress({
      inputTokenCount: 1,
      outputTokenCount: 1,
      cost: { knownUsd: 0, complete: true },
      model: "deterministic-arithmetic",
    });
    return Promise.resolve({ sum: input.left + input.right });
  };

  const run = await startBackgroundWorkflowRun({
    runId: "add-42",
    cwd: project,
    workflowName: "add",
    input: { left: 19, right: 23 },
    agent,
    llm: () => Promise.reject(new Error("Arithmetic workflow must not call the LLM.")),
    maxParallelAgents: 1,
    ownerSessionId: "e2e-session",
    attempt: { kind: "new" },
  });
  assert.deepEqual((await run.finished).result, { sum: 42 });
});

void test("workflow agent concurrency respects the configured limit", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-e2e-"));
  const workflowDirectory = path.join(project, ".pi", "workflows", "bounded");
  await mkdir(workflowDirectory, { recursive: true });
  await writeFile(
    path.join(workflowDirectory, "workflow.js"),
    `export const metadata = { name: "bounded", description: "Bound agent launches", inputInstructions: "No input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return Promise.all(["one", "two", "three"].map((item) => agent(item)));
}`,
    "utf8",
  );

  let active = 0;
  let maximumActive = 0;
  const agent: WorkflowAgent = async (prompt, _options, reporter) => {
    reporter.launched(prompt);
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return prompt;
  };

  const run = await startBackgroundWorkflowRun({
    runId: "bounded-agents",
    cwd: project,
    workflowName: "bounded",
    input: {},
    agent,
    llm: () => Promise.reject(new Error("Bounded workflow must not call the LLM.")),
    maxParallelAgents: 1,
    ownerSessionId: "e2e-session",
    attempt: { kind: "new" },
  });

  assert.deepEqual((await run.finished).result, ["one", "two", "three"]);
  assert.equal(maximumActive, 1);
});

void test("resumed workflows replay successful agent and LLM calls", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-e2e-"));
  const workflowDirectory = path.join(project, ".pi", "workflows", "replay");
  const workflowPath = path.join(workflowDirectory, "workflow.js");
  await mkdir(workflowDirectory, { recursive: true });
  const metadata = `export const metadata = { name: "replay", description: "Replay successful calls", inputInstructions: "No input.", phases: [{ title: "Run" }] };`;
  await writeFile(
    workflowPath,
    `${metadata}
export default async function workflow() {
  const agentResult = await agent("collect");
  const llmResult = await LLM("summarize");
  throw new Error("retry me");
}`,
    "utf8",
  );

  let agentCalls = 0;
  let llmCalls = 0;
  const agent: WorkflowAgent = (prompt, _options, reporter) => {
    agentCalls++;
    reporter.launched(prompt);
    return Promise.resolve({ collected: prompt });
  };
  const llm = () => {
    llmCalls++;
    return Promise.resolve({
      text: "summary",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
      cost: { knownUsd: 0, complete: true },
    });
  };
  const runOptions = {
    runId: "replay-run",
    cwd: project,
    workflowName: "replay",
    input: {},
    agent,
    llm,
    maxParallelAgents: 1,
    ownerSessionId: "e2e-session",
  };
  const failed = await startBackgroundWorkflowRun({ ...runOptions, attempt: { kind: "new" } });
  await assert.rejects(failed.finished, /retry me/);

  await writeFile(
    workflowPath,
    `${metadata}
export default async function workflow() {
  return { agentResult: await agent("collect"), llmResult: await LLM("summarize") };
}`,
    "utf8",
  );
  const resumed = await startBackgroundWorkflowRun({
    ...runOptions,
    attempt: { kind: "resume", startedAt: 1, resumeCount: 1, releaseClaim: () => Promise.resolve() },
  });

  assert.deepEqual((await resumed.finished).result, {
    agentResult: { collected: "collect" },
    llmResult: {
      text: "summary",
      output: null,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
      model: null,
      provider: null,
      stopReason: null,
    },
  });
  assert.deepEqual({ agentCalls, llmCalls }, { agentCalls: 1, llmCalls: 1 });
});
