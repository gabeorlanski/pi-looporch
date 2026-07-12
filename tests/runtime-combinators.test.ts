import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { WorkflowAgent } from "../src/runtime/types.ts";
import { runWorkflowFromDirectory } from "../src/runtime/run.ts";
import { writeWorkflow } from "./runtime-helpers.ts";

void test("workflow_coerces_agent_output_to_json_schema", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "coerce",
    `export const metadata = { name: "coerce", description: "Coerce output", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return coerce({
    schema: {
      type: "object",
      properties: { title: { type: "string" }, score: { type: "number" } },
      required: ["title", "score"],
      additionalProperties: false,
    },
    prompt: "Extract a title and score",
    label: "extract result",
    maxAttempts: 2,
  });
}`,
  );
  const agentOptions: unknown[] = [];
  const prompts: string[] = [];
  const agent: WorkflowAgent = (prompt, options) => {
    prompts.push(prompt);
    agentOptions.push(options);
    return Promise.resolve(prompts.length === 1 ? "not json" : '{"title":"Ready","score":4}');
  };

  const result = await runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "coerce", input: {}, agent });

  assert.deepEqual(result.result, { title: "Ready", score: 4 });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Repair the rejected response/);
  assert.match(prompts[1], /not json/);
  assert.deepEqual(
    agentOptions.map((options) => (options as { tools?: unknown }).tools),
    [false, false],
  );
  assert.equal(result.snapshot.agents.length, 2);
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.label),
    ["extract result", "extract result repair 2"],
  );
});

void test("mapreduce coerces, maps, and reduces items", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "mapreduce",
    `export const metadata = { name: "mapreduce", description: "Map reduce", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return mapreduce({
    inputPrompt: "Split {{topic}} into items",
    mapPrompt: "Map {{item}} for {{topic}} at {{index}}",
    reducePrompt: "Reduce {{results}} for {{topic}}",
    topic: "letters",
    label: "letter work",
    maxAttempts: 1,
  });
}`,
  );
  const prompts: string[] = [];
  const agent: WorkflowAgent = (prompt) => {
    prompts.push(prompt);
    if (prompt.includes("Split letters into items")) return Promise.resolve('{"items":["alpha","beta"]}');
    if (prompt === "Map alpha for letters at 0") return Promise.resolve("mapped alpha");
    if (prompt === "Map beta for letters at 1") return Promise.resolve("mapped beta");
    if (prompt === 'Reduce ["mapped alpha","mapped beta"] for letters') return Promise.resolve("reduced letters");
    return Promise.resolve(`unexpected: ${prompt}`);
  };

  const result = await runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "mapreduce", input: {}, agent });

  assert.equal(result.result, "reduced letters");
  assert.equal(prompts.length, 4);
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.label),
    ["letter work input", "letter work map 1", "letter work map 2", "letter work reduce"],
  );
  assert.deepEqual(result.snapshot.fanOuts, [{ id: 1, label: "letter work map", total: 2, running: 0, done: 2, error: 0 }]);
});

void test("workflow_verifier_runs_criterion_voters_and_reduces_votes", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "verifier",
    `export const metadata = { name: "verifier", description: "Verify with rubric", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return verifier({
    criteria: [
      { name: "accuracy", description: "Check facts", guidelines: "No hallucinations", reasoning: "quote evidence", voters: 2 },
      { name: "style", description: "Check style", guidelines: "Be concise", reasoning: "compare tone" },
    ],
    criteriaPrompt: "Vote {{voter}} on {{name}}: {{description}} / {{guidelines}} / {{reasoning}} for {{artifact}}",
    reducePrompt: "Reduce {{votes}} for {{artifact}}",
    artifact: "draft",
    label: "rubric",
  });
}`,
  );
  const prompts: string[] = [];
  const agent: WorkflowAgent = (prompt) => {
    prompts.push(prompt);
    if (prompt.startsWith("Reduce ")) return Promise.resolve("verified");
    return Promise.resolve(`vote: ${prompt}`);
  };

  const result = await runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "verifier", input: {}, agent });

  assert.equal(result.result, "verified");
  assert.deepEqual(prompts.slice(0, 3), [
    "Vote 1 on accuracy: Check facts / No hallucinations / quote evidence for draft",
    "Vote 2 on accuracy: Check facts / No hallucinations / quote evidence for draft",
    "Vote 1 on style: Check style / Be concise / compare tone for draft",
  ]);
  assert.match(prompts[3], /Reduce \[/);
  assert.match(prompts[3], /vote: Vote 1 on accuracy/);
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.label),
    ["rubric accuracy voter 1", "rubric accuracy voter 2", "rubric style voter 1", "rubric reduce"],
  );
  assert.deepEqual(result.snapshot.fanOuts, [{ id: 1, label: "rubric voters", total: 3, running: 0, done: 3, error: 0 }]);
});

void test("parallel records failures after remaining items finish", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "parallel-failure",
    `export const metadata = { name: "parallel-failure", description: "Parallel failure", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return parallel(["one", "bad", "two"], (item) => {
    trace("processed", item);
    if (item === "bad") throw new Error("bad item");
    return item.toUpperCase();
  }, { label: "items" });
}`,
  );
  const snapshots: Awaited<ReturnType<typeof runWorkflowFromDirectory>>["snapshot"][] = [];
  const agent: WorkflowAgent = () => Promise.resolve("unused");

  await assert.rejects(
    runWorkflowFromDirectory({
      maxParallelAgents: 2,
      cwd: project,
      workflowName: "parallel-failure",
      input: {},
      agent,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    }),
    /bad item/,
  );

  const finalSnapshot = snapshots.at(-1);
  assert.ok(finalSnapshot);
  assert.deepEqual(finalSnapshot.fanOuts, [{ id: 1, label: "items", total: 3, running: 0, done: 2, error: 1 }]);
  assert.deepEqual(
    finalSnapshot.traces.map((trace) => trace.value),
    ["one", "bad", "two"],
  );
});
