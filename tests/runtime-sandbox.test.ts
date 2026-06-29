import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { WorkflowAgent } from "../src/runtime/types.ts";
import { parseWorkflowSourceMetadata } from "../src/workflow/metadata.ts";
import { runWorkflowFromDirectory } from "../src/runtime/run.ts";
import { writeWorkflow } from "./runtime-helpers.ts";

void test("workflow_sandbox_blocks_ambient_authority_but_read_helpers_can_read_anywhere", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const outside = await mkdtemp(path.join(tmpdir(), "pi-workflow-readable-"));
  const absolutePath = path.join(outside, "absolute.txt");
  await mkdir(path.join(project, "fixtures"), { recursive: true });
  await writeFile(path.join(project, "fixtures", "project.txt"), "project", "utf8");
  await writeFile(absolutePath, "absolute", "utf8");
  const agent: WorkflowAgent = () => Promise.resolve("unused");
  await writeWorkflow(
    project,
    "process",
    `export const metadata = { name: "process", description: "Process access", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return process.cwd();
}`,
  );
  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "process", input: {}, agent }),
    /process is not defined/,
  );

  await writeWorkflow(
    project,
    "no-args-global",
    `export const metadata = { name: "no-args-global", description: "No args global", inputInstructions: "Use function parameters.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return args;
}`,
  );
  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "no-args-global", input: {}, agent }),
    /args is not defined/,
  );

  await writeWorkflow(
    project,
    "read-anywhere",
    `export const metadata = { name: "read-anywhere", description: "Read anywhere", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ absolutePath }) {
  return [readText("fixtures/project.txt"), readText(absolutePath), readJson("@workflow/data.json")];
}`,
    { "data.json": '{"workflow":true}' },
  );
  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "read-anywhere",
    input: { absolutePath },
    agent,
  });

  assert.deepEqual(result.result, ["project", "absolute", { workflow: true }]);

  await writeWorkflow(
    project,
    "prompt-escape",
    `export const metadata = { name: "prompt-escape", description: "Prompt escape", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return renderPrompt("../secret.txt", {});
}`,
  );
  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "prompt-escape", input: {}, agent }),
    /escapes workflow prompt directory/,
  );
});

void test("workflow_module_syntax_check_ignores_prompt_text", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const agent: WorkflowAgent = (prompt) => Promise.resolve(prompt);
  await writeWorkflow(
    project,
    "prompt-text",
    `export const metadata = { name: "prompt-text", description: "Prompt text", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent("Do not import the agent's code or write export default examples.", { label: "prompt text" });
}`,
  );

  const result = await runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "prompt-text", input: {}, agent });

  assert.equal(result.result, "Do not import the agent's code or write export default examples.");
});

void test("workflow_metadata_must_be_static", () => {
  assert.throws(
    () =>
      parseWorkflowSourceMetadata(
        `const name = "dynamic";
export const metadata = { name, description: "Dynamic", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() { return "ok"; }`,
        "dynamic",
      ),
    /static/,
  );
});

void test("workflow_module_syntax_check_blocks_actual_module_loads", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const agent: WorkflowAgent = () => Promise.resolve("unused");
  await writeWorkflow(
    project,
    "static-import",
    `import fs from "node:fs";
export const metadata = { name: "static-import", description: "Static import", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return fs.existsSync(".");
}`,
  );
  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "static-import", input: {}, agent }),
    /cannot import modules/,
  );

  await writeWorkflow(
    project,
    "dynamic-import",
    `export const metadata = { name: "dynamic-import", description: "Dynamic import", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return import("node:fs");
}`,
  );
  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "dynamic-import", input: {}, agent }),
    /cannot import modules/,
  );

  await writeWorkflow(
    project,
    "require",
    `export const metadata = { name: "require", description: "Require", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return require("node:fs");
}`,
  );
  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "require", input: {}, agent }),
    /cannot use require/,
  );
});
