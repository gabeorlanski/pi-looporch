/** Provides log behavior. */
import { appendRunMessage } from "../messages.ts";
import type { WorkflowPrimitive } from "../context.ts";

export const logPrimitive: WorkflowPrimitive<{ log: (message: string) => void }> = {
  name: "log",
  docs: [{ name: "log", signature: "log(message)", summary: "Adds a user-facing workflow milestone to live progress and run messages." }],
  globals: ({ runtime }) => ({
    log: (message: string) => {
      appendRunMessage(runtime, {
        phaseIndex: runtime.snapshot.phases.length,
        phase: runtime.snapshot.phases.at(-1),
        level: "info",
        message: `log ${message}`,
      });
      runtime.emit();
    },
  }),
};
