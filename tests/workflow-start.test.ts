import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareWorkflowRun } from "../src/workflow/start.ts";
import { writeWorkflow } from "./runtime-helpers.ts";

void test("prepared_workflow_run_uses_initial_runtime_snapshot_shape", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-start-"));
  const input = { files: ["src/a.ts"], focus: "auth" };
  await writeWorkflow(
    project,
    "snapshot",
    `export const metadata = { name: "snapshot", description: "Prepare snapshot", inputInstructions: "Use structured input.", phases: [{ title: "Collect", detail: "Read files" }] };
export default async function workflow(input) {
  return input;
}`,
  );

  const prepared = await prepareWorkflowRun({
    cwd: project,
    workflowName: "snapshot",
    input,
    agentDir: path.join(project, "agent-dir"),
  });
  input.files.push("src/b.ts");

  assert.deepEqual(prepared.initialSnapshot, {
    workflowName: "snapshot",
    description: "Prepare snapshot",
    plannedPhases: [{ title: "Collect", detail: "Read files" }],
    phases: [],
    traces: [],
    agents: [],
    llms: [],
    fanOuts: [],
    messages: [],
    status: "running",
    input: { files: ["src/a.ts"], focus: "auth" },
  });
});
