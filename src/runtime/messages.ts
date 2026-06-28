import type { WorkflowRunMessageSnapshot } from "../runtime-types.ts";
import type { ActiveWorkflowRuntime } from "./context.ts";

export function appendRunMessage(runtime: ActiveWorkflowRuntime, message: WorkflowRunMessageSnapshot): void {
  const messages = runtime.snapshot.messages ?? (runtime.snapshot.messages = []);
  messages.push(message);
  if (messages.length > 200) messages.splice(0, messages.length - 200);
}
