import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { WorkflowAgent } from "../src/runtime/types.ts";
import { runWorkflowFromDirectory } from "../src/runtime/run.ts";
import { unavailableLLM, writeWorkflow } from "./runtime-helpers.ts";

void test("mapreduce uses terminal items", async () => {
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
    extensions: ["./extensions/letters.ts"],
    tools: ["read", "letter_lookup"],
  });
}`,
  );
  const prompts: string[] = [];
  const agentOptions: unknown[] = [];
  const agent: WorkflowAgent = (prompt, options) => {
    prompts.push(prompt);
    agentOptions.push(options);
    const result = { name: options.label ?? "agent", steps: 1, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 } };
    if (prompt.includes("Split letters into items")) return Promise.resolve({ ...result, message: null, items: ["alpha", "beta"] });
    if (prompt === "Map alpha for letters at 0") return Promise.resolve({ ...result, message: "mapped alpha" });
    if (prompt === "Map beta for letters at 1") return Promise.resolve({ ...result, message: "mapped beta" });
    if (prompt.startsWith("Reduce [")) return Promise.resolve({ ...result, message: "reduced letters" });
    return Promise.resolve({ ...result, message: `unexpected: ${prompt}` });
  };

  const result = await runWorkflowFromDirectory({
    llm: unavailableLLM,
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "mapreduce",
    input: {},
    agent,
  });

  assert.deepEqual(result.result, {
    message: "reduced letters",
    name: "letter work reduce",
    steps: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
  });
  assert.equal(prompts.length, 4);
  assert.deepEqual(
    agentOptions.map((options) => Array.from((options as { extensions?: string[] }).extensions ?? [])),
    Array.from({ length: 4 }, () => ["./extensions/letters.ts"]),
  );
  assert.equal((agentOptions[0] as { schema?: unknown }).schema !== undefined, true);
  assert.deepEqual(
    agentOptions.map((options) => Array.from((options as { tools?: string[] }).tools ?? [])),
    Array.from({ length: 4 }, () => ["read", "letter_lookup"]),
  );
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
    extensions: ["./extensions/review.ts"],
    tools: ["read", "review_evidence"],
  });
}`,
  );
  const prompts: string[] = [];
  const agentOptions: unknown[] = [];
  const agent: WorkflowAgent = (prompt, options) => {
    prompts.push(prompt);
    agentOptions.push(options);
    if (prompt.startsWith("Reduce ")) return Promise.resolve("verified");
    return Promise.resolve(`vote: ${prompt}`);
  };

  const result = await runWorkflowFromDirectory({
    llm: unavailableLLM,
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "verifier",
    input: {},
    agent,
  });

  assert.equal(result.result, "verified");
  assert.deepEqual(
    agentOptions.map((options) => Array.from((options as { extensions?: string[] }).extensions ?? [])),
    Array.from({ length: 4 }, () => ["./extensions/review.ts"]),
  );
  assert.deepEqual(
    agentOptions.map((options) => Array.from((options as { tools?: string[] }).tools ?? [])),
    Array.from({ length: 4 }, () => ["read", "review_evidence"]),
  );
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
      llm: unavailableLLM,
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
