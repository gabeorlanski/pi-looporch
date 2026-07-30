/** Provides workflow user message behavior. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface WorkflowUserMessageOptions {
  deliverAs?: "steer" | "followUp";
}

export type SendWorkflowUserMessage = (message: string, options?: WorkflowUserMessageOptions) => void;

/** Sends a workflow user message immediately or queues it with the requested busy-session delivery mode. */
export function sendWorkflowUserMessage(
  ctx: ExtensionContext,
  sendUserMessage: SendWorkflowUserMessage,
  message: string,
  deliverAs: "steer" | "followUp" = "followUp",
): void {
  if (ctx.isIdle()) {
    sendUserMessage(message);
    return;
  }
  sendUserMessage(message, { deliverAs });
}
