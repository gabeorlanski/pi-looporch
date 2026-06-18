import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runWorkflowFromDirectory, type WorkflowAgent } from "../src/runtime.ts";

async function writeWorkflow(project: string, name: string, source: string, files: Record<string, string> = {}): Promise<void> {
  const workflowDir = path.join(project, ".pi", "workflows", name);
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "workflow.js"), source, "utf8");
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(workflowDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

void test("workflow_runs_with_core_primitives", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "review",
    `export const metadata = { name: "review", description: "Review files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  phase("fanout");
  const reviewed = await parallel(args.files, (file) => agent(readText("prompt.txt") + file, { label: file }), { label: "file reviews" });
  return pipeline(reviewed, [async (item) => ({ item, cwd })]);
}`,
    { "prompt.txt": "review " },
  );
  const agent: WorkflowAgent = (prompt, options, reportProgress) => {
    reportProgress({ tokenCount: 7 });
    return Promise.resolve(`${options.label ?? "unlabeled"}:${prompt}`);
  };

  const events: string[] = [];
  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "review",
    input: { files: ["a.ts", "b.ts"] },
    agent,
    onEvent: (event) => events.push(event.type),
  });

  assert.deepEqual(result.result, [
    { item: "a.ts:review a.ts", cwd: project },
    { item: "b.ts:review b.ts", cwd: project },
  ]);
  assert.deepEqual(result.snapshot.phases, ["fanout"]);
  assert.equal(result.snapshot.agents.length, 2);
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.tokenCount),
    [7, 7],
  );
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.outputTokenCount),
    [0, 0],
  );
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.fanOutId),
    [1, 1],
  );
  assert.deepEqual(result.snapshot.fanOuts, [{ id: 1, label: "file reviews", total: 2, running: 0, done: 2, error: 0 }]);
  assert.deepEqual(events, [
    "run_started",
    "phase",
    "fanout_started",
    "agent_started",
    "agent_progress",
    "agent_started",
    "agent_progress",
    "agent_done",
    "agent_done",
    "fanout_progress",
    "fanout_progress",
    "run_completed",
  ]);
});

void test("workflow_queues_parallel_items_over_the_max_parallel_cap", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "queue",
    `export const metadata = { name: "queue", description: "Queue fanout", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  return parallel(args.items, (item) => agent(item, { label: item }), { label: "queued work" });
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
    `export const metadata = { name: "direct-cap", description: "Cap direct agent fanout", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  return Promise.all(args.items.map((item) => agent(item, { label: item })));
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
    `export const metadata = { name: "global-cap", description: "Cap concurrent fanouts", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
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

void test("workflow_coerces_agent_output_to_json_schema", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "coerce",
    `export const metadata = { name: "coerce", description: "Coerce output", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
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
  assert.match(prompts[1], /Previous response failed validation/);
  assert.deepEqual(
    agentOptions.map((options) => (options as { tools?: unknown }).tools),
    [false, false],
  );
  assert.equal(result.snapshot.agents.length, 2);
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.label),
    ["extract result", "extract result"],
  );
});

void test("workflow_renders_project_prompt_template", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "templated",
    `export const metadata = { name: "templated", description: "Templated prompt", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  return agent(renderPrompt("review.txt", { file: args.file, focus: args.focus }), { label: "review" });
}`,
    { "prompts/review.txt": "Review {{file}} for {{focus}}." },
  );
  const agent: WorkflowAgent = (prompt, options) => Promise.resolve(`${options.label ?? "unlabeled"}:${prompt}`);

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "templated",
    input: { file: "src/index.ts", focus: "edge cases" },
    agent,
  });

  assert.equal(result.result, "review:Review src/index.ts for edge cases.");
});

