import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import type { WorkflowAgentProgress, WorkflowAgentReporter } from "../src/runtime/types.ts";
import {
  workflowAgentLogEvent,
  parseSessionTokens,
  workflowAgentSessionLogDirectory,
  createWorkflowAgentProgressTracker,
  workflowAgentFailureMessage,
} from "../src/pi-agent.ts";

void test("schema agents validate and return terminal output", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-"));
  let terminalTool:
    | {
        execute: (
          toolCallId: string,
          params: unknown,
          signal: AbortSignal | undefined,
          onUpdate: unknown,
          context: { abort(): void },
        ) => Promise<unknown>;
        parameters: unknown;
      }
    | undefined;
  let sessionTools: string[] | undefined;
  let aborted = false;
  const agent = createPiWorkflowAgent({
    cwd: project,
    tools: [],
    createSession: (options) => {
      if (!options) throw new Error("Expected session options");
      sessionTools = options.tools;
      terminalTool = options.customTools?.find((tool) => tool.name === "StructuredOutput") as typeof terminalTool;
      return {
        session: {
          model: undefined,
          messages: [],
          subscribe: () => () => undefined,
          prompt: async () => {
            if (!terminalTool) throw new Error("Expected StructuredOutput");
            await assert.rejects(
              terminalTool.execute("output-invalid", { status: 42 }, undefined, undefined, {
                abort: () => (aborted = true),
              }),
              /arguments do not match its schema/,
            );
            await assert.rejects(
              terminalTool.execute("output-runtime", { name: "forged", status: "pass" }, undefined, undefined, {
                abort: () => (aborted = true),
              }),
              /arguments do not match its schema/,
            );
            assert.equal(aborted, false);
            await terminalTool.execute("output-1", { message: "Completed", status: "pass" }, undefined, undefined, {
              abort: () => (aborted = true),
            });
          },
          getSessionStats: () => ({
            tokens: { input: 10, output: 2, cacheRead: 4, cacheWrite: 1, total: 17 },
          }),
          dispose: () => undefined,
        },
        extensionsResult: options.resourceLoader?.getExtensions(),
      } as never;
    },
  });

  const result = await agent(
    "work",
    {
      label: "analysis",
      schema: {
        type: "object",
        properties: { status: { type: "string", description: "The final outcome." } },
        required: ["status"],
        additionalProperties: true,
      },
      extensions: [],
      tools: [],
    },
    {
      launched(): void {
        return undefined;
      },
      progress(): void {
        return undefined;
      },
    },
  );

  assert.deepEqual(sessionTools, ["StructuredOutput"]);
  assert.ok(terminalTool);
  assert.match(JSON.stringify(terminalTool.parameters), /"message"/);
  assert.match(JSON.stringify(terminalTool.parameters), /"status"/);
  assert.equal(aborted, true);
  assert.deepEqual(result, {
    message: "Completed",
    name: "analysis",
    steps: 0,
    usage: { input: 10, output: 2, cacheRead: 4, cacheWrite: 1, total: 17 },
    status: "pass",
  });
});

void test("schema agents preserve unrestricted tools", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-"));
  let sessionTools: string[] | undefined;
  const agent = createPiWorkflowAgent({
    cwd: project,
    tools: [],
    agentCapabilityCatalog: () => Promise.resolve({ availableExtensions: [], baseToolNames: [], customToolNames: [], loadErrors: [] }),
    createSession: (options) => {
      if (!options) throw new Error("Expected session options");
      sessionTools = options.tools;
      return {
        session: {
          model: undefined,
          messages: [],
          subscribe: () => () => undefined,
          prompt: () => Promise.resolve(),
          getSessionStats: () => ({ tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 } }),
          dispose: () => undefined,
        },
        extensionsResult: options.resourceLoader?.getExtensions(),
      } as never;
    },
  });

  await assert.rejects(
    agent(
      "work",
      { schema: { type: "object", properties: { status: { type: "string" } }, required: ["status"] } },
      {
        launched(): void {
          return undefined;
        },
        progress(): void {
          return undefined;
        },
      },
    ),
    /must finish by calling StructuredOutput/,
  );
  assert.equal(sessionTools, undefined);
});

