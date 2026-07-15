/** Provides review behavior. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { workflowLogReviewMessage } from "../../src/log-review.ts";
import { WORKFLOW_MESSAGE_TYPE } from "../messages.ts";

/** Provides the reviewWorkflowCommand function contract. */
export async function reviewWorkflowCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
  try {
    ctx.ui.notify("Reviewing workflow session logs for token-cost reduction", "info");
    const content = await workflowLogReviewMessage({ cwd: ctx.cwd, target: args.trim() });
    pi.sendMessage({ customType: WORKFLOW_MESSAGE_TYPE, content, display: true, details: { kind: "workflow-log-review" } });
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
