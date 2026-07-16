import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createWorkflowTools } from "../src/tools.ts";
import { workflowDesignGuidance } from "../src/authoring-guide.ts";
import { abortVisibleWorkflowRuns } from "../src/display/visible-workflow-run.ts";
import { defaultWorkflowDraftDirectory, defaultWorkflowDraftRoot } from "../src/workflow/drafts.ts";
import { workflowPrimitiveReference } from "../src/runtime/globals.ts";
import type { WorkflowAgent } from "../src/runtime/types.ts";

const generatedWorkflowDocstring = `/**
 * Purpose: generated test workflow.
 * Args: expects a prompt-like input object from the user.
 * Phase: single implicit phase for smoke coverage.
 * Agent: no child agent is launched unless the body adds one.
 * Result: returns a JSON-serializable smoke result.
 */
`;

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), "condition was not met before timeout");
}

void test("guidance tool returns index and focused guidance", async () => {
  const tool = createWorkflowTools({ cwd: process.cwd() }).find((candidate) => candidate.name === "workflow_design_guidance");
  assert.ok(tool);

  const all = await tool.execute("call-1", {}, undefined, undefined, {} as never);
  const allText = all.content[0]?.type === "text" ? all.content[0].text : "";
  assert.match(allText, /<workflow_guidance/);
  assert.match(allText, /overview/);
  assert.match(allText, /workflow-api/);
  assert.match(allText, /prompt-files/);
  assert.match(allText, /Supported workflow primitives \(generated from the runtime registry\)/);
  assertPrimitiveReferenceIsRendered(allText);
  assert.doesNotMatch(allText, /additionalProperties/);

  const overview = await tool.execute("call-2", { topic: "overview" }, undefined, undefined, {} as never);
  const overviewText = overview.content[0]?.type === "text" ? overview.content[0].text : "";
  assert.match(overviewText, /<workflow_guidance topic="overview">/);
  assert.match(overviewText, new RegExp(escapeRegExp(defaultWorkflowDraftRoot())));
  assert.match(overviewText, /prompts\/\*\.txt/);
  assertPrimitiveReferenceIsRendered(overviewText);

  const api = await tool.execute("call-3", { topic: "workflow-api" }, undefined, undefined, {} as never);
  const apiText = api.content[0]?.type === "text" ? api.content[0].text : "";
  assert.match(apiText, /Supported workflow primitives are rendered below from the runtime registry/);
  assert.match(apiText, /cannot import modules/);
  assertPrimitiveReferenceIsRendered(apiText);

  const promptFiles = await tool.execute("call-4", { topic: "prompt-files" }, undefined, undefined, {} as never);
  const promptFilesText = promptFiles.content[0]?.type === "text" ? promptFiles.content[0].text : "";
  assert.match(promptFilesText, /collision-prone outer envelopes/);
  assert.match(promptFilesText, /runtime instruction block also contains nested tags/);
  assert.match(promptFilesText, /&lt;workflow_instructions&gt;/);
  assert.match(promptFilesText, /&lt;workflow_task&gt;/);
  assert.match(promptFilesText, /&lt;workflow_context&gt;/);
  assert.match(promptFilesText, /&lt;structured_output_contract&gt;/);
  assert.match(promptFilesText, /&lt;structured_output_schema&gt;/);
  assert.match(promptFilesText, /&lt;operating_contract&gt;/);
  assert.match(promptFilesText, /&lt;goal_and_authority&gt;/);
  assert.match(promptFilesText, /&lt;evidence&gt;/);
  assert.match(promptFilesText, /&lt;decisions_and_scope&gt;/);
  assert.match(promptFilesText, /&lt;validation&gt;/);
  assert.match(promptFilesText, /&lt;output&gt;/);
  assert.match(promptFilesText, /&lt;stop_and_escalation&gt;/);
  assert.match(promptFilesText, /&lt;completion&gt;/);
  assert.match(promptFilesText, /&lt;task_contract&gt;/);
  assert.match(promptFilesText, /more than five distinct non-verifier prompts/);
  assert.match(promptFilesText, /Keep dynamic sections small/);
  assert.match(promptFilesText, /not every workflow input or global/);
  assert.match(promptFilesText, /\{\{file\}\}/);
  assert.match(promptFilesText, /Do not write JS template variables/);
  assert.match(promptFilesText, /Avoid unstructured global preamble dumps/);

  const structured = await tool.execute("call-5", { topic: "structured-outputs" }, undefined, undefined, {} as never);
  const structuredText = structured.content[0]?.type === "text" ? structured.content[0].text : "";
  assert.match(structuredText, /StructuredOutput/);
  assert.match(structuredText, /prepended/);
  assert.match(structuredText, /semantic/);
  assert.match(structuredText, /does not call it fails/);
  assert.match(structuredText, /control surface/);
  assert.match(structuredText, /JSONL\/artifact files/);
  assert.doesNotMatch(structuredText, /verifier\(/);
});

void test("every workflow guidance topic loads its prompt file", () => {
  for (const topic of [
    "overview",
    "workflow-api",
    "draft-directory",
    "prompt-files",
    "child-agents",
    "structured-outputs",
    "fanout",
    "verification",
    "artifacts",
  ]) {
    const guidance = workflowDesignGuidance(topic);
    assert.match(guidance, new RegExp(`<workflow_guidance topic="${topic}">`));
    assert.doesNotMatch(guidance, /\{\{(?:draftRoot|primitiveReference)\}\}/);
  }
  assertPrimitiveReferenceIsRendered(workflowDesignGuidance("overview"));
  assertPrimitiveReferenceIsRendered(workflowDesignGuidance("workflow-api"));
  assert.throws(() => workflowDesignGuidance("unknown"), /Unknown workflow design guidance topic/);
});

void test("run_workflow_tool_runs_existing_workflow", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const workflowDir = path.join(project, ".pi", "workflows", "echo");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "echo", description: "Echo input", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow(input) {
  return { input, agent: await agent("say hi", { label: "helper" }) };
}`,
    "utf8",
  );
  const agent: WorkflowAgent = (prompt, options) => Promise.resolve(`${options.label ?? "unlabeled"}:${prompt}`);
  const sentUserMessages: { message: string; options: unknown }[] = [];
  const tool = createWorkflowTools({
    cwd: project,
    agent,
    sendUserMessageForContext: () => (message, options) => sentUserMessages.push({ message, options }),
  }).find((candidate) => candidate.name === "run_workflow");
  assert.ok(tool);

  const updates: string[] = [];
  const notifications: string[] = [];
  const toolContext = {
    mode: "print",
    isIdle: () => true,
    sessionManager: {
      getSessionId: () => "tool-session",
    },
    ui: { notify: (message: string) => notifications.push(message) },
  } as never;
  const result = await tool.execute(
    "call-1",
    { name: "echo", input: { message: "hello" } },
    undefined,
    (partial) => {
      const content = partial.content[0];
      if (content.type === "text") updates.push(content.text);
    },
    toolContext,
  );

  const details = result.details as { workflowName: string; status: string; outputsDir: string; resultPath: string };
  assert.equal(details.workflowName, "echo");
  assert.equal(details.status, "running");
  assert.match(details.outputsDir, /pi-workflow-.*echo/);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Workflow echo started in the background/);
  await waitForCondition(() => updates.some((update) => update.includes("workflow echo") && update.includes("#1 helper")));
  await waitForCondition(() => sentUserMessages.length === 1);
  assert.deepEqual(sentUserMessages[0]?.options, undefined);
  assert.deepEqual(notifications, ["Workflow 'echo' complete."]);
  const completionHandoff = sentUserMessages[0]?.message ?? "";
  assert.match(completionHandoff, /<workflow_handoff event="completed">/);
  assert.match(completionHandoff, /<workflow_metadata>\n\{"workflowName":"echo"/);
  assert.match(completionHandoff, /<workflow_result>\nResult:\n\n```json/);
  assert.match(completionHandoff, /helper:say hi/);
  assert.match(completionHandoff, /- Workflow result: .*final\.json/);
  assert.match(completionHandoff, /- Workflow outputs: /);
  assert.match(completionHandoff, /- Workflow session logs: /);
  assert.deepEqual(JSON.parse(await readFile(path.join(details.outputsDir, "outputs", "final.json"), "utf8")), {
    input: { message: "hello" },
    agent: "helper:say hi",
  });
});

