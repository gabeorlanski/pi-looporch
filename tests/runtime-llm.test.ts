import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { workflowPrimitiveReference } from "../src/runtime/globals.ts";
import { runWorkflowFromDirectory } from "../src/runtime/run.ts";
import type { WorkflowSnapshot } from "../src/runtime/types.ts";
import { llmCompletion, writeWorkflow } from "./runtime-helpers.ts";

void test("generated primitive docs expose LLM", () => {
  assert.deepEqual(
    workflowPrimitiveReference().filter((entry) => entry.name === "LLM"),
    [
      {
        primitive: "LLM",
        name: "LLM",
        signature: "LLM(prompt, options?)",
        summary: "Makes one generation-only call with optional model, reasoning, system instructions, prior messages, and schema.",
      },
    ],
  );
});

void test("LLM returns text without launching an agent", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "direct-llm",
    `export const metadata = { name: "direct-llm", description: "Direct completion", inputInstructions: "No input.", phases: [{ title: "Generate" }] };
export default async function workflow() {
  return LLM("Summarize the release.");
}`,
  );
  const requests: unknown[] = [];
  const outputsDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-outputs-"));

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "direct-llm",
    input: {},
    outputsDir,
    agent: () => Promise.resolve("unused"),
    llm: (request: unknown) => {
      requests.push(request);
      return Promise.resolve({
        text: "Release summary",
        usage: { input: 12, output: 3, cacheRead: 2, cacheWrite: 0, total: 17 },
        cost: { knownUsd: 0.04, complete: true },
        model: "active-model",
        provider: "active-provider",
        stopReason: "done",
      });
    },
  });

  assert.deepEqual(requests, [
    {
      messages: [{ role: "user", content: "Summarize the release." }],
    },
  ]);
  assert.deepEqual(result.result, {
    text: "Release summary",
    output: null,
    usage: { input: 12, output: 3, cacheRead: 2, cacheWrite: 0, total: 17 },
    model: "active-model",
    provider: "active-provider",
    stopReason: "done",
  });
  assert.deepEqual(result.snapshot.agents, []);
  const llm = result.snapshot.llms[0];
  assert.equal(llm.status, "done");
  assert.equal(llm.inputTokenCount, 12);
  assert.equal(llm.cacheReadTokenCount, 2);
  assert.equal(llm.outputTokenCount, 3);
  assert.deepEqual(llm.cost, { knownUsd: 0.04, complete: true });
  assert.equal(llm.model, "active-model");
  assert.equal(llm.provider, "active-provider");
  assert.deepEqual(JSON.parse(await readFile(llm.promptPath ?? "", "utf8")), {
    messages: [{ role: "user", content: "Summarize the release." }],
  });
  const persistedOutput = JSON.parse(await readFile(llm.outputPath ?? "", "utf8")) as { text: unknown };
  assert.equal(persistedOutput.text, "Release summary");
});

void test("LLM passes ordered messages to the model API", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "message-history-llm",
    `export const metadata = { name: "message-history-llm", description: "Completion with message history", inputInstructions: "No input.", phases: [{ title: "Generate" }] };
export default async function workflow() {
  return LLM("Current question", {
    system: "Be concise.",
    messages: [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
    ],
  });
}`,
  );
  const requests: unknown[] = [];

  await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "message-history-llm",
    input: {},
    agent: () => Promise.resolve("unused"),
    llm: (request: unknown) => {
      requests.push(request);
      return Promise.resolve(llmCompletion("answer"));
    },
  });

  assert.deepEqual(requests, [
    {
      system: "Be concise.",
      messages: [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: "Current question" },
      ],
    },
  ]);
});

