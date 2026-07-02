import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { WorkflowAgent } from "../src/runtime/types.ts";
import { runWorkflowFromDirectory } from "../src/runtime/run.ts";
import { writeWorkflow } from "./runtime-helpers.ts";

void test("workflow_runs_with_core_primitives", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "review",
    `export const metadata = { name: "review", description: "Review files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ files }) {
  phase("fanout");
  const reviewed = await parallel(files, (file) => agent(readText("@workflow/prompt.txt") + file, { label: file }), { label: "file reviews" });
  return pipeline(reviewed, [async (item) => ({ item, cwd })]);
}`,
    { "prompt.txt": "review " },
  );
  const agent: WorkflowAgent = (prompt, options, reporter) => {
    reporter.progress({ inputTokenCount: 5, outputTokenCount: 2, model: "fake-model" });
    return Promise.resolve(`${options.label ?? "unlabeled"}:${prompt}`);
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "review",
    input: { files: ["a.ts", "b.ts"] },
    agent,
  });

  assert.deepEqual(result.result, [
    { item: "a.ts:review a.ts", cwd: project },
    { item: "b.ts:review b.ts", cwd: project },
  ]);
  assert.deepEqual(result.snapshot.plannedPhases, [{ title: "Run" }]);
  assert.deepEqual(result.snapshot.phases, ["fanout"]);
  assert.equal(result.snapshot.agents.length, 2);
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.inputTokenCount + agentSnapshot.outputTokenCount),
    [7, 7],
  );
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.outputTokenCount),
    [2, 2],
  );
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.fanOutId),
    [1, 1],
  );
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.model),
    ["fake-model", "fake-model"],
  );
  assert.deepEqual(result.snapshot.fanOuts, [{ id: 1, label: "file reviews", total: 2, running: 0, done: 2, error: 0 }]);
  assert.equal(result.snapshot.status, "done");
});

void test("workflow_pipeline_rejects_object_stages", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "pipeline-object-stage",
    `export const metadata = { name: "pipeline-object-stage", description: "Pipeline object stage", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return pipeline(["a"], [{ run: (item) => item.toUpperCase() }]);
}`,
  );
  const agent: WorkflowAgent = () => Promise.resolve("unused");

  await assert.rejects(
    runWorkflowFromDirectory({
      maxParallelAgents: 4,
      cwd: project,
      workflowName: "pipeline-object-stage",
      input: {},
      agent,
    }),
    /pipeline stages must be functions/,
  );
});

void test("workflow_writes_agent_and_final_outputs_to_output_directory", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const outputsDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-outputs-"));
  await writeWorkflow(
    project,
    "outputs",
    `export const metadata = { name: "outputs", description: "Write outputs", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  const child = await agent("return data", { label: "digest:01_retail_signal_audit" });
  return { child, ok: true };
}`,
  );
  const agent: WorkflowAgent = (_prompt, _options, reporter) => {
    reporter.progress({ toolCallCount: 1 });
    return Promise.resolve({ slug: "01_retail_signal_audit", score: 4 });
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "outputs",
    input: {},
    agent,
    outputsDir,
  });

  assert.equal(result.outputsDir, outputsDir);
  assert.equal(result.resultPath, path.join(outputsDir, "outputs", "final.json"));
  assert.equal(result.snapshot.agents[0]?.outputPath, path.join(outputsDir, "outputs", "agent-001-digest-01_retail_signal_audit.json"));
  assert.deepEqual(JSON.parse(await readFile(result.snapshot.agents[0]?.outputPath ?? "", "utf8")), {
    slug: "01_retail_signal_audit",
    score: 4,
  });
  assert.deepEqual(JSON.parse(await readFile(result.resultPath ?? "", "utf8")), {
    child: { slug: "01_retail_signal_audit", score: 4 },
    ok: true,
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(outputsDir, "manifest.json"), "utf8")), {
    workflowName: "outputs",
    status: "done",
    resultPath: path.join(outputsDir, "outputs", "final.json"),
    outputs: [
      {
        agentId: 1,
        label: "digest:01_retail_signal_audit",
        phaseIndex: 0,
        path: path.join(outputsDir, "outputs", "agent-001-digest-01_retail_signal_audit.json"),
      },
    ],
  });
});

void test("workflow_writes_valid_json_for_undefined_agent_and_final_outputs", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const outputsDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-outputs-"));
  await writeWorkflow(
    project,
    "undefined-outputs",
    `export const metadata = { name: "undefined-outputs", description: "Undefined outputs", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  await agent("return undefined", { label: "empty" });
  return undefined;
}`,
  );
  const agent: WorkflowAgent = () => Promise.resolve(undefined);

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "undefined-outputs",
    input: {},
    agent,
    outputsDir,
  });

  assert.equal(result.result, undefined);
  assert.match(result.snapshot.agents[0]?.outputPath ?? "", /agent-001-empty\.json$/);
  assert.equal(JSON.parse(await readFile(result.snapshot.agents[0]?.outputPath ?? "", "utf8")), null);
  assert.equal(JSON.parse(await readFile(result.resultPath ?? "", "utf8")), null);
});

void test("workflow_trace_records_structured_debug_values", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "traceable",
    `export const metadata = { name: "traceable", description: "Trace values", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Inspect" }] };
export default async function workflow({ items }) {
  phase("Inspect");
  trace("selected inputs", { count: items.length, first: items[0] });
  return "ok";
}`,
  );
  const agent: WorkflowAgent = () => Promise.resolve("unused");

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "traceable",
    input: { items: ["one", "two"] },
    agent,
  });

  assert.equal(result.result, "ok");
  assert.deepEqual(result.snapshot.traces, [
    { label: "selected inputs", phaseIndex: 1, phase: "Inspect", value: { count: 2, first: "one" } },
  ]);
  assert.deepEqual(result.snapshot.messages, [
    { phaseIndex: 0, level: "info", message: "workflow traceable started" },
    { phaseIndex: 1, phase: "Inspect", level: "info", message: "phase Inspect" },
    { phaseIndex: 1, phase: "Inspect", level: "debug", message: 'trace selected inputs {"count":2,"first":"one"}' },
    { phaseIndex: 1, phase: "Inspect", level: "info", message: "workflow completed" },
  ]);
});
