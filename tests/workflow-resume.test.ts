import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { WorkflowAgent } from "../src/runtime/types.ts";
import { workflowSessionDirectory } from "../src/workflow/run-storage.ts";
import { createExtensionHarness, waitForCondition, writeProjectWorkflow } from "./extension-harness.ts";
import { llmCompletion } from "./runtime-helpers.ts";

void test("resume_workflow stops replay when an effective agent request changes", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-resume-"));
  await writeProjectWorkflow(
    project,
    "resumable",
    `export const metadata = { name: "resumable", description: "Resume calls", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow(input) {
  const direct = await LLM("stable llm");
  const first = await agent("stable agent", { label: "first" });
  const second = await agent("changeable agent", { label: "second" });
  const terminal = await agent("failing terminal", { label: "terminal" });
  return { input, direct, first, second, terminal };
}`,
  );
  const agentPrompts: string[] = [];
  let failTerminal = true;
  let llmCalls = 0;
  const harness = createExtensionHarness({
    cwd: project,
    extensionDependencies: {
      createAgent: () => (prompt) => {
        agentPrompts.push(prompt);
        if (prompt === "failing terminal" && failTerminal) {
          failTerminal = false;
          return Promise.reject(new Error("planned failure"));
        }
        return Promise.resolve({ prompt });
      },
      createLLM: () => () => {
        llmCalls++;
        return Promise.resolve(llmCompletion("stable response"));
      },
    },
  });
  const runTool = harness.tools.get("run_workflow");
  const resumeTool = harness.tools.get("resume_workflow");
  assert.ok(runTool);
  assert.ok(resumeTool);

  const started = await runTool.execute("call-start", { name: "resumable", input: { value: 7 } }, undefined, undefined, harness.ctx);
  const runId = (started.details as { runId?: string }).runId;
  assert.ok(runId);
  await waitForCondition(() => harness.sentUserMessages.length === 1);

  await writeProjectWorkflow(
    project,
    "resumable",
    `export const metadata = { name: "resumable", description: "Resume calls", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow(input) {
  const direct = await LLM("stable llm");
  const first = await agent("stable agent", { label: "first changed" });
  const second = await agent("changeable agent", { label: "second" });
  const terminal = await agent("failing terminal", { label: "terminal" });
  return { input, direct, first, second, terminal };
}`,
  );

  const resumed = await resumeTool.execute("call-resume", { runId }, undefined, undefined, harness.ctx);
  assert.equal((resumed.details as { runId?: string }).runId, runId);
  await waitForCondition(() => harness.sentUserMessages.length === 2);

  assert.equal(llmCalls, 1);
  assert.deepEqual(agentPrompts, [
    "stable agent",
    "changeable agent",
    "failing terminal",
    "stable agent",
    "changeable agent",
    "failing terminal",
  ]);
  assert.match(String(harness.sentUserMessages[1]?.message), /"value": 7/);
  assert.equal(existsSync(workflowSessionDirectory(project, "test-session")), true);
  await assert.rejects(
    resumeTool.execute("call-resume-again", { runId }, undefined, undefined, harness.ctx),
    /cannot be resumed because its status is 'done'/,
  );
  await harness.sessionShutdown();
  assert.equal(existsSync(workflowSessionDirectory(project, "test-session")), false);
});

void test("resume_workflow stops replay when the adapter's effective LLM model changes", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-resume-model-"));
  await writeProjectWorkflow(
    project,
    "model-resume",
    `export const metadata = { name: "model-resume", description: "Resume model calls", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  await LLM("model-sensitive");
  throw new Error("planned workflow failure");
}`,
  );
  let effectiveModel = "model-a";
  let llmCalls = 0;
  const llm = Object.assign(
    () => {
      llmCalls++;
      return Promise.resolve(llmCompletion("response"));
    },
    { cacheContext: () => ({ model: effectiveModel }) },
  );
  const harness = createExtensionHarness({
    cwd: project,
    extensionDependencies: { createLLM: () => llm },
  });
  const runTool = harness.tools.get("run_workflow");
  const resumeTool = harness.tools.get("resume_workflow");
  assert.ok(runTool);
  assert.ok(resumeTool);
  const started = await runTool.execute("call-start", { name: "model-resume" }, undefined, undefined, harness.ctx);
  const runId = (started.details as { runId?: string }).runId;
  assert.ok(runId);
  await waitForCondition(() => harness.sentUserMessages.length === 1);

  effectiveModel = "model-b";
  await resumeTool.execute("call-resume", { runId }, undefined, undefined, harness.ctx);
  await waitForCondition(() => harness.sentUserMessages.length === 2);
  assert.equal(llmCalls, 2);
});

