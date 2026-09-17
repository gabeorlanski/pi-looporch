import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startBackgroundWorkflowRun } from "../src/workflow/background-runs.ts";
import { readWorkflowSnapshot } from "../src/workflow/outputs.ts";
import { createAgentLaunchQueue } from "../src/runtime/queue.ts";
import { runParallel } from "../src/runtime/primitives/parallel.ts";
import type { ActiveWorkflowRuntime } from "../src/runtime/context.ts";
import type { WorkflowAgent, WorkflowLLM, WorkflowSnapshot } from "../src/runtime/types.ts";

void test("workflow abort waits for unawaited sibling agents to settle before recording the terminal state", async () => {
  const project = await workflowProject(
    "siblings",
    `export const metadata = { name: "siblings", description: "Wait for sibling calls", inputInstructions: "No input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return Promise.all([agent("fast"), agent("slow")]);
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
  await assert.rejects(run.finished, /fast agent aborted/);
  assert.equal((await readWorkflowSnapshot(run.outputsDir)).status, "aborted");
});

void test("parallel waits for every worker lane to settle after cancellation", async () => {
  const controller = new AbortController();
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    let workers = 0;
    markStarted = () => {
      workers++;
      if (workers === 2) resolve();
    };
  });
  let settleSlow: () => void = () => undefined;
  const parallel = runParallel(
    parallelRuntime(controller.signal),
    ["fast", "slow"],
    (item) => {
      markStarted();
      return new Promise<string>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => {
            if (item === "fast") reject(new Error("fast worker aborted"));
            else
              settleSlow = () => {
                reject(new Error("slow worker aborted"));
              };
          },
          { once: true },
        );
      });
    },
    undefined,
  );
  await started;

  let settled = false;
  void parallel.catch(() => {
    settled = true;
  });
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  settleSlow();
  await assert.rejects(parallel, /fast worker aborted|Workflow aborted/);
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

void test("workflow completion wins the abort race before final-output publication", async () => {
  const project = await workflowProject(
    "complete",
    `export const metadata = { name: "complete", description: "Complete immediately", inputInstructions: "No input.", phases: [{ title: "Done" }] };
export default async function workflow() {
  return { complete: true };
}`,
  );
  let abortAccepted: boolean | undefined;
  const run = await startBackgroundWorkflowRun({
    ...runOptions(project, "complete", () => Promise.reject(new Error("The completed workflow must not launch an agent."))),
    onBeforeComplete: () => {
      abortAccepted = run.abort();
    },
  });

  assert.deepEqual((await run.finished).result, { complete: true });
  assert.equal(abortAccepted, false);
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

function parallelRuntime(signal: AbortSignal): ActiveWorkflowRuntime {
  const snapshot: WorkflowSnapshot = {
    workflowName: "parallel",
    description: "parallel",
    plannedPhases: [],
    phases: [],
    traces: [],
    agents: [],
    llms: [],
    fanOuts: [],
    messages: [],
    status: "running",
  };
  return {
    options: {
      cwd: "/tmp",
      workflowName: "parallel",
      input: {},
      agent: () => Promise.reject(new Error("Parallel runtime must not launch an agent.")),
      llm: () => Promise.reject(new Error("Parallel runtime must not call an LLM.")),
      maxParallelAgents: 2,
      signal,
    },
    snapshot,
    agentLaunchQueue: createAgentLaunchQueue(2),
    executionCounters: new Map(),
    inFlightCalls: new Set(),
    emit: () => undefined,
  };
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
