import type { WorkflowRunMessageSnapshot } from "../runtime-types.ts";
import type { ActiveWorkflowRuntime } from "./context.ts";

export function appendRunMessage(runtime: ActiveWorkflowRuntime, message: WorkflowRunMessageSnapshot): void {
  runtime.snapshot.messages.push(message);
  if (runtime.snapshot.messages.length > 200) runtime.snapshot.messages.splice(0, runtime.snapshot.messages.length - 200);
}