void test("LLM passes model and reasoning selection", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "context-llm",
    `export const metadata = { name: "context-llm", description: "Context completion", inputInstructions: "No input.", phases: [{ title: "Generate" }] };
export default async function workflow() {
  return LLM("Current question", {
    system: "System instructions",
    messages: [
      { role: "user", content: "First" },
      { role: "assistant", content: "Second" },
    ],
    model: "workflow-model",
    reasoning: "high",
  });
}`,
  );
  const requests: unknown[] = [];

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "context-llm",
    input: {},
    agent: () => Promise.resolve("unused"),
    llm: (request) => {
      requests.push(request);
      return Promise.resolve(llmCompletion("answer"));
    },
  });

  assert.deepEqual(requests, [
    {
      system: "System instructions",
      model: "workflow-model",
      reasoning: "high",
      messages: [
        { role: "user", content: "First" },
        { role: "assistant", content: "Second" },
        { role: "user", content: "Current question" },
      ],
    },
  ]);
  assert.equal(result.snapshot.llms[0].model, "workflow-model");
  assert.equal(result.snapshot.llms[0].reasoning, "high");
});

void test("LLM returns validated structured output", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "structured-llm",
    `export const metadata = { name: "structured-llm", description: "Structured completion", inputInstructions: "No input.", phases: [{ title: "Generate" }] };
export default async function workflow() {
  return LLM("Classify the release.", {
    schema: {
      type: "object",
      properties: { stable: { type: "boolean" }, summary: { type: "string" } },
      required: ["stable", "summary"],
      additionalProperties: false,
    },
  });
}`,
  );

  const requests: unknown[] = [];
  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "structured-llm",
    input: {},
    agent: () => Promise.resolve("unused"),
    llm: (request) => {
      requests.push(request);
      return Promise.resolve(
        llmCompletion('{"stable":true,"summary":"ready"}', {
          usage: { input: 9, output: 5, cacheRead: 0, cacheWrite: 0, total: 14 },
        }),
      );
    },
  });

  assert.deepEqual(requests, [
    {
      system:
        'Return only one JSON value matching this schema. Do not use Markdown fences.\n{"type":"object","properties":{"stable":{"type":"boolean"},"summary":{"type":"string"}},"required":["stable","summary"],"additionalProperties":false}',
      messages: [{ role: "user", content: "Classify the release." }],
    },
  ]);
  assert.deepEqual(result.result, {
    text: '{"stable":true,"summary":"ready"}',
    output: { stable: true, summary: "ready" },
    usage: { input: 9, output: 5, cacheRead: 0, cacheWrite: 0, total: 14 },
    model: null,
    provider: null,
    stopReason: null,
  });
});

void test("LLM rejects malformed JSON without repair", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "malformed-llm",
    `export const metadata = { name: "malformed-llm", description: "Malformed completion", inputInstructions: "No input.", phases: [{ title: "Generate" }] };
export default async function workflow() {
  return LLM("Return JSON.", { schema: { type: "object", properties: {}, additionalProperties: false } });
}`,
  );
  let calls = 0;
  let finalSnapshot: WorkflowSnapshot | undefined;

  await assert.rejects(
    runWorkflowFromDirectory({
      maxParallelAgents: 4,
      cwd: project,
      workflowName: "malformed-llm",
      input: {},
      agent: () => Promise.resolve("unused"),
      llm: () => {
        calls++;
        return Promise.resolve(
          llmCompletion("not json", {
            usage: { input: 8, output: 2, cacheRead: 1, cacheWrite: 0, total: 10 },
          }),
        );
      },
      onSnapshot: (snapshot) => {
        finalSnapshot = snapshot;
      },
    }),
    SyntaxError,
  );
  assert.equal(calls, 1);
  assert.ok(finalSnapshot);
  assert.equal(finalSnapshot.llms[0].status, "error");
  assert.equal(finalSnapshot.llms[0].inputTokenCount, 8);
  assert.equal(finalSnapshot.llms[0].outputTokenCount, 2);
});

