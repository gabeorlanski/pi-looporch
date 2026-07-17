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
    messages: [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
      { role: "user", content: "Follow-up" },
    ],
    signal: controller.signal,
  });

  assert.deepEqual(calls, [
    {
      selectedModel: model,
      context: {
        systemPrompt: "Be concise.",
        messages: [
          { role: "user", content: "Question", timestamp: 0 },
          {
            role: "assistant",
            content: [{ type: "text", text: "Answer" }],
            api: "openai-responses",
            provider: "active-provider",
            model: "active-model",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: 0,
          },
          { role: "user", content: "Follow-up", timestamp: 0 },
        ],
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
    cost: { knownUsd: 0, complete: true },
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
    messages: [{ role: "user", content: "Classify it." }],
  });

  assert.equal(systemPrompt, "Use release data.");
});

void test("LLM selects a requested Pi model and reasoning level", async () => {
  const activeModel = { provider: "active-provider", id: "active-model", api: "openai-responses" } as Model<Api>;
  const selectedModel = { provider: "selected-provider", id: "selected-model", api: "openai-responses", reasoning: true } as Model<Api>;
  let authenticatedModel: Model<Api> | undefined;
  let completedModel: Model<Api> | undefined;
  let reasoning: unknown;
  const llm = createPiWorkflowLLM({
    model: activeModel,
    getModels: () => [activeModel, selectedModel],
    getRequestAuth: (model) => {
      authenticatedModel = model;
      return Promise.resolve({ apiKey: "selected-secret" });
    },
    complete: (model, _context, options) => {
      completedModel = model;
      reasoning = options?.reasoning;
      return Promise.resolve({
        role: "assistant",
        content: [{ type: "text", text: "selected" }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 2,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 3,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      } as AssistantMessage);
    },
  });

  const result = await llm({
    model: "selected-provider/selected-model",
    reasoning: "high",
    messages: [{ role: "user", content: "Question" }],
  });

  assert.equal(authenticatedModel, selectedModel);
  assert.equal(completedModel, selectedModel);
  assert.equal(reasoning, "high");
  assert.equal(result.model, "selected-model");
  assert.equal(result.provider, "selected-provider");
});

void test("LLM rejects an unknown requested model", async () => {
  const model = { provider: "active-provider", id: "active-model", api: "openai-responses" } as Model<Api>;
  const llm = createPiWorkflowLLM({
    model,
    getModels: () => [model],
    getRequestAuth: () => Promise.resolve({ apiKey: "secret" }),
  });

  await assert.rejects(
    llm({ model: "missing-provider/missing-model", messages: [{ role: "user", content: "Question" }] }),
    /was not found/,
  );
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

  await assert.rejects(llm({ messages: [{ role: "user", content: "Question" }] }), /provider unavailable/);
});
