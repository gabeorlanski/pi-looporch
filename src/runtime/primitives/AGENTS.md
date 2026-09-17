# primitives/ map

Workflow sandbox primitives. Each file implements one registered primitive using the runtime context; preserve explicit data flow and capability limits. Every asynchronous model call must honor the workflow AbortSignal, remain tracked until it settles, and avoid publishing checkpoints after cancellation.