for (const primitive of ["parallel", "pipeline", "direct"] as const) {
  void test(`resume_workflow replays ${primitive} calls independently of completion order`, async () => {
    const project = await mkdtemp(path.join(tmpdir(), `pi-workflow-extension-resume-${primitive}-`));
    const body =
      primitive === "parallel"
        ? `await parallel(["slow", "fast"], async (item) => {
    await agent(\`first-\${item}\`);
    return agent(\`second-\${item}\`);
  });`
        : primitive === "pipeline"
          ? `await pipeline(["slow", "fast"], [
    (item) => agent(\`first-\${item}\`).then(() => item),
    (item) => agent(\`second-\${item}\`).then(() => item),
  ]);`
          : `await Promise.all(["slow", "fast"].map(async (item) => {
    await agent(\`first-\${item}\`);
    return agent(\`second-\${item}\`);
  }));`;
    await writeProjectWorkflow(
      project,
      "concurrent-resume",
      `export const metadata = { name: "concurrent-resume", description: "Resume concurrent calls", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  ${body}
  throw new Error("planned workflow failure");
}`,
    );
    const agentPrompts: string[] = [];
    const agent: WorkflowAgent = async (prompt) => {
      agentPrompts.push(prompt);
      if (prompt === "first-slow") await new Promise((resolve) => setTimeout(resolve, 20));
      return { prompt };
    };
    const harness = createExtensionHarness({
      cwd: project,
      extensionDependencies: { createAgent: () => agent },
    });
    const runTool = harness.tools.get("run_workflow");
    const resumeTool = harness.tools.get("resume_workflow");
    assert.ok(runTool);
    assert.ok(resumeTool);

    const started = await runTool.execute("call-start", { name: "concurrent-resume" }, undefined, undefined, harness.ctx);
    const runId = (started.details as { runId?: string }).runId;
    assert.ok(runId);
    await waitForCondition(() => harness.sentUserMessages.length === 1);
    assert.deepEqual(agentPrompts, ["first-slow", "first-fast", "second-fast", "second-slow"]);

    await writeProjectWorkflow(
      project,
      "concurrent-resume",
      `export const metadata = { name: "concurrent-resume", description: "Resume concurrent calls", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  ${body}
  return "done";
}`,
    );
    await resumeTool.execute("call-resume", { runId }, undefined, undefined, harness.ctx);
    await waitForCondition(() => harness.sentUserMessages.length === 2);
    assert.deepEqual(agentPrompts, ["first-slow", "first-fast", "second-fast", "second-slow"]);
  });
}

void test("resume_workflow keeps identical direct calls attached to their invocation order", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-resume-identical-"));
  const source = (
    ending: string,
  ): string => `export const metadata = { name: "identical-resume", description: "Resume identical calls", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  const values = await Promise.all([0, 1].map(() => agent("same request")));
  ${ending}
}`;
  await writeProjectWorkflow(project, "identical-resume", source(`throw new Error("planned workflow failure");`));
  let cacheContextCalls = 0;
  let agentCalls = 0;
  const agent: WorkflowAgent = () => Promise.resolve({ call: ++agentCalls });
  agent.cacheContext = async () => {
    cacheContextCalls++;
    if (cacheContextCalls === 1 || cacheContextCalls === 4) await new Promise((resolve) => setTimeout(resolve, 20));
    return { model: "same-model" };
  };
  const harness = createExtensionHarness({
    cwd: project,
    extensionDependencies: { createAgent: () => agent },
  });
  const runTool = harness.tools.get("run_workflow");
  const resumeTool = harness.tools.get("resume_workflow");
  assert.ok(runTool);
  assert.ok(resumeTool);
  const started = await runTool.execute("call-start", { name: "identical-resume" }, undefined, undefined, harness.ctx);
  const runId = (started.details as { runId?: string }).runId;
  assert.ok(runId);
  await waitForCondition(() => harness.sentUserMessages.length === 1);

  await writeProjectWorkflow(project, "identical-resume", source("return values;"));
  await resumeTool.execute("call-resume", { runId }, undefined, undefined, harness.ctx);
  await waitForCondition(() => harness.sentUserMessages.length === 2);

  assert.equal(agentCalls, 2);
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(workflowSessionDirectory(project, "test-session"), "runs", runId, "outputs", "final.json"), "utf8"),
    ),
    [{ call: 2 }, { call: 1 }],
  );
});

void test("resume_workflow atomically claims a failed run", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-resume-claim-"));
  await writeProjectWorkflow(
    project,
    "claim-resume",
    `export const metadata = { name: "claim-resume", description: "Claim resume", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  await agent("work");
  throw new Error("planned workflow failure");
}`,
  );
  const harness = createExtensionHarness({
    cwd: project,
    extensionDependencies: { createAgent: () => () => Promise.resolve({}) },
  });
  const runTool = harness.tools.get("run_workflow");
  const resumeTool = harness.tools.get("resume_workflow");
  assert.ok(runTool);
  assert.ok(resumeTool);
  const started = await runTool.execute("call-start", { name: "claim-resume" }, undefined, undefined, harness.ctx);
  const runId = (started.details as { runId?: string }).runId;
  assert.ok(runId);
  await waitForCondition(() => harness.sentUserMessages.length === 1);

  const results = await Promise.allSettled([
    resumeTool.execute("call-resume-one", { runId }, undefined, undefined, harness.ctx),
    resumeTool.execute("call-resume-two", { runId }, undefined, undefined, harness.ctx),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  await waitForCondition(() => harness.sentUserMessages.length === 2);
  await harness.sessionShutdown();
});