void test("LLM rejects schema mismatches without repair", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "invalid-llm",
    `export const metadata = { name: "invalid-llm", description: "Invalid completion", inputInstructions: "No input.", phases: [{ title: "Generate" }] };
export default async function workflow() {
  return LLM("Return JSON.", {
    schema: {
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
      additionalProperties: false,
    },
  });
}`,
  );
  let calls = 0;

  await assert.rejects(
    runWorkflowFromDirectory({
      maxParallelAgents: 4,
      cwd: project,
      workflowName: "invalid-llm",
      input: {},
      agent: () => Promise.resolve("unused"),
      llm: () => {
        calls++;
        return Promise.resolve(llmCompletion('{"count":"many"}'));
      },
    }),
    /LLM structured output does not match its schema/,
  );
  assert.equal(calls, 1);
});

void test("LLM requires a prompt", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "missing-llm-prompt",
    `export const metadata = { name: "missing-llm-prompt", description: "Missing prompt", inputInstructions: "No input.", phases: [{ title: "Generate" }] };
export default async function workflow() {
  return LLM();
}`,
  );
  let called = false;

  await assert.rejects(
    runWorkflowFromDirectory({
      maxParallelAgents: 4,
      cwd: project,
      workflowName: "missing-llm-prompt",
      input: {},
      agent: () => Promise.resolve("unused"),
      llm: () => {
        called = true;
        return Promise.resolve(llmCompletion("unused"));
      },
    }),
    /LLM prompt must be a string/,
  );
  assert.equal(called, false);
});

void test("LLM validates prior messages", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "bad-llm-message",
    `export const metadata = { name: "bad-llm-message", description: "Bad message", inputInstructions: "No input.", phases: [{ title: "Generate" }] };
export default async function workflow() {
  return LLM("Question", { messages: [{ role: "system", content: "hidden override" }] });
}`,
  );
  let called = false;

  await assert.rejects(
    runWorkflowFromDirectory({
      maxParallelAgents: 4,
      cwd: project,
      workflowName: "bad-llm-message",
      input: {},
      agent: () => Promise.resolve("unused"),
      llm: () => {
        called = true;
        return Promise.resolve(llmCompletion("unused"));
      },
    }),
    /LLM messages\[0\] role must be user or assistant/,
  );
  assert.equal(called, false);
});

void test("LLM cancellation rejects the workflow", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "cancel-llm",
    `export const metadata = { name: "cancel-llm", description: "Cancelled completion", inputInstructions: "No input.", phases: [{ title: "Generate" }] };
export default async function workflow() {
  await LLM("Wait for cancellation.");
  return "continued";
}`,
  );
  const controller = new AbortController();
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const run = runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "cancel-llm",
    input: {},
    agent: () => Promise.resolve("unused"),
    signal: controller.signal,
    llm: (request) =>
      new Promise((_resolve, reject) => {
        markStarted?.();
        request.signal?.addEventListener(
          "abort",
          () => {
            reject(new Error("direct call aborted"));
          },
          { once: true },
        );
      }),
  });

  await started;
  controller.abort();

  await assert.rejects(run, /direct call aborted/);
});

void test("LLM does not consume agent concurrency", { timeout: 1000 }, async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "concurrent-llm",
    `export const metadata = { name: "concurrent-llm", description: "Concurrent completion", inputInstructions: "No input.", phases: [{ title: "Generate" }] };
export default async function workflow() {
  const child = agent("Wait for the direct call.", { label: "only child" });
  const direct = await LLM("Run beside the child.");
  return { direct, child: await child };
}`,
  );
  let releaseAgent: (() => void) | undefined;
  let markAgentStarted: (() => void) | undefined;
  const agentStarted = new Promise<void>((resolve) => {
    markAgentStarted = resolve;
  });
  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 1,
    cwd: project,
    workflowName: "concurrent-llm",
    input: {},
    agent: () =>
      new Promise((resolve) => {
        releaseAgent = () => {
          resolve("child done");
        };
        markAgentStarted?.();
      }),
    llm: async () => {
      await agentStarted;
      releaseAgent?.();
      return llmCompletion("direct done");
    },
  });

  assert.deepEqual(result.result, {
    direct: {
      text: "direct done",
      output: null,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      model: null,
      provider: null,
      stopReason: null,
    },
    child: "child done",
  });
  assert.equal(result.snapshot.agents.length, 1);
});
