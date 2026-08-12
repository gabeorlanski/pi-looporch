/** Provides workflow usage aggregation behavior. */
import type { WorkflowCost, WorkflowSnapshot } from "./types.ts";
import { workflowCalls } from "./calls.ts";

export interface WorkflowUsageTotals {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  tokensTotal: number;
  cost: WorkflowCost;
}

/** Provides the workflowUsageTotals function contract. */
export function workflowUsageTotals(snapshot: Pick<WorkflowSnapshot, "agents" | "llms">): WorkflowUsageTotals {
  return workflowCalls(snapshot).reduce<WorkflowUsageTotals>(
    (totals, record) => {
      return {
        inputTokens: totals.inputTokens + record.inputTokenCount,
        cachedTokens: totals.cachedTokens + record.cacheReadTokenCount,
        outputTokens: totals.outputTokens + record.outputTokenCount,
        tokensTotal: totals.tokensTotal + record.inputTokenCount + record.outputTokenCount,
        cost: {
          knownUsd: totals.cost.knownUsd + record.cost.knownUsd,
          complete: totals.cost.complete && record.cost.complete,
        },
      };
    },
    { inputTokens: 0, cachedTokens: 0, outputTokens: 0, tokensTotal: 0, cost: { knownUsd: 0, complete: true } },
  );
}
