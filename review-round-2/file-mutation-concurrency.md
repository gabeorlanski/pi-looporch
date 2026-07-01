## Review

- Correct: `propose_workflow` now uses project trust gating and saves through `withFileMutationQueue` keyed to the target workflow directory (`src/tools.ts:146-157`). This addresses same-process, same-workflow concurrent saves better than the prior direct `saveWorkflowDraft` call.
- Correct: Active workflow run records and output artifacts avoid fixed temp filenames by using `randomUUID()` for per-file temp writes (`src/workflow/active-runs.ts:30-35`, `src/workflow/outputs.ts:145-148`) and `mkdtemp()` for default run output directories (`src/workflow/outputs.ts:26-27`).
- Correct: `run_workflow` does not dump large result payloads into the tool response; it returns output paths instead (`src/tools.ts:61-69`). Progress updates are bounded by the display renderer's fixed width and visible-agent cap (`src/display/progress.ts:5-7`, `src/display/progress.ts:49-58`, `src/display/progress.ts:89-100`).
- Fixed: none; review-only task, no project/source edits applied.
- Blocker: `propose_workflow` can still race with parallel draft writes because it reads the draft before entering the file mutation queue. The tool reads `workflow.js` and walks the draft directory at `src/tools.ts:150-157` via `readWorkflowDraft`, while the draft reader performs unqueued `stat`, `readFile`, and recursive `readdir`/`Promise.all` work (`src/workflow/drafts.ts:31-36`, `src/workflow/drafts.ts:40-55`). Pi tool calls run in parallel by default and queueing guidance says the entire mutation window must be queued (`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:1744-1750`). Concrete remediation: do not allow/encourage calling `propose_workflow` in the same assistant turn as draft `write`/`edit` calls; additionally move draft resolution/read plus save under a stable queue/lock strategy. If workflow.js is the commit marker, queue at least that exact `workflow.js` path before reading; for full correctness, introduce a draft-ready manifest/commit file or project-level draft publish lock so asset writes cannot be copied half-written.
- Blocker: `saveDraft` temp/staging paths are only `pid-Date.now` based and are not cleaned up on copy/save failure. The paths are built at `src/request.ts:51-53`, only pre-cleaned once at `src/request.ts:54-58`, then `cp` can fail at `src/request.ts:59` before `replaceWorkflowDirectory` runs, leaving `.name.tmp-*` behind. Same-process same-workflow calls are queued, but cross-process/session saves in the same millisecond can collide on the same staging/backup names, and stale leftovers accumulate. Concrete remediation: allocate staging/backup names with `mkdtemp` or `randomUUID`, and wrap copy/replace in `try/finally` that removes staging plus any backup after successful publish or rollback.
- Blocker: Directory replacement is not atomic for readers and is not coordinated with `run_workflow`/discovery. `replaceWorkflowDirectory` first renames the live workflow out of the way and only then renames staging into place (`src/request.ts:63-71`), creating a window where `.pi/workflows/<name>` is missing. A concurrent run resolves and reads `workflow.js` without any queue/lock (`src/runtime/run.ts:18-20`), so a parallel save can make a valid workflow intermittently disappear or fail to read. Concrete remediation: serialize workflow publication and workflow resolution/read through a shared project/workflow publish lock (for example a stable `.pi/workflows/.publish.lock` queue key), or change the on-disk layout to an atomic pointer/symlink/versioned-directory swap that readers can handle consistently.
- Note: Background run cleanup is fire-and-forget. The `finally` block discards the pending snapshot write and removal promise (`src/background-runs.ts:73-76`), and `enqueueSnapshotWrite` swallows write failures (`src/background-runs.ts:88-92`). If the process exits or removal fails, `.pi/workflow-runs/active/*.json` can linger and reload UI can show stale runs. Concrete remediation: make the `finally` path await `snapshotWrite.catch(...)` and `removeActiveWorkflowRun(...)`, logging cleanup failures without replacing the workflow result/error.
- Note: Atomic file helpers leave temp files on rename/write failure. `writeFileAtomic` writes then renames without a cleanup catch/finally (`src/workflow/outputs.ts:145-148`), and active-run registration has the same shape (`src/workflow/active-runs.ts:30-35`). Concrete remediation: on failure after temp path allocation, `rm(tempPath, { force: true })` before rethrowing.
- Note: `/home/gabe/Coding/pi-looporch/plan.md` and `/home/gabe/Coding/pi-looporch/progress.md` were not present when requested, so this review used the current diff and repository files directly.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed current diff/repository for the requested file-mutation and concurrency scope only; no project/source files were modified."
    }
  ],
  "changedFiles": [
    "review-round-2/file-mutation-concurrency.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short && git diff --stat && git diff --cached --stat",
      "result": "passed",
      "summary": "Inspected modified/untracked files and confirmed no cached diff output."
    },
    {
      "command": "npm test",
      "result": "passed",
      "summary": "90 node:test tests passed."
    },
    {
      "command": "git status --short && git diff --cached --name-only",
      "result": "passed",
      "summary": "Confirmed repository still has unstaged work only; no staged files listed."
    }
  ],
  "validationOutput": [
    "npm test: tests 90, pass 90, fail 0, duration_ms 5377.940995",
    "Requested plan.md and progress.md were absent (ENOENT)."
  ],
  "residualRisks": [
    "Findings are static-review findings; no remediation was applied in this review-only task.",
    "Pre-existing repository diff remains outside this review artifact."
  ],
  "noStagedFiles": true,
  "diffSummary": "Review artifact only; existing repository diff was inspected but not modified.",
  "reviewFindings": [
    "blocker: src/tools.ts:150 - propose_workflow reads draft files before entering withFileMutationQueue, so parallel draft writes can race the save.",
    "blocker: src/request.ts:51 - saveDraft uses pid-Date.now staging/backup names and lacks failure cleanup around cp/replace.",
    "blocker: src/request.ts:64 - workflow directory replacement temporarily removes the live workflow and is not coordinated with run_workflow readers.",
    "note: src/background-runs.ts:73 - active-run cleanup and final snapshot write are fire-and-forget.",
    "note: src/workflow/outputs.ts:145 - atomic file helpers do not remove temp files on failed write/rename."
  ],
  "manualNotes": "Review output written to the required path."
}
```
