import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  workflowAgentLogEvent,
  parseSessionTokens,
  workflowAgentSessionLogDirectory,
  workflowDisplayTokensFromMessage,
} from "../src/pi-agent.ts";

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

void test("workflow_agent_event_log_keeps_message_lifecycle_without_conversation_body", () => {
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

void test("workflow_agent_event_log_keeps_agent_completion_without_transcript_copy", () => {
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

void test("workflow_agent_event_log_keeps_tool_lifecycle_without_conversation_payloads", () => {
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

void test("workflow_agent_event_log_keeps_turn_completion_without_transcript_copy", () => {
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

void test("workflow_display_tokens_count_assistant_output_not_provider_total_input_or_cache", () => {
  assert.equal(
    workflowDisplayTokensFromMessage({
      usage: { input: 100_000, output: 750, cacheRead: 90_000, cacheWrite: 10_000 },
      content: [{ type: "text", text: "abcdefghijkl" }],
    }),
    750,
  );
});

void test("workflow_display_tokens_are_zero_without_provider_usage", () => {
  assert.equal(
    workflowDisplayTokensFromMessage({
      content: [{ type: "text", text: "abcdefghijkl" }],
    }),
    0,
  );
});

void test("workflow_display_tokens_count_provider_output_and_ignore_content", () => {
  assert.equal(
    workflowDisplayTokensFromMessage({
      content: [
        { type: "thinking", thinking: "abcdefghijkl" },
        { type: "toolCall", name: "bash", arguments: { command: "true" } },
      ],
      usage: { input: 50_000, output: 1_500, cacheRead: 40_000, totalTokens: 91_500 },
    }),
    1_500,
  );
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

void test("workflow_agent_session_log_directory_uses_pi_project_key_and_parent_id", () => {
  assert.equal(
    workflowAgentSessionLogDirectory("/tmp/example/project", "parent-1", "agent-001-review", "/home/user/.pi/agent/sessions"),
    path.join("/home/user/.pi/agent/sessions", "--tmp-example-project--", "parent-1", "agent-001-review"),
  );
});
