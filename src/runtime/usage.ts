/** Provides workflow usage aggregation behavior. */
import type { WorkflowAgentSnapshot, WorkflowCost } from "./types.ts";

type UsageAgent = Pick<WorkflowAgentSnapshot, "inputTokenCount" | "outputTokenCount"> & {
  cacheReadTokenCount?: number;
  cost?: WorkflowCost;
};

export interface WorkflowUsageTotals {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  tokensTotal: number;
  cost: WorkflowCost;
}

/** Provides the workflowUsageTotals function contract. */
export function workflowUsageTotals(agents: readonly UsageAgent[]): WorkflowUsageTotals {
  return agents.reduce<WorkflowUsageTotals>(
    (totals, agent) => {
      const cost = agent.cost ?? unknownWorkflowCost();
      return {
        inputTokens: totals.inputTokens + agent.inputTokenCount,
        cachedTokens: totals.cachedTokens + (agent.cacheReadTokenCount ?? 0),
        outputTokens: totals.outputTokens + agent.outputTokenCount,
        tokensTotal: totals.tokensTotal + agent.inputTokenCount + agent.outputTokenCount,
        cost: {
          knownUsd: totals.cost.knownUsd + cost.knownUsd,
          complete: totals.cost.complete && cost.complete,
        },
      };
    },
    { inputTokens: 0, cachedTokens: 0, outputTokens: 0, tokensTotal: 0, cost: { knownUsd: 0, complete: true } },
  );
}

/** Provides the mergeWorkflowUsageTotals function contract. */
export function mergeWorkflowUsageTotals(totals: readonly WorkflowUsageTotals[]): WorkflowUsageTotals {
  return totals.reduce<WorkflowUsageTotals>(
    (merged, total) => ({
      inputTokens: merged.inputTokens + total.inputTokens,
      cachedTokens: merged.cachedTokens + total.cachedTokens,
      outputTokens: merged.outputTokens + total.outputTokens,
      tokensTotal: merged.tokensTotal + total.tokensTotal,
      cost: {
        knownUsd: merged.cost.knownUsd + total.cost.knownUsd,
        complete: merged.cost.complete && total.cost.complete,
      },
    }),
    { inputTokens: 0, cachedTokens: 0, outputTokens: 0, tokensTotal: 0, cost: { knownUsd: 0, complete: true } },
  );
}

/** Provides the unknownWorkflowCost function contract. */
export function unknownWorkflowCost(): WorkflowCost {
  return { knownUsd: 0, complete: false };
}
