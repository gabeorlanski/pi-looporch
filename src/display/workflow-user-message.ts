import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface WorkflowUserMessageOptions {
  deliverAs?: "followUp";
}

export type SendWorkflowUserMessage = (message: string, options?: WorkflowUserMessageOptions) => void;

export function sendWorkflowUserMessage(ctx: ExtensionContext, sendUserMessage: SendWorkflowUserMessage, message: string): void {
  if (ctx.isIdle()) {
    sendUserMessage(message);
    return;
  }
  sendUserMessage(message, { deliverAs: "followUp" });
}
