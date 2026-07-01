## Review

- Correct: Project workflow discovery is now explicitly trust-gated. `workflowRootsForProject` returns no roots when `projectTrusted` is false (`src/discovery.ts:17-27`), and the extension checks trust before `/workflow` discovery/runs (`extensions/workflow.ts:92`, `extensions/workflow.ts:118`).
- Correct: Project workflow settings are ignored when untrusted at the settings reader boundary (`src/workflow/settings.ts:29-32`), with coverage for untrusted settings (`tests/workflow-settings.test.ts:58-69`) and untrusted discovery (`tests/discovery.test.ts:63-74`).
- Correct: `run_workflow` and `propose_workflow` reject untrusted tool use before running/saving workflows (`src/tools.ts:43-49`, `src/tools.ts:146-157`), and `propose_workflow` now serializes saves through `withFileMutationQueue` (`src/tools.ts:156-157`).
- Correct: Trusted natural-language workflow input still stays in the visible current session; the regression test asserts `/workflow echo hello...` sends a visible prompt and does not invoke a hidden resolver (`tests/extension.test.ts:259-294`).
- Correct: Docs were updated to state that project workflows/settings are honored only after trust (`README.md:25-32`, `README.md:154-157`, `docs/specs/workflow-system.md:129`, `docs/specs/workflow-system.md:145`).

- Blocker: none found in the main extension command/tool trust gates.

- Note (high, trust-boundary): `createPiWorkflowAgent({ projectTrusted: false })` still creates a Pi `SettingsManager` with Pi's default trusted state. The workflow settings read is trust-aware (`src/pi-agent.ts:51`), but the child session settings manager is created without `{ projectTrusted: options.projectTrusted }` (`src/pi-agent.ts:52`) and is then passed to the child `DefaultResourceLoader` (`src/pi-agent.ts:53-60`). In the installed Pi API, `SettingsManager.fromStorage` defaults `projectTrusted` to `true` when omitted (`node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:152-155`). The extension's current command/tool paths block untrusted workflow runs before this is reached, but this public option is misleading and unsafe for direct/embedded callers. Remediation: pass `{ projectTrusted: options.projectTrusted }` when creating the default settings manager, and add a focused test proving false does not load project-local settings/resources.

- Note (medium, untrusted settings UX): `/workflow-settings` with no args can show global/default settings while still saying "Settings are merged from project settings over global settings" and listing the project settings path (`extensions/workflow.ts:274`, `extensions/workflow.ts:312-323`). That conflicts with the new behavior that untrusted projects expose no project workflow settings (`docs/specs/workflow-system.md:129`) because `readWorkflowSettings(..., false)` intentionally skips the project file (`src/workflow/settings.ts:29-32`). Remediation: make the display trust-aware, e.g. "Project settings are ignored until this project is trusted", or require trust before showing project-merged settings. Add an untrusted `/workflow-settings` display test.

- Note (low, command UX): `/workflow-review` emits "Reviewing workflow session logs..." before checking trust (`extensions/workflow.ts:370-374`). In an untrusted project the user sees an in-progress info notification followed by a trust warning even though no review runs. Remediation: move the trust check before the info notification and cover the untrusted path.

- Note (low, tests alignment): Tool-level untrusted behavior is not directly covered. `tests/tools.test.ts` uses trusted contexts for `run_workflow` and `propose_workflow` (`tests/tools.test.ts:86-93`, `tests/tools.test.ts:135-141`, `tests/tools.test.ts:164`), while the only untrusted command coverage is for `/workflow` (`tests/extension.test.ts:207-223`). Remediation: add `run_workflow` and `propose_workflow` rejection tests with `isProjectTrusted: () => false`, asserting no workflow is started and no draft is saved.

Validation notes:

- Requested task files `/home/gabe/Coding/pi-looporch/plan.md` and `/home/gabe/Coding/pi-looporch/progress.md` were absent (`ENOENT`), so this review proceeded from the current repository and diff.
- Ran `npm run typecheck`, `npm test`, and `npm run docs:check`; all passed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings cite src/pi-agent.ts:51-60, extensions/workflow.ts:274 and 312-323, extensions/workflow.ts:370-374, src/tools.ts:43-49 and 146-157, plus relevant tests/docs."
    }
  ],
  "changedFiles": [
    "review-round-2/trust-ux.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short",
      "result": "passed",
      "summary": "Showed modified source/docs/tests plus untracked review artifacts and src/workflow/config-dir.ts."
    },
    {
      "command": "git diff --stat && git diff -- <focused files>",
      "result": "passed",
      "summary": "Inspected the current trust/workflow UX diff across extension, tools, discovery, settings, docs, and tests."
    },
    {
      "command": "npm run typecheck",
      "result": "passed",
      "summary": "tsc --noEmit completed successfully."
    },
    {
      "command": "npm test",
      "result": "passed",
      "summary": "90 node:test tests passed, 0 failed."
    },
    {
      "command": "npm run docs:check",
      "result": "passed",
      "summary": "Documentation contract check completed successfully."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files listed."
    }
  ],
  "validationOutput": [
    "npm test: tests 90, pass 90, fail 0",
    "npm run typecheck: passed",
    "npm run docs:check: passed",
    "plan.md and progress.md read attempts returned ENOENT"
  ],
  "residualRisks": [
    "Full npm run check was not run; lint, format:check, and loadcheck remain unvalidated in this review pass.",
    "The high-severity pi-agent trust finding is mitigated on current extension command/tool paths because they block untrusted workflow runs before child-agent creation, but direct API callers remain exposed."
  ],
  "noStagedFiles": true,
  "diffSummary": "Current diff adds project-trust gating for workflow discovery/runs/settings/tools, centralizes the project config directory name, updates docs/tests, adds UI disposal on session shutdown, and updates pi dependency versions.",
  "reviewFindings": [
    "high: src/pi-agent.ts:52 - createPiWorkflowAgent does not propagate projectTrusted to SettingsManager.create, so direct untrusted child-agent use can still load project-local Pi settings/resources.",
    "medium: extensions/workflow.ts:274 and 312-323 - /workflow-settings display is not trust-aware and can imply project settings were merged when they were intentionally ignored.",
    "low: extensions/workflow.ts:370-374 - /workflow-review announces review work before rejecting untrusted projects.",
    "low: tests/tools.test.ts:86-93 and 135-164 - run_workflow/propose_workflow untrusted tool rejection lacks direct test coverage."
  ],
  "manualNotes": "No project/source files were modified; only the required review artifact was written."
}
```
