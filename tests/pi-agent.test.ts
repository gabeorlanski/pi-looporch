import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { workflowAgentSessionLogDirectory, workflowDisplayTokensFromMessage } from "../src/pi-agent.ts";

void test("workflow_display_tokens_count_assistant_output_not_provider_total_input_or_cache", () => {
  assert.equal(
    workflowDisplayTokensFromMessage({
      usage: { input: 100_000, output: 750, cacheRead: 90_000, cacheWrite: 10_000 },
      content: [{ type: "text", text: "abcdefghijkl" }],
    }),
    3,
  );
});

void test("workflow_display_tokens_estimate_streaming_text_without_usage", () => {
  assert.equal(
    workflowDisplayTokensFromMessage({
      content: [{ type: "text", text: "abcdefghijkl" }],
    }),
    3,
  );
});

void test("workflow_display_tokens_count_hidden_thinking_but_ignore_tool_calls", () => {
  assert.equal(
    workflowDisplayTokensFromMessage({
      content: [
        { type: "thinking", thinking: "abcdefghijkl" },
        { type: "toolCall", name: "bash", arguments: { command: "true" } },
      ],
      usage: { input: 50_000, output: 1_500, cacheRead: 40_000, totalTokens: 91_500 },
    }),
    3,
  );
});

void test("workflow_agent_session_log_directory_uses_pi_project_key_and_parent_id", () => {
  assert.equal(
    workflowAgentSessionLogDirectory("/tmp/example/project", "parent-1", "agent-001-review", "/home/user/.pi/agent/sessions"),
    path.join("/home/user/.pi/agent/sessions", "--tmp-example-project--", "parent-1", "agent-001-review"),
  );
});
