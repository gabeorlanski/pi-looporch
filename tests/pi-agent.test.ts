import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowDisplayTokensFromMessage } from "../src/pi-agent.ts";

void test("workflow_display_tokens_count_output_not_input_or_cache", () => {
  assert.equal(
    workflowDisplayTokensFromMessage({
      usage: { input: 100_000, output: 750, cacheRead: 90_000, cacheWrite: 10_000 },
    }),
    750,
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