void test("schema-less agents return final assistant text without StructuredOutput", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-"));
  let sessionTools: string[] | undefined;
  let customToolNames: string[] | undefined;
  const agent = createPiWorkflowAgent({
    cwd: project,
    tools: [],
    createSession: (options) => {
      if (!options) throw new Error("Expected session options");
      sessionTools = options.tools;
      customToolNames = options.customTools?.map((tool) => tool.name);
      return {
        session: {
          model: undefined,
          messages: [{ role: "assistant", content: [{ type: "text", text: "Plain completion" }] }],
          subscribe: () => () => undefined,
          prompt: () => Promise.resolve(),
          getSessionStats: () => ({
            tokens: { input: 10, output: 2, cacheRead: 4, cacheWrite: 1, total: 17 },
          }),
          dispose: () => undefined,
        },
        extensionsResult: options.resourceLoader?.getExtensions(),
      } as never;
    },
  });

  const result = await agent(
    "work",
    { label: "analysis", extensions: [], tools: [] },
    {
      launched(): void {
        return undefined;
      },
      progress(): void {
        return undefined;
      },
    },
  );

  assert.deepEqual(sessionTools, []);
  assert.deepEqual(customToolNames, []);
  assert.deepEqual(result, {
    message: "Plain completion",
    name: "analysis",
    steps: 0,
    usage: { input: 10, output: 2, cacheRead: 4, cacheWrite: 1, total: 17 },
  });
});

void test("schema agents reserve runtime fields", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-"));
  const agent = createPiWorkflowAgent({ cwd: project, tools: [] });

  await assert.rejects(
    agent(
      "work",
      {
        schema: {
          type: "object",
          properties: { status: { type: "string" } },
          required: ["status", "message"],
        },
        extensions: [],
        tools: [],
      },
      {
        launched(): void {
          return undefined;
        },
        progress(): void {
          return undefined;
        },
      },
    ),
    /reserved property "message"/,
  );
});

void test("workflow_agent_surfaces_terminal_provider_errors", () => {
  assert.equal(
    workflowAgentFailureMessage(
      [
        { role: "user", content: [] },
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "Codex error: Model not found gpt-5.6-luna-free-1p-codexswic-ev3",
        },
      ],
      "review instructions",
    ),
    'Workflow child agent "review instructions" failed: Codex error: Model not found gpt-5.6-luna-free-1p-codexswic-ev3',
  );
});

void test("workflow_agent_surfaces_provider_errors_without_details", () => {
  assert.equal(
    workflowAgentFailureMessage([{ role: "assistant", content: [], stopReason: "error" }]),
    "Workflow child agent failed: provider returned an error response without details",
  );
});

void test("workflow_agent_progress_tracker_reports_tool_start_arguments", () => {
  const progressReports: unknown[] = [];
  const reportProgress = (progress: WorkflowAgentProgress): void => {
    progressReports.push(progress);
  };
  const reporter: WorkflowAgentReporter = {
    launched(): void {
      return undefined;
    },
    progress: reportProgress,
  };
  const tracker = createWorkflowAgentProgressTracker(reporter);

  tracker.handleEvent({ type: "message_start" });
  tracker.handleEvent({ type: "tool_execution_start", toolName: "read", args: { path: "src/auth.ts" } });
  tracker.handleEvent({ type: "tool_execution_update", toolName: "read" });
  tracker.handleEvent({ type: "message_end", message: { usage: { inputTokens: 10, outputTokens: 4 } } });
  tracker.handleEvent({ type: "turn_end" });

  assert.deepEqual(progressReports, [
    { statusMessage: "thinking", inputTokenCount: 0, outputTokenCount: 0, toolCallCount: 0, toolActivity: [], stepCount: 0 },
    {
      statusMessage: "active",
      inputTokenCount: 0,
      outputTokenCount: 0,
      toolCallCount: 1,
      toolActivity: [{ name: "read", arguments: { path: "src/auth.ts" } }],
      stepCount: 0,
    },
    {
      statusMessage: "active",
      inputTokenCount: 0,
      outputTokenCount: 0,
      toolCallCount: 1,
      toolActivity: [{ name: "read", arguments: { path: "src/auth.ts" } }],
      stepCount: 0,
    },
    {
      inputTokenCount: 10,
      outputTokenCount: 4,
      toolCallCount: 1,
      toolActivity: [{ name: "read", arguments: { path: "src/auth.ts" } }],
      stepCount: 0,
    },
    {
      statusMessage: "waiting",
      inputTokenCount: 10,
      outputTokenCount: 4,
      toolCallCount: 1,
      toolActivity: [{ name: "read", arguments: { path: "src/auth.ts" } }],
      stepCount: 1,
    },
  ]);
});

