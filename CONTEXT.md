# pi-workflow

pi-workflow models repeatable agent-assisted project work as executable runbooks and their observable, resumable executions. This glossary keeps authoring, execution, and model-call concepts distinct.

## Workflow Authoring

**Workflow**:
A repeatable unit of agent-assisted project work. A workflow is described by a Workflow Definition and carried out through Workflow Runs.
_Avoid_: Job, task

**Workflow Definition**:
The static, executable runbook that describes a Workflow.
_Avoid_: Workflow source, script

**Workflow Draft**:
A complete Workflow Definition held for validation and publication.
_Avoid_: Partial workflow, temporary workflow

**Published Workflow**:
A validated Workflow Definition available for users to run.
_Avoid_: Saved draft, generated workflow

**Planned Phase**:
A named stage declared in a Workflow Definition as part of its runbook outline.
_Avoid_: Runtime phase, progress phase

**Runtime Phase**:
A visible progress marker emitted while a Workflow Run executes. It conveys progress and does not carry data between stages.
_Avoid_: Planned phase, shared state

## Workflow Execution

**Workflow Run**:
One execution of a Published Workflow with a specific normalized input and run identity.
_Avoid_: Workflow, workflow session

**Parent Session**:
The live Pi session that owns a Workflow Run and is the only session that can resume it.
_Avoid_: Child-Agent Session, workflow run

**Child Agent**:
A Pi agent launched by a Workflow Run to perform an agent task.
_Avoid_: LLM Call, worker

**Child-Agent Session**:
The Pi session created for one Child Agent launch.
_Avoid_: Parent Session, workflow run

**LLM Call**:
A direct, generation-only model completion within a Workflow Run. It has no agent session or tools.
_Avoid_: Child Agent, Child-Agent Session

**Artifact**:
A durable, inspectable record produced by a Workflow Run, such as an output, snapshot, prompt, activity log, or model-call record.
_Avoid_: Transcript

**Checkpoint**:
A successful Child Agent or LLM Call result retained for possible reuse during Replay.
_Avoid_: Snapshot, artifact cache

**Replay**:
Re-execution of a Workflow Run using its original input and current Workflow Definition, reusing the unchanged successful model-call prefix and continuing from the first changed or incomplete call.
_Avoid_: Resume

**Abort**:
The intentional cooperative cancellation of a running Workflow Run. An aborted run preserves completed artifacts and may later Resume in its live Parent Session.
_Avoid_: Stop, failure

**Resume**:
The same-session action that restarts a failed or aborted Workflow Run through Replay.
_Avoid_: Replay, retry
