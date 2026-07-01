## Review

- Correct: `extensions/workflow.ts` now registers `session_shutdown` and calls `disposeRunningWorkflowUi(ctx)` (extensions/workflow.ts:76-78). `disposeRunningWorkflowUi` clears the animation timer, the rehydration refresh timer, terminal input subscription, status, widget, dynamic count, and scoped UI state (src/display/running-workflow-ui.ts:118-131). Active-run rehydration is scoped to the same owner session id (src/display/running-workflow-ui.ts:134-136; src/workflow/active-run-snapshots.ts:10-12), and same-cwd/different-session coverage exists in tests (tests/extension.test.ts:152-176, 179-195).
- Correct: Existing deterministic tests pass: `npm test` reported 90 passing tests; `npm run typecheck` completed successfully.
- Note: `/home/gabe/Coding/pi-looporch/plan.md` and `/home/gabe/Coding/pi-looporch/progress.md` were not present during review, so this review is based on the current diff and source inspection.

- Blocker: Completion/failure delivery still closes over stale `ExtensionAPI`/`ExtensionContext` after reload/shutdown, and rehydrated runs have no replacement terminal-message path. `runExistingWorkflowCommand` starts `settleBackgroundWorkflowRun(pi, ctx, workflowName, visible.run.finished, ...)` as a fire-and-forget promise that captures the pre-shutdown `pi` and `ctx` (extensions/workflow.ts:157-160). On completion/failure it calls `pi.sendMessage` and `ctx.ui.notify` through those captured objects (extensions/workflow.ts:176-187, 190-210). `session_shutdown` only disposes UI (extensions/workflow.ts:76-78); it does not abort the run, transfer the notifier, or mark completion delivery as owned by a new context. The reload-side path only rehydrates snapshots/widgets (src/display/running-workflow-ui.ts:134-138), while `readActiveWorkflowSnapshot` silently removes non-running records without sending a completion/failure message (src/workflow/active-run-snapshots.ts:18-27). Result: a workflow that finishes after extension reload can attempt to deliver through a dead/stale host object, or a rehydrated run can disappear when its manifest becomes done/error without the current session receiving the final success/failure message. Remediation: introduce a session/run lifecycle owner keyed by `{cwd, sessionId, runId}` that is refreshed on `session_start` and invalidated on `session_shutdown`, and deliver terminal messages through the latest live context only. For rehydrated runs, poll/read the output manifest; when it transitions from `running` to `done`/`error`, send the same completion/failure message from the current context exactly once (persist a delivered marker or remove-after-delivery to avoid duplicates). Add reload tests that start a slow run, invoke shutdown, create/start a replacement session with the same session id, finish the run, and assert the old context is not touched while the new context receives success and failure messages.

- Important: Disposed contexts can still be mutated by late cleanup, and `restoreRunningWorkflowUi` has a shutdown race that can recreate timers after disposal. The new guard only protects `updateRunningWorkflowUi` (src/display/running-workflow-ui.ts:71-73). Late workflow cleanup still calls `clearRunningWorkflowUi(options.ctx, runId)` after the background promise settles (src/display/visible-workflow-run.ts:32-35; extensions/workflow.ts:157-160, 185-187), and `clearRunningWorkflowUi` unconditionally calls `ctx.ui.setStatus`/`ctx.ui.setWidget` when no dynamic workflows remain (src/display/running-workflow-ui.ts:96-115). If a run settles after `session_shutdown`, that cleanup can touch a disposed context and, if host UI calls throw, turn the fire-and-forget settlement promise into an unhandled rejection. Separately, `restoreRunningWorkflowUi` deletes the disposed marker, awaits snapshot IO, then installs a refresh interval if snapshots were found (src/display/running-workflow-ui.ts:58-67). If shutdown happens during that await, `updateRunningWorkflowUi` will no-op due to the disposed marker, but `restoreRunningWorkflowUi` can still create a new interval that closes over the disposed context. Remediation: make `clearRunningWorkflowUi` and late cleanup no-op for disposed contexts after the first shutdown cleanup; re-check `disposedWorkflowUiContexts.has(ctx)` immediately after awaited snapshot reads and before installing timers; consider returning the count of actually restored UI states instead of raw snapshot count; wrap final cleanup so stale UI teardown cannot reject a detached promise.