void test("workflow_agent_event_log_omits_streamed_message_updates", () => {
  assert.equal(
    workflowAgentLogEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
      message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
    }),
    undefined,
  );
});

void test("event log keeps message lifecycle metadata", () => {
  assert.deepEqual(
    workflowAgentLogEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "final full answer belongs in the session transcript" }],
        usage: { input: 10, output: 3 },
        provider: "openai-codex",
        model: "gpt-5.5",
      },
    }),
    {
      type: "message_end",
      message: {
        role: "assistant",
        usage: { input: 10, output: 3 },
        provider: "openai-codex",
        model: "gpt-5.5",
      },
    },
  );
});

void test("event log keeps agent completion metadata", () => {
  assert.deepEqual(
    workflowAgentLogEvent({
      type: "agent_end",
      messages: [
        { role: "user", content: [{ type: "text", text: "prompt" }] },
        { role: "assistant", content: [{ type: "text", text: "final" }] },
      ],
      willRetry: false,
    }),
    { type: "agent_end", messageCount: 2, willRetry: false },
  );
});

void test("event log keeps tool lifecycle metadata", () => {
  assert.deepEqual(
    workflowAgentLogEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "large.md" },
      result: { content: [{ type: "text", text: "large file content belongs in the session transcript" }] },
      partialResult: { content: [{ type: "text", text: "partial" }] },
      isError: false,
    }),
    { type: "tool_execution_end", toolCallId: "call-1", toolName: "read", isError: false },
  );
});

void test("event log keeps turn completion metadata", () => {
  assert.deepEqual(
    workflowAgentLogEvent({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "final response" }],
        usage: { input: 12, output: 4 },
      },
      toolResults: [{ content: [{ type: "text", text: "large tool output" }] }],
    }),
    { type: "turn_end", message: { role: "assistant", usage: { input: 12, output: 4 } }, toolResultCount: 1 },
  );
});

void test("session tokens parse provider usage aliases", async () => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-session-tokens-"));
  await writeFile(
    path.join(sessionDir, "workflow-agent-1.jsonl"),
    [
      JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2, cache_read_input_tokens: 500 } }),
      JSON.stringify({ message: { usage: { input_tokens: 5, output_tokens: 7, total_tokens: 900 } } }),
      JSON.stringify({ usage: { totalTokens: 1234, cacheRead: 1000 } }),
    ].join("\n"),
    "utf8",
  );

  assert.deepEqual(parseSessionTokens(sessionDir), { input: 8, output: 9, total: 17 });
});

void test("workflow_session_tokens_parse_actual_usage_from_session_file", async () => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-session-"));
  await writeFile(
    path.join(sessionDir, "session.jsonl"),
    [
      JSON.stringify({ type: "session", id: "session-1" }),
      JSON.stringify({ message: { usage: { inputTokens: 10, outputTokens: 4 } } }),
      "not json",
      JSON.stringify({ usage: { input: 3, output: 2 } }),
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(path.join(sessionDir, "events.jsonl"), `${JSON.stringify({ usage: { input: 100, output: 100 } })}\n`, "utf8");

  assert.deepEqual(parseSessionTokens(sessionDir), { input: 13, output: 6, total: 19 });
});

void test("agent session logs use the project key and parent ID", () => {
  assert.equal(
    workflowAgentSessionLogDirectory("/tmp/example/project", "parent-1", "agent-001-review", "/home/user/.pi/agent/sessions"),
    path.join("/home/user/.pi/agent/sessions", "--tmp-example-project--", "parent-1", "agent-001-review"),
  );
});
