/** Provides workflow model selection behavior. */
import type { Api, Model } from "@earendil-works/pi-ai/compat";

/** Resolves a provider/model, model ID, or display name from Pi's model catalog. */
export function resolveWorkflowModel(models: readonly Model<Api>[], spec: string): Model<Api> | undefined {
  const modelSpec = spec.split(":", 1)[0] ?? spec;
  const slash = modelSpec.indexOf("/");
  if (slash >= 0) {
    const provider = modelSpec.slice(0, slash);
    const id = modelSpec.slice(slash + 1);
    return models.find((model) => model.provider === provider && model.id === id);
  }
  return models.find((model) => model.id === modelSpec || model.name === modelSpec);
}
