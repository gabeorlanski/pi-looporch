# runtime/ map

Sandbox execution, runtime state, schemas, snapshots, and primitive registration. Add globals through the shared primitive protocol.

Assign deterministic execution IDs inside the runtime. `agent()` and `LLM()` may reuse only the matching successful checkpoint prefix; other primitives always execute normally.
