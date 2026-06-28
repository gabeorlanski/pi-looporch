import { appendRunMessage } from "../messages.ts";
import type { WorkflowPrimitive } from "../context.ts";

export const logPrimitive: WorkflowPrimitive<{ log: (message: string) => void }> = {
  name: "log",
  globals: ({ runtime }) => ({
    log: (message: string) => {
      runtime.snapshot.logs.push(message);
      appendRunMessage(runtime, {
        phaseIndex: runtime.snapshot.phases.length,
        phase: runtime.snapshot.phases.at(-1),
        level: "info",
        message: `log ${message}`,
      });
      runtime.emitEvent({ type: "log", message });
      runtime.emit();
    },
  }),
};