void test("run tool reports background failures", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const workflowDir = path.join(project, ".pi", "workflows", "fail");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "fail", description: "Fail input", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  throw { message: "tool exploded" };
}`,
    "utf8",
  );
  const agent: WorkflowAgent = () => Promise.resolve("unused");
  const sentUserMessages: { message: string; options: unknown }[] = [];
  const tool = createWorkflowTools({
    cwd: project,
    agent,
    sendUserMessageForContext: () => (message, options) => sentUserMessages.push({ message, options }),
  }).find((candidate) => candidate.name === "run_workflow");
  assert.ok(tool);
  const notifications: { message: string; type?: string }[] = [];
  const toolContext = {
    mode: "print",
    isIdle: () => true,
    sessionManager: {
      getSessionId: () => "tool-session",
    },
    ui: { notify: (message: string, type?: string) => notifications.push({ message, type }) },
  } as never;

  await tool.execute("call-1", { name: "fail" }, undefined, undefined, toolContext);
  await waitForCondition(() => notifications.some((notification) => notification.type === "error"));

  assert.deepEqual(notifications, [{ message: "Workflow 'fail' failed: tool exploded", type: "error" }]);
  assert.deepEqual(sentUserMessages, [
    {
      message:
        "<workflow_handoff event=\"failed\">\n<workflow_name>fail</workflow_name>\n<workflow_failure>Workflow 'fail' failed: tool exploded</workflow_failure>\n</workflow_handoff>",
      options: undefined,
    },
  ]);
});

void test("run tool skips notifications after shutdown", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const workflowDir = path.join(project, ".pi", "workflows", "slow");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "slow", description: "Slow workflow", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return { agent: await agent("wait", { label: "slow child" }) };
}`,
    "utf8",
  );
  let stale = false;
  let childStarted = false;
  let childAbortSeen = false;
  const agent: WorkflowAgent = (_prompt, options) =>
    new Promise((_resolve, reject) => {
      childStarted = true;
      options.signal?.addEventListener(
        "abort",
        () => {
          childAbortSeen = true;
          reject(new Error("child aborted"));
        },
        { once: true },
      );
    });
  const sentUserMessages: string[] = [];
  const tool = createWorkflowTools({
    cwd: project,
    agent,
    sendUserMessageForContext: () => (message) => {
      if (stale) throw new Error("stale user message");
      sentUserMessages.push(message);
    },
  }).find((candidate) => candidate.name === "run_workflow");
  assert.ok(tool);
  const notifications: string[] = [];
  const toolContext = {
    cwd: project,
    mode: "print",
    isIdle: () => true,
    sessionManager: {
      getSessionId: () => "tool-session",
    },
    ui: {
      notify: (message: string) => {
        if (stale) throw new Error("stale notify");
        notifications.push(message);
      },
    },
  } as never;

  await tool.execute("call-1", { name: "slow" }, undefined, undefined, toolContext);
  await waitForCondition(() => childStarted);
  await abortVisibleWorkflowRuns({
    cwd: project,
    sessionManager: {
      getSessionId: () => "tool-session",
    },
  } as never);
  stale = true;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(childAbortSeen, true);
  assert.deepEqual(notifications, []);
  assert.deepEqual(sentUserMessages, []);
});

