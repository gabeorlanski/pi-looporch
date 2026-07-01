## Review

- Correct: Project workflow execution/discovery is trust-gated at the command and tool boundaries: `/workflow` checks trust before discovery (`extensions/workflow.ts:92-95`), named runs check before reading/running (`extensions/workflow.ts:118-120`), and tools reject untrusted `run_workflow`/`propose_workflow` calls (`src/tools.ts:43-49`, `src/tools.ts:146-149`).
- Correct: Untrusted settings reads avoid project files while still allowing global/default settings (`src/workflow/settings.ts:29-32`), with tests for untrusted settings and discovery (`tests/workflow-settings.test.ts:58-69`, `tests/discovery.test.ts:63-74`).
- Correct: Runtime project paths now route through the pi config-dir constant (`src/workflow/config-dir.ts:1-4`) in discovery/settings/active-run/publish paths (`src/discovery.ts:17-23`, `src/workflow/settings.ts:25-26`, `src/workflow/active-runs.ts:42-43`, `src/request.ts:47-60`).
- Correct: Visible workflow results remain artifact/path-oriented rather than dumping payloads into chat (`extensions/workflow.ts:190-204`, `src/tools.ts:71-79`), matching extension UX best practice.
- Fixed: none; review-only pass. Prior artifact findings were deduplicated rather than repeated in full.

- Medium: Dynamic `/workflow:<name>` aliases persist across sessions/projects and can leak stale workflow names/descriptions. The extension keeps a process-local `aliases` set (`extensions/workflow.ts:29`) and registers aliases during every trusted `session_start` (`extensions/workflow.ts:60-72`) but never unregisters or scopes them to the current project/trust context. Execution is still trust-gated, but command discovery/UX can expose names from another trusted repo and accumulate stale commands. Remediation: prefer one generic context-aware `/workflow:<name>` dispatcher, or use a session-scoped registration/unregistration API; do not store cross-project workflow metadata in process-global command aliases.
- Medium: Workflow settings writes are unqueued, non-atomic read/modify/write operations. Commands call `writeGlobalWorkflowSettings`/`writeProjectWorkflowSettings` directly (`extensions/workflow.ts:261-267`), and `writeWorkflowSettingsFile` reads existing JSON, merges, then `writeFile`s (`src/workflow/settings.ts:102-115`) without `withFileMutationQueue`, temp+rename, or retry. Parallel commands or host edits can lose updates or leave partial files. Remediation: queue by exact settings path, re-read/merge inside the queue, and write via temp file + rename with cleanup.
- Low: Invalid workflows are silently hidden with no diagnostics. `readWorkflowReferenceIfValid` catches all parse/metadata errors and returns `undefined` (`src/discovery.ts:63-68`), and `/workflow` then only reports found names/no workflows (`extensions/workflow.ts:94-99`). This protects startup, but gives users/agents no evidence to fix a broken workflow. Remediation: keep discovery non-fatal but log skipped workflow path + error at debug/info, and optionally expose skipped invalid workflows in `/workflow` usage or `/workflow-settings` diagnostics.
- Low: `workflowDirs` settings semantics are inconsistent. The settings model and merged reader include `workflowDirs` (`src/workflow/settings.ts:5-13`, `src/workflow/settings.ts:29-32`), while discovery roots read only project settings directly (`src/discovery.ts:17-23`). If global workflow dirs are intended, they are ignored; if not intended, the merged settings shape overstates the contract. Remediation: either route workflow root resolution through the merged trusted settings reader, or remove/clarify global `workflowDirs` support and document project-only roots.

- Note: Existing review artifacts already cover higher-priority unresolved items not repeated here: reload terminal delivery/stale contexts (`review-round-2/lifecycle-reload.md`), child-agent trust propagation and untrusted settings UX (`review-round-2/trust-ux.md`), wildcard peers/CONFIG_DIR docs (`review-round-2/package-config.md`), and workflow publish concurrency (`review-round-2/file-mutation-concurrency.md`).
- Note: Validation in this holistic pass was static inspection only; prior artifacts report passing `npm test`/typecheck/docs/loadcheck, but I did not rerun the full suite here.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings include severity plus file:line evidence for extensions/workflow.ts, src/tools.ts, src/workflow/settings.ts, src/discovery.ts, src/request.ts, and tests."
    }
  ],
  "changedFiles": [
    "review-round-2/holistic-pi-best-practices.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short && git diff --stat && git diff -- . ':(exclude)review-round-2/holistic-pi-best-practices.md'",
      "result": "passed",
      "summary": "Inspected current modified/untracked files and current diff."
    },
    {
      "command": "read review-round-2/{lifecycle-reload.md,trust-ux.md,package-config.md,file-mutation-concurrency.md}",
      "result": "passed",
      "summary": "Reviewed prior round-2 artifacts and deduplicated their findings."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files were listed."
    }
  ],
  "validationOutput": [
    "Static review of current diff and cited files completed.",
    "No full test suite rerun in this pass; prior artifacts reported passing test/typecheck/docs/loadcheck where noted."
  ],
  "residualRisks": [
    "Prior unresolved findings remain in the four referenced review artifacts and should be addressed before release.",
    "Full npm run check was not rerun during this concise holistic pass."
  ],
  "noStagedFiles": true,
  "diffSummary": "Current diff adds trust-aware workflow discovery/settings/tools, pi config-dir path centralization, running-workflow UI disposal, dependency updates, docs/tests updates, and a new config-dir module.",
  "reviewFindings": [
    "medium: extensions/workflow.ts:29 and 60-72 - dynamic workflow aliases are process-global and never unregistered, leaking stale cross-project workflow names/descriptions; use session-scoped/context-aware aliasing.",
    "medium: extensions/workflow.ts:261-267 and src/workflow/settings.ts:102-115 - workflow settings writes are unqueued non-atomic read/modify/write operations; queue by settings path and write temp+rename.",
    "low: src/discovery.ts:63-68 - invalid workflows are silently skipped without diagnostics; log or surface skipped workflow path/error while keeping discovery non-fatal.",
    "low: src/workflow/settings.ts:5-13,29-32 and src/discovery.ts:17-23 - workflowDirs is in merged settings but discovery reads only project settings; clarify or implement global workflowDirs semantics."
  ],
  "manualNotes": "No project/source files were modified; only the required review artifact was written."
}
```
