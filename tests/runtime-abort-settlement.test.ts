import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startBackgroundWorkflowRun } from "../src/workflow/background-runs.ts";
import { readWorkflowSnapshot } from "../src/workflow/outputs.ts";
import type { WorkflowAgent, WorkflowLLM } from "../src/runtime/types.ts";

void test("workflow abort waits for unawaited sibling agents to settle before recording the terminal state", async () => {
  const project = await workflowProject(
    "siblings",
    `export const metadata = { name: "siblings", description: "Wait for sibling calls", inputInstructions: "No input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return parallel(["fast", "slow"], (item) => agent(item));
}`,
  );
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    let launches = 0;
    markStarted = () => {
      launches++;
      if (launches === 2) resolve();
    };
  });
  let settleSlow: () => void = () => undefined;
  const agent: WorkflowAgent = (prompt, options, reporter) => {
    reporter.launched(prompt);
    markStarted();
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          if (prompt === "fast") reject(new Error("fast agent aborted"));
          else
            settleSlow = () => {
              reject(new Error("slow agent aborted"));
            };
        },
        { once: true },
      );
    });
  };
  const run = await startBackgroundWorkflowRun(runOptions(project, "siblings", agent));
  await started;

  let settled = false;
  void run.finished.catch(() => {
    settled = true;
  });
  run.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  settleSlow();
  await assert.rejects(run.finished, /fast agent aborted|slow agent aborted/);
  assert.equal((await readWorkflowSnapshot(run.outputsDir)).status, "aborted");
});

void test("workflow abort rejects queued launches before they start", async () => {
  const project = await workflowProject(
    "queued",
    `export const metadata = { name: "queued", description: "Queue agents", inputInstructions: "No input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return Promise.all([agent("first"), agent("second")]);
}`,
  );
  let releaseStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    releaseStarted = resolve;
  });
  const launches: string[] = [];
  const agent: WorkflowAgent = (prompt, options, reporter) => {
    launches.push(prompt);
    reporter.launched(prompt);
    releaseStarted();
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          reject(new Error("first agent aborted"));
        },
        { once: true },
      );
    });
  };
  const run = await startBackgroundWorkflowRun({ ...runOptions(project, "queued", agent), maxParallelAgents: 1 });
  await started;
  run.abort();
  await assert.rejects(run.finished, /Workflow aborted|first agent aborted/);
  assert.deepEqual(launches, ["first"]);
});

void test("workflow abort does not retry a late invalid LLM completion", async () => {
  const project = await workflowProject(
    "llm",
    `export const metadata = { name: "llm", description: "Wait for an LLM", inputInstructions: "No input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return LLM("summarize", { schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } });
}`,
  );
  let releaseRequest: () => void = () => undefined;
  let markRequested: () => void = () => undefined;
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  let requestCount = 0;
  const llm: WorkflowLLM = (request) => {
    requestCount++;
    markRequested();
    return new Promise((resolve) => {
      request.signal?.addEventListener(
        "abort",
        () => {
          releaseRequest = () => {
            resolve({
              text: "not valid JSON",
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
              cost: { knownUsd: 0, complete: true },
            });
          };
        },
        { once: true },
      );
    });
  };
  const run = await startBackgroundWorkflowRun({
    ...runOptions(project, "llm", () => Promise.reject(new Error("The LLM workflow must not launch an agent."))),
    llm,
  });
  await requested;
  run.abort();
  releaseRequest();
  await assert.rejects(run.finished, /Workflow aborted/);
  assert.equal(requestCount, 1);
  assert.equal((await readWorkflowSnapshot(run.outputsDir)).llms[0]?.status, "aborted");
});

async function workflowProject(name: string, source: string): Promise<string> {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-runtime-abort-"));
  const workflowDirectory = path.join(project, ".pi", "workflows", name);
  await mkdir(workflowDirectory, { recursive: true });
  await writeFile(path.join(workflowDirectory, "workflow.js"), source, "utf8");
  return project;
}

function runOptions(project: string, workflowName: string, agent: WorkflowAgent) {
  return {
    runId: `${workflowName}-run`,
    cwd: project,
    workflowName,
    input: {},
    agent,
    llm: () => Promise.reject(new Error("The workflow must not call the LLM.")),
    maxParallelAgents: 2,
    ownerSessionId: "session-a",
    attempt: { kind: "new" as const },
  };
}