void test("propose_workflow_tool_saves_draft_directory", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const draftDir = path.join(project, ".pi", "workflow-drafts", "summarize");
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}`;
  await mkdir(draftDir, { recursive: true });
  await writeFile(path.join(draftDir, "workflow.js"), source, "utf8");
  const workflowFile = path.join(project, ".pi", "workflows", "summarize", "workflow.js");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  const result = await tool.execute(
    "call-1",
    { name: "summarize", draftDir: path.relative(project, draftDir) },
    undefined,
    undefined,
    {} as never,
  );

  assert.deepEqual(result.details, { workflowName: "summarize", saved: true });
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Saved workflow 'summarize'/);
  assert.equal((await readFile(workflowFile, "utf8")).trim(), source);
});

void test("propose_workflow_tool_copies_draft_directory_assets", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const draftDir = path.join(project, ".pi", "workflow-drafts", "summarize");
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return renderPrompt("summary.txt", { prompt });
}`;
  await mkdir(path.join(draftDir, "prompts"), { recursive: true });
  await Promise.all([
    writeFile(path.join(draftDir, "workflow.js"), source, "utf8"),
    writeFile(path.join(draftDir, "prompts", "summary.txt"), "Summarize {{prompt}}", "utf8"),
  ]);
  const workflowDir = path.join(project, ".pi", "workflows", "summarize");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await tool.execute("call-1", { name: "summarize", draftDir: path.relative(project, draftDir) }, undefined, undefined, {} as never);

  assert.equal((await readFile(path.join(workflowDir, "workflow.js"), "utf8")).trim(), source);
  assert.equal(await readFile(path.join(workflowDir, "prompts", "summary.txt"), "utf8"), "Summarize {{prompt}}");
});

