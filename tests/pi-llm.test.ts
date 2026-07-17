import assert from "node:assert/strict";
import { test } from "node:test";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { createPiWorkflowLLM } from "../src/pi-llm.ts";

void test("LLM uses the active Pi model and auth", async () => {
  const model = { provider: "active-provider", id: "active-model", api: "openai-responses" } as Model<Api>;
  const calls: unknown[] = [];
  const llm = createPiWorkflowLLM({
    model,
    getRequestAuth: (selectedModel) => {
      assert.equal(selectedModel, model);
      return Promise.resolve({ apiKey: "secret", headers: { "x-provider": "active" }, env: { REGION: "local" } });
    },
    complete: (selectedModel, context, options) => {
      calls.push({ selectedModel, context, options });
      return Promise.resolve({
        role: "assistant",
        content: [
          { type: "text", text: "First" },
          { type: "text", text: "Second" },
        ],
        api: "openai-responses",
        provider: "active-provider",
        model: "active-model",
        usage: {
          input: 10,
          output: 4,
          cacheRead: 2,
          cacheWrite: 1,
          totalTokens: 17,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      } as AssistantMessage);
    },
  });
  const controller = new AbortController();

  const result = await llm({
    system: "Be concise.",
    prompt: "user: Question\nassistant: Answer\nuser: Follow-up\nassistant:",
    signal: controller.signal,
  });

  assert.deepEqual(calls, [
    {
      selectedModel: model,
      context: {
        systemPrompt: "Be concise.",
        messages: [{ role: "user", content: "user: Question\nassistant: Answer\nuser: Follow-up\nassistant:", timestamp: 0 }],
        tools: [],
      },
      options: {
        apiKey: "secret",
        headers: { "x-provider": "active" },
        env: { REGION: "local" },
        maxRetries: 0,
        signal: controller.signal,
      },
    },
  ]);
  assert.deepEqual(result, {
    text: "FirstSecond",
    usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, total: 17 },
    model: "active-model",
    provider: "active-provider",
    stopReason: "stop",
  });
});

void test("LLM passes the normalized system prompt", async () => {
  const model = { provider: "active-provider", id: "active-model", api: "openai-responses" } as Model<Api>;
  let systemPrompt: string | undefined;
  const llm = createPiWorkflowLLM({
    model,
    getRequestAuth: () => Promise.resolve({ apiKey: "secret" }),
    complete: (_selectedModel, context) => {
      systemPrompt = context.systemPrompt;
      return Promise.resolve({
        role: "assistant",
        content: [{ type: "text", text: '{"ok":true}' }],
        api: "openai-responses",
        provider: "active-provider",
        model: "active-model",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      } as AssistantMessage);
    },
  });

  await llm({
    system: "Use release data.",
    prompt: "Classify it.",
  });

  assert.equal(systemPrompt, "Use release data.");
});

void test("LLM surfaces Pi provider errors", async () => {
  const model = { provider: "active-provider", id: "active-model", api: "openai-responses" } as Model<Api>;
  const llm = createPiWorkflowLLM({
    model,
    getRequestAuth: () => Promise.resolve({ apiKey: "secret" }),
    complete: () =>
      Promise.resolve({
        role: "assistant",
        content: [],
        api: "openai-responses",
        provider: "active-provider",
        model: "active-model",
        usage: {
          input: 1,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error",
        errorMessage: "provider unavailable",
        timestamp: Date.now(),
      } as AssistantMessage),
  });

  await assert.rejects(llm({ prompt: "Question" }), /provider unavailable/);
});
