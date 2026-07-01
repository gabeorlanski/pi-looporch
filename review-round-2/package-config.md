## Review

- Correct: `package.json` declares the pi package manifest at `package.json:20-23`, and `npm run pack:dry` showed the published tarball includes the extension entry plus `src/`/`README.md` without bundling `node_modules` or `package-lock.json`.
- Correct: The changed lockfile root matches the package dependency shape: runtime `typescript` is present at `package.json:64-66` and `package-lock.json:11-13`; pi/typebox are peers/dev-time at `package.json:41-57` and `package-lock.json:14-31`.
- Correct: Runtime project config paths now use the pi distribution config constant through `src/workflow/config-dir.ts:1-4`, with call sites such as workflow discovery/settings/path resolution using `PROJECT_CONFIG_DIR` instead of a hard-coded project directory.
- Correct: Validation passed for `npm run lint`, `npm run docs:check`, `npm run typecheck`, `npm test`, `npm run loadcheck`, and `npm run pack:dry` on the current installed pi; `npm test` passed 90 tests and loadcheck loaded the extension.
- Fixed: None; review-only task and no source edits were made.
- Blocker: `package.json:41-44` declares `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` as `"*"` peers, but the code now requires current pi APIs such as `CONFIG_DIR_NAME` (`src/workflow/config-dir.ts:1`) and `ctx.isProjectTrusted()` (`extensions/workflow.ts:34`, `extensions/workflow.ts:62`, `extensions/workflow.ts:251-253`, `src/tools.ts:121-123`, `src/tools.ts:224-226`). The dev/loadcheck version is only `^0.80.2` (`package.json:47-48`, `package-lock.json:33-36`), so npm/pi can accept older or future incompatible installed pi/typebox versions even though they are not validated. Remediation: replace wildcard peers with the actual supported ranges, e.g. `@earendil-works/pi-coding-agent`/`@earendil-works/pi-tui` `^0.80.2` (or the minimum version that first exposes these APIs) and a bounded TypeBox major range verified against both direct imports (`src/tools.ts:2`, `src/runtime/schema.ts:1-2`) and pi's bundled TypeBox. Update `package-lock.json` and run `npm run loadcheck` against the minimum supported pi version if possible.
- Note: User-facing workflow authoring guidance still hard-codes `.pi` even though runtime paths now follow `CONFIG_DIR_NAME`: `src/authoring-guide.ts:15`, `src/authoring-guide.ts:38-44`. README/spec examples also hard-code `.pi`/`~/.pi` at `README.md:27`, `README.md:56`, `README.md:92`, `README.md:156-157`, `docs/specs/workflow-system.md:129`, `docs/specs/workflow-system.md:145-147`. If this package is intended to work with renamed pi distributions, agents/users can be instructed to create drafts or look for settings in the wrong directory. Remediation: interpolate `PROJECT_CONFIG_DIR` in runtime guidance/tool strings and phrase docs as “the pi config dir (normally `.pi`)”; defer if the package explicitly targets only official pi.
- Note: Runtime dependency weight is acceptable for the current implementation but worth tracking. The only runtime dependency is `typescript` (`package.json:64-66`), and it is genuinely used by parsing/analysis code (`src/input.ts:1`, `src/workflow/metadata.ts:1`, `src/workflow/source-analysis.ts:1`). Replacing it with a lighter parser would reduce install weight, but that is a design tradeoff and should be deferred unless package size becomes a release goal.
- Note: `npm run format:check` failed, but only on existing review artifacts `review-round-2/lifecycle-reload.md` and `review-round-2/trust-ux.md`; source/package files were not identified in that failure. I did not modify those files because this task forbids source/project edits except the requested output artifact.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed package/distribution configuration only and wrote findings to review-round-2/package-config.md; no project/source files were modified by this review."
    }
  ],
  "changedFiles": [
    "review-round-2/package-config.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "npm run docs:check",
      "result": "passed",
      "summary": "Documentation contract checker completed with no findings."
    },
    {
      "command": "npm run typecheck",
      "result": "passed",
      "summary": "TypeScript no-emit check completed successfully."
    },
    {
      "command": "npm test",
      "result": "passed",
      "summary": "90 node:test tests passed."
    },
    {
      "command": "npm run loadcheck",
      "result": "passed",
      "summary": "pi loaded ./extensions/workflow.ts and reported no matching load-check model."
    },
    {
      "command": "npm run pack:dry",
      "result": "passed",
      "summary": "Dry-run tarball contained 64 files, package size 62.4 kB, unpacked size 243.5 kB."
    },
    {
      "command": "npm run lint",
      "result": "passed",
      "summary": "ESLint completed with zero warnings."
    },
    {
      "command": "npm run format:check",
      "result": "failed",
      "summary": "Prettier reported existing formatting issues in review-round-2/lifecycle-reload.md and review-round-2/trust-ux.md."
    },
    {
      "command": "git diff --check && git diff --name-only --cached",
      "result": "passed",
      "summary": "No whitespace errors and no staged files were reported."
    },
    {
      "command": "npx prettier --write review-round-2/package-config.md && npx prettier --check review-round-2/package-config.md",
      "result": "passed",
      "summary": "Formatted the requested review artifact and verified it passes Prettier."
    }
  ],
  "validationOutput": [
    "npm test: tests 90, pass 90, fail 0",
    "npm run loadcheck: No models matching \"__pi_workflow_load_check__\"",
    "npm run pack:dry: package size 62.4 kB; unpacked size 243.5 kB; total files 64",
    "npm run format:check failed on review artifact markdown files only"
  ],
  "residualRisks": [
    "Wildcard peerDependencies still need remediation before release because compatibility is only validated against pi 0.80.2.",
    "CONFIG_DIR_NAME-aware runtime paths and hard-coded .pi guidance remain inconsistent for non-official pi distributions.",
    "Full npm run check remains blocked until existing review-round-2 markdown formatting is addressed or excluded."
  ],
  "noStagedFiles": true,
  "diffSummary": "Review artifact added; repository source diff was inspected but not modified by this reviewer.",
  "reviewFindings": [
    "blocker: package.json:41 - wildcard peerDependencies do not encode the minimum pi/typebox APIs used by the code",
    "note: src/authoring-guide.ts:15 - runtime authoring guidance still hard-codes .pi despite CONFIG_DIR_NAME-backed paths",
    "note: package.json:64 - TypeScript is the only runtime dependency and is currently used, but remains the main package-weight tradeoff"
  ],
  "manualNotes": "plan.md and progress.md were requested but are absent at the repository root; review proceeded from the current diff and files."
}
```
