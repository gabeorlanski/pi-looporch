import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { WorkflowAgent } from "../src/runtime/types.ts";
import { runWorkflowFromDirectory } from "../src/runtime/run.ts";
import { writeWorkflow } from "./runtime-helpers.ts";

void test("workflow_queues_parallel_items_over_the_max_parallel_cap", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "queue",
    `export const metadata = { name: "queue", description: "Queue fanout", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ items }) {
  return parallel(items, (item) => agent(item, { label: item }), { label: "queued work" });
}`,
  );
  let activeAgents = 0;
  let maxActiveAgents = 0;
  const agent: WorkflowAgent = async (_prompt, options) => {
    activeAgents++;
    maxActiveAgents = Math.max(maxActiveAgents, activeAgents);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeAgents--;
    return options.label;
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 2,
    cwd: project,
    workflowName: "queue",
    input: { items: ["one", "two", "three", "four"] },
    agent,
  });

  assert.equal(maxActiveAgents, 2);
  assert.deepEqual(result.result, ["one", "two", "three", "four"]);
  assert.deepEqual(result.snapshot.fanOuts, [{ id: 1, label: "queued work", total: 4, running: 0, done: 4, error: 0 }]);
});

void test("workflow_caps_direct_concurrent_agent_calls", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "direct-cap",
    `export const metadata = { name: "direct-cap", description: "Cap direct agent fanout", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ items }) {
  return Promise.all(items.map((item) => agent(item, { label: item })));
}`,
  );
  let activeAgents = 0;
  let maxActiveAgents = 0;
  const agent: WorkflowAgent = async (_prompt, options) => {
    activeAgents++;
    maxActiveAgents = Math.max(maxActiveAgents, activeAgents);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeAgents--;
    return options.label;
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 2,
    cwd: project,
    workflowName: "direct-cap",
    input: { items: ["one", "two", "three", "four"] },
    agent,
  });

  assert.equal(maxActiveAgents, 2);
  assert.deepEqual(result.result, ["one", "two", "three", "four"]);
});

void test("workflow_caps_agents_across_concurrent_fanouts", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "global-cap",
    `export const metadata = { name: "global-cap", description: "Cap concurrent fanouts", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  const left = parallel(["one", "two"], (item) => agent(item, { label: item }), { label: "left" });
  const right = parallel(["three", "four"], (item) => agent(item, { label: item }), { label: "right" });
  return Promise.all([left, right]);
}`,
  );
  let activeAgents = 0;
  let maxActiveAgents = 0;
  const agent: WorkflowAgent = async (_prompt, options) => {
    activeAgents++;
    maxActiveAgents = Math.max(maxActiveAgents, activeAgents);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeAgents--;
    return options.label;
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 2,
    cwd: project,
    workflowName: "global-cap",
    input: {},
    agent,
  });

  assert.equal(maxActiveAgents, 2);
  assert.deepEqual(result.result, [
    ["one", "two"],
    ["three", "four"],
  ]);
});

void test("workflow_abort_rejects_queued_agent_without_launching_it", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "queued-abort",
    `export const metadata = { name: "queued-abort", description: "Abort queued agent", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return Promise.all([
    agent("first", { label: "first" }),
    agent("second", { label: "second" }),
  ]);
}`,
  );
  const controller = new AbortController();
  const launchedLabels: unknown[] = [];
  const agent: WorkflowAgent = (_prompt, options) => {
    launchedLabels.push(options.label);
    return new Promise((resolve) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          resolve("aborted");
        },
        { once: true },
      );
    });
  };

  const run = runWorkflowFromDirectory({
    maxParallelAgents: 1,
    cwd: project,
    workflowName: "queued-abort",
    input: {},
    agent,
    signal: controller.signal,
  });
  while (launchedLabels.length === 0) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(run, /Workflow aborted/);
  assert.deepEqual(launchedLabels, ["first"]);
});