void test("workflow_renders_prompt_template_from_external_workflow_root", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const workflowRoot = await mkdtemp(path.join(tmpdir(), "pi-workflow-root-"));
  const workflowDir = path.join(workflowRoot, "external-prompt");
  await mkdir(path.join(workflowDir, "prompts", "review"), { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "external-prompt", description: "External prompt", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  return renderPrompt("review/base.txt", { topic: args.topic });
}`,
    "utf8",
  );
  await writeFile(path.join(workflowDir, "prompts", "review", "base.txt"), "External {{topic}} prompt.", "utf8");
  const agent: WorkflowAgent = () => Promise.resolve("unused");

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "external-prompt",
    input: { topic: "template" },
    agent,
    workflowRoots: [workflowRoot],
  });

  assert.equal(result.result, "External template prompt.");
});

void test("workflow_does_not_read_legacy_sibling_prompt_template", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await mkdir(path.join(project, ".pi", "workflows", "legacy.prompts"), { recursive: true });
  await writeFile(path.join(project, ".pi", "workflows", "legacy.prompts", "review.txt"), "Legacy {{topic}} prompt.", "utf8");
  await writeWorkflow(
    project,
    "legacy",
    `export const metadata = { name: "legacy", description: "Legacy prompt", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  return renderPrompt("review.txt", { topic: args.topic });
}`,
  );
  const agent: WorkflowAgent = () => Promise.resolve("unused");

  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "legacy", input: { topic: "template" }, agent }),
    /Prompt template not found: review\.txt/,
  );
});

void test("workflow_mapreduce_coerces_items_maps_them_and_reduces_results", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "mapreduce",
    `export const metadata = { name: "mapreduce", description: "Map reduce", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
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
    `export const metadata = { name: "verifier", description: "Verify with rubric", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
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

void test("workflow_emits_heartbeat_snapshots_while_agent_is_running", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "heartbeat",
    `export const metadata = { name: "heartbeat", description: "Heartbeat", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  return agent("wait", { label: "slow" });
}`,
  );
  const agent: WorkflowAgent = () => new Promise((resolve) => setTimeout(() => resolve("done"), 1100));
  let snapshots = 0;

  await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "heartbeat",
    input: {},
    agent,
    onSnapshot: () => {
      snapshots++;
    },
  });

  assert.ok(snapshots >= 4);
});

void test("workflow_passes_session_log_context_to_each_launched_agent", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "logged",
    `export const metadata = { name: "logged", description: "Logged agents", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  phase("scan");
  await agent("first", { label: "Review src/index.ts" });
  return agent("second", { label: "synthesis", reasoning: "medium" });
}`,
  );
  const sessionLogs: unknown[] = [];
  const agent: WorkflowAgent = (_prompt, options, reportProgress) => {
    sessionLogs.push(options.sessionLog);
    const sessionLog = options.sessionLog;
    if (!sessionLog) throw new Error("expected session log context");
    reportProgress({ sessionFile: `/tmp/${sessionLog.agentKey}.jsonl` });
    return Promise.resolve("ok");
  };

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "logged",
    input: {},
    agent,
    agentLogParentId: "parent-1",
  });

  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.sessionFile),
    ["/tmp/phase-001-scan--agent-001-review-src-index.ts.jsonl", "/tmp/phase-001-scan--agent-002-synthesis.jsonl"],
  );
  assert.deepEqual(sessionLogs, [
    {
      parentId: "parent-1",
      agentId: 1,
      agentKey: "phase-001-scan--agent-001-review-src-index.ts",
      workflowName: "logged",
      label: "Review src/index.ts",
      phaseIndex: 1,
      phase: "scan",
    },
    {
      parentId: "parent-1",
      agentId: 2,
      agentKey: "phase-001-scan--agent-002-synthesis",
      workflowName: "logged",
      label: "synthesis",
      phaseIndex: 1,
      phase: "scan",
    },
  ]);
});

void test("workflow_sandbox_blocks_ambient_authority_and_file_escapes", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const agent: WorkflowAgent = () => Promise.resolve("unused");
  await writeWorkflow(
    project,
    "process",
    `export const metadata = { name: "process", description: "Process access", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
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
    "escape",
    `export const metadata = { name: "escape", description: "Escape access", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  return readText("../secret.txt");
}`,
  );
  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "escape", input: {}, agent }),
    /escapes workflow directory/,
  );

  await writeWorkflow(
    project,
    "prompt-escape",
    `export const metadata = { name: "prompt-escape", description: "Prompt escape", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
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
    `export const metadata = { name: "prompt-text", description: "Prompt text", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  return agent("Do not import the agent's code or write export default examples.", { label: "prompt text" });
}`,
  );

  const result = await runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "prompt-text", input: {}, agent });

  assert.equal(result.result, "Do not import the agent's code or write export default examples.");
});

void test("workflow_module_syntax_check_blocks_actual_module_loads", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const agent: WorkflowAgent = () => Promise.resolve("unused");
  await writeWorkflow(
    project,
    "static-import",
    `import fs from "node:fs";
export const metadata = { name: "static-import", description: "Static import", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
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
    `export const metadata = { name: "dynamic-import", description: "Dynamic import", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
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
    `export const metadata = { name: "require", description: "Require", inputInstructions: "Use the workflow function JSDoc and signature to resolve input." };
export default async function workflow() {
  return require("node:fs");
}`,
  );
  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "require", input: {}, agent }),
    /cannot use require/,
  );
});
