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