void test("propose_workflow_tool_saves_draft_directory_outside_project", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const draftDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-draft-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}`;
  await writeFile(path.join(draftDir, "workflow.js"), source, "utf8");
  const workflowFile = path.join(project, ".pi", "workflows", "summarize", "workflow.js");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  const result = await tool.execute("call-1", { name: "summarize", draftDir }, undefined, undefined, {} as never);

  assert.deepEqual(result.details, { workflowName: "summarize", saved: true });
  assert.equal((await readFile(workflowFile, "utf8")).trim(), source);
});

void test("propose_workflow_tool_uses_default_temp_draft_directory", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const name = `summarize-default-${String(process.pid)}-${String(Date.now())}`;
  const draftDir = defaultWorkflowDraftDirectory(name);
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "${name}", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}`;
  await mkdir(draftDir, { recursive: true });
  await writeFile(path.join(draftDir, "workflow.js"), source, "utf8");
  const workflowFile = path.join(project, ".pi", "workflows", name, "workflow.js");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  const result = await tool.execute("call-1", { name }, undefined, undefined, {} as never);

  assert.deepEqual(result.details, { workflowName: name, saved: true });
  assert.equal((await readFile(workflowFile, "utf8")).trim(), source);
});

void test("propose tool rejects drafts inside published workflows", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}`;
  const draftDir = path.join(project, ".pi", "workflows", "summarize");
  await mkdir(draftDir, { recursive: true });
  await writeFile(path.join(draftDir, "workflow.js"), source, "utf8");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await assert.rejects(
    tool.execute("call-1", { name: "summarize", draftDir: path.relative(project, draftDir) }, undefined, undefined, {} as never),
    /must not be inside, equal to, or an ancestor of \.pi\/workflows/,
  );
});

void test("propose tool rejects the published workflows directory", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const draftDir = path.join(project, ".pi", "workflows");
  await mkdir(draftDir, { recursive: true });
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await assert.rejects(
    tool.execute("call-1", { name: "summarize", draftDir: path.relative(project, draftDir) }, undefined, undefined, {} as never),
    /must not be inside, equal to, or an ancestor of \.pi\/workflows/,
  );
});

void test("propose tool rejects draft directories containing workflows", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}`;
  await mkdir(path.join(project, ".pi", "workflows"), { recursive: true });
  await writeFile(path.join(project, "workflow.js"), source, "utf8");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await assert.rejects(
    tool.execute("call-1", { name: "summarize", draftDir: "." }, undefined, undefined, {} as never),
    /must not be inside, equal to, or an ancestor of \.pi\/workflows/,
  );
});

void test("propose_workflow_tool_rejects_draft_without_docstring", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const draftDir = path.join(project, ".pi", "workflow-drafts", "summarize");
  const source = `export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}`;
  await mkdir(draftDir, { recursive: true });
  await writeFile(path.join(draftDir, "workflow.js"), source, "utf8");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await assert.rejects(
    tool.execute("call-2", { name: "summarize", draftDir: path.relative(project, draftDir) }, undefined, undefined, {} as never),
    /must start with a JSDoc docstring/,
  );
});

void test("propose workflow rejects an unknown child agent tool before replacing a workflow", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const draftDir = path.join(project, ".pi", "workflow-drafts", "summarize");
  const published = path.join(project, ".pi", "workflows", "summarize", "workflow.js");
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent("work", { tools: ["reed"] });
}`;
  await mkdir(path.dirname(published), { recursive: true });
  await writeFile(published, "published workflow", "utf8");
  await mkdir(draftDir, { recursive: true });
  await writeFile(path.join(draftDir, "workflow.js"), source, "utf8");
  const tool = createWorkflowTools({
    cwd: project,
    agentCapabilityCatalog: () =>
      Promise.resolve({
        availableExtensions: [],
        baseToolNames: ["bash", "read"],
        loadErrors: [],
      }),
  }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await assert.rejects(
    tool.execute(
      "call-invalid-tools",
      { name: "summarize", draftDir: path.relative(project, draftDir) },
      undefined,
      undefined,
      {} as never,
    ),
    (error: unknown) => {
      assert.match(String(error), /propose_workflow rejected workflow 'summarize': invalid child-agent capabilities/);
      assert.match(String(error), /workflow\.js:\d+:\d+ agent tools\[0\] "reed"/);
      assert.match(String(error), /Unknown tool\. Available tools: bash, read/);
      assert.match(String(error), /No workflow files were saved\./);
      return true;
    },
  );
  assert.equal(await readFile(published, "utf8"), "published workflow");
});

function assertPrimitiveReferenceIsRendered(text: string): void {
  for (const primitive of workflowPrimitiveReference()) {
    assert.match(text, new RegExp(`- ${escapeRegExp(primitive.signature)}: ${escapeRegExp(primitive.summary)}`));
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
