/** Provides workflow user message behavior. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface WorkflowUserMessageOptions {
  deliverAs?: "followUp";
}

export type SendWorkflowUserMessage = (message: string, options?: WorkflowUserMessageOptions) => void;

/** Provides the sendWorkflowUserMessage function contract. */
export function sendWorkflowUserMessage(ctx: ExtensionContext, sendUserMessage: SendWorkflowUserMessage, message: string): void {
  if (ctx.isIdle()) {
    sendUserMessage(message);
    return;
  }
  sendUserMessage(message, { deliverAs: "followUp" });
}