- Important: Shutdown behavior is effectively untested. The harness records `session_shutdown` handlers (tests/extension-harness.ts:87-99), but the returned harness exposes only `sessionStart` and `command` (tests/extension-harness.ts:53-69, 192-215), and the test grep only found `session_shutdown` in harness definitions, not in a behavior test. Current coverage validates session-start rehydration (tests/extension.test.ts:120-150) and completion-handler send failures (tests/extension.test.ts:44-68), but not timer/input-handler disposal on shutdown, late updates after shutdown, or completion/failure after reload. Remediation: expose `sessionShutdown` in the harness and add tests for: timer/widget/input cleanup on shutdown; no old-context UI calls from late `visible.cleanup`; no interval recreation if shutdown races with restore; completion and failure delivery to a reloaded current context.

- Nice-to-have: Workflow argument completions use mutable extension-level "last session" state rather than the requesting command context. `completionCwd`/`completionProjectTrusted` are module-local variables initialized from `process.cwd()`/`false` (extensions/workflow.ts:29-42) and overwritten on every `session_start` (extensions/workflow.ts:60-63). In multiple live sessions or rapid project switches, completions for one session can be computed from another session's cwd/trust state. Remediation: prefer a context-aware completion API if available; otherwise avoid project-specific completions from a global command, or register session/project-scoped alias completions that do not depend on mutable last-session state.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Returned prioritized findings with file:line evidence for stale completion delivery, disposed-context cleanup races, missing shutdown tests, and completion cwd state."
    }
  ],
  "changedFiles": [
    "review-round-2/lifecycle-reload.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short && git diff --stat && git diff -- extensions/workflow.ts src/display/running-workflow-ui.ts src/display/visible-workflow-run.ts src/background-runs.ts src/workflow/active-runs.ts tests",
      "result": "passed",
      "summary": "Inspected current changed files and focused diff."
    },
    {
      "command": "npm test",
      "result": "passed",
      "summary": "90 tests passed."
    },
    {
      "command": "npm run typecheck",
      "result": "passed",
      "summary": "tsc --noEmit completed successfully."
    }
  ],
  "validationOutput": [
    "npm test: tests 90, pass 90, fail 0",
    "npm run typecheck: passed"
  ],
  "residualRisks": [
    "plan.md and progress.md were absent, so intent was inferred from source/diff and the user task.",
    "Findings are based on static inspection plus existing tests; no new lifecycle reproduction tests were added because this was review-only."
  ],
  "noStagedFiles": true,
  "diffSummary": "Current repo diff changes trust handling, workflow config paths, visible run preparation, active-run paths, and running-workflow UI disposal; review artifact only was written by this review.",
  "reviewFindings": [
    "blocker: extensions/workflow.ts:157-210 and src/workflow/active-run-snapshots.ts:18-27 - completion/failure delivery after reload still depends on stale captured ExtensionAPI/ExtensionContext and rehydration silently removes terminal runs without messaging the current session.",
    "important: src/display/running-workflow-ui.ts:58-67,96-131 and src/display/visible-workflow-run.ts:32-35 - late cleanup and restore races can mutate disposed contexts or recreate timers after shutdown.",
    "important: tests/extension-harness.ts:87-99,192-215 - session_shutdown handlers are collected but not exposed/exercised, leaving shutdown/reload lifecycle behavior untested.",
    "nice-to-have: extensions/workflow.ts:29-42,60-63 - argument completions are based on mutable last-session cwd/trust state."
  ],
  "manualNotes": "No project/source files were modified; only this required review artifact was written."
}
```
