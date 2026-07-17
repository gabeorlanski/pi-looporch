/** Provides Pi direct model-call integration for workflow LLM completions. */
import { completeSimple, type Api, type Model } from "@earendil-works/pi-ai/compat";
import type { WorkflowLLM } from "./runtime/types.ts";

/** Creates a generation-only workflow adapter using Pi's active model and authentication. */
export function createPiWorkflowLLM(options: {
  model: Model<Api> | undefined;
  getRequestAuth: (model: Model<Api>) => Promise<{
    apiKey?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  }>;
  complete?: typeof completeSimple;
}): WorkflowLLM {
  return async (request) => {
    const model = options.model;
    if (!model) throw new Error("Direct LLM calls require an active Pi model");
    const auth = await options.getRequestAuth(model);
    const response = await (options.complete ?? completeSimple)(
      model,
      {
        ...(request.system ? { systemPrompt: request.system } : {}),
        messages: [{ role: "user", content: request.prompt, timestamp: 0 }],
        tools: [],
      },
      {
        ...auth,
        maxRetries: 0,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    if (response.stopReason === "aborted") throw new Error(response.errorMessage ?? "Direct LLM call aborted");
    if (response.stopReason === "error") throw new Error(response.errorMessage ?? "Direct LLM provider call failed");
    return {
      text: response.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join(""),
      usage: {
        input: response.usage.input,
        output: response.usage.output,
        cacheRead: response.usage.cacheRead,
        cacheWrite: response.usage.cacheWrite,
        total: response.usage.totalTokens,
      },
      model: model.id,
      provider: model.provider,
      stopReason: response.stopReason,
    };
  };
}
