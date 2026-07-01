# Pi Best-Practice Follow-up Issues

Consolidated from the round-2 subagent review artifacts:

- `review-round-2/lifecycle-reload.md`
- `review-round-2/trust-ux.md`
- `review-round-2/package-config.md`
- `review-round-2/file-mutation-concurrency.md`
- `review-round-2/holistic-pi-best-practices.md`

## Blockers

1. **Terminal workflow delivery still uses stale extension context after reload/shutdown**
   - Evidence: `extensions/workflow.ts` starts `settleBackgroundWorkflowRun(...)` as a fire-and-forget promise that captures old `pi`/`ctx`; rehydration removes terminal runs without sending completion/failure.
   - Fix: introduce a run owner keyed by `{ cwd, sessionId, runId }`, refresh it on `session_start`, invalidate on `session_shutdown`, and deliver terminal messages through the latest live context exactly once.

2. **`propose_workflow` reads draft files before entering the mutation queue**
   - Evidence: `src/tools.ts` calls `readWorkflowDraft(...)` before `withFileMutationQueue(...)`.
   - Fix: queue the full publish window, including draft resolution/read and save. Consider a draft-ready manifest/commit marker or workflow-level publish lock.

3. **Workflow publish staging dirs can collide and leak on failure**
   - Evidence: `src/request.ts` uses `pid-Date.now` staging/backup names and lacks cleanup around copy/replace failures.
   - Fix: use `mkdtemp`/UUID staging paths and `try/finally` cleanup for staging and backup directories.

4. **Workflow directory replacement is not reader-safe**
   - Evidence: `replaceWorkflowDirectory` renames the live workflow out before renaming staging in; concurrent run/discovery can see the workflow missing.
   - Fix: serialize workflow publish and workflow resolution/read through a shared workflow publish lock, or move to a reader-safe versioned-directory/pointer layout.

5. **Peer dependency range is too loose for required pi APIs**
   - Evidence: `package.json` uses wildcard peers while code requires APIs such as `CONFIG_DIR_NAME` and `ctx.isProjectTrusted()`.
   - Fix: set peers to the actual supported minimum range, e.g. pi packages `^0.80.2` or the first version exposing those APIs; validate loadcheck against that minimum.

## High / Important

6. **Child-agent trust state is not propagated into `SettingsManager.create`**
   - Evidence: `src/pi-agent.ts` reads workflow settings trust-aware, but creates the Pi `SettingsManager` without passing project trust state.
   - Fix: pass trust state into the settings manager creation API and add a test proving untrusted child sessions do not load project-local settings/resources.

7. **Disposed contexts can still be mutated by late cleanup / restore races**
   - Evidence: `clearRunningWorkflowUi(...)` can run after shutdown; `restoreRunningWorkflowUi(...)` can install timers after a shutdown racing its await.
   - Fix: make cleanup no-op for disposed contexts after shutdown, re-check disposed state after awaited snapshot IO, and wrap late cleanup to avoid detached-promise rejection.

8. **Shutdown/reload lifecycle behavior is under-tested**
   - Evidence: the harness records `session_shutdown` handlers but does not expose/exercise them in behavior tests.
   - Fix: add tests for shutdown cleanup, no old-context calls after late completion, restore/shutdown race, and terminal delivery after reload.

## Medium

9. **`/workflow-settings` display is not trust-aware**
   - Evidence: untrusted settings display can say project/global settings are merged even though project settings were intentionally ignored.
   - Fix: make the message explicitly say project settings are ignored until trust, or require trust before showing project-local settings.

10. **`/workflow-review` emits progress notification before trust check**
    - Evidence: it notifies “Reviewing workflow session logs...” before rejecting untrusted projects.
    - Fix: move trust check before the info notification.

11. **Dynamic `/workflow:<name>` aliases are process-global and stale across projects**
    - Evidence: aliases are stored in an extension-level `Set` and registered on every trusted `session_start` with no unregister/scope.
    - Fix: prefer a context-aware generic dispatcher or session-scoped alias registration/unregistration.

12. **Workflow settings writes are unqueued/non-atomic**
    - Evidence: settings write path performs read/merge/write without file mutation queue or temp+rename.
    - Fix: queue by exact settings path, re-read/merge inside the queue, write via temp file + rename, and clean temp files on failure.

13. **`workflowDirs` semantics are inconsistent**
    - Evidence: settings model/merged reader includes `workflowDirs`, but discovery reads only project settings directly.
    - Fix: either use merged trusted settings for workflow roots or document/enforce project-only `workflowDirs`.

## Low / Nice-to-have

14. **Argument completions depend on mutable last-session state**
    - Evidence: completion cwd/trust are module locals updated on `session_start`.
    - Fix: use context-aware completions if available, or avoid project-specific completions in a process-global command.

15. **Invalid workflows are silently hidden**
    - Evidence: discovery catches all parse/metadata errors and returns `undefined`.
    - Fix: keep discovery non-fatal but log skipped workflow path + error, and optionally expose diagnostics via a command.

16. **Atomic file helpers do not clean temp files on failed write/rename**
    - Evidence: active-run/output atomic writes create temp files and rename without failure cleanup.
    - Fix: remove temp path in catch/finally before rethrowing.

17. **Background active-run cleanup is fire-and-forget**
    - Evidence: final snapshot write and active-run removal are not awaited/logged.
    - Fix: await cleanup in `finally` while preserving original workflow result/error; log cleanup failures.

18. **Authoring/docs still hard-code `.pi` despite runtime `CONFIG_DIR_NAME` support**
    - Evidence: `src/authoring-guide.ts`, README, and specs use `.pi` examples.
    - Fix: decide whether rebranded distributions are supported in docs; if yes, phrase as “pi config dir, normally `.pi`” and interpolate runtime guidance where possible.

19. **Runtime dependency weight: `typescript`**
    - Evidence: only runtime dependency besides peers is `typescript`, used by source parsing.
    - Fix: defer unless package size becomes a priority; possible future replacement with a lighter parser.

## Current compliant areas noted by reviewers

- Project workflow execution/discovery is mostly trust-gated at command/tool boundaries.
- Project settings reads are skipped when untrusted.
- Child agents disable ambient parent extensions by default.
- Workflow result delivery is path/artifact-oriented rather than dumping large payloads into chat.
- TUI workflow UI is guarded by `ctx.mode === "tui"`.
- Package manifest has a pi extension entry and dry-run packaging looked reasonable.
