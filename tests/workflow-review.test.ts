import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowApprovalLines } from "../src/workflow-review.ts";
import type { GeneratedWorkflowDraft } from "../src/workflow-request.ts";

void test("workflow_approval_lines_render_checklist_review", () => {
  const draft: GeneratedWorkflowDraft = {
    name: "smoke-created",
    source: "ignored",
    metadata: { name: "smoke-created", description: "Return prompt" },
    proposal: {
      summary: "Create a smoke test workflow.",
      steps: ["Read args.prompt", "Return the prompt"],
      willRun: ["Save .pi/workflows/smoke-created/workflow.js"],
    },
  };

  assert.deepEqual(workflowApprovalLines(draft), [
    "╭─ Workflow approval ─────────────────────────────╮",
    "│ smoke-created                                   │",
    "│ Return prompt                                   │",
    "├─ Review checklist ──────────────────────────────┤",
    "│ Goal                                            │",
    "│   Create a smoke test workflow.                 │",
    "│ Steps                                           │",
    "│   1. Read args.prompt                           │",
    "│   2. Return the prompt                          │",
    "│ What will run                                   │",
    "│   • Save .pi/workflows/smoke-created/workflow.js │",
    "├─ Decision ──────────────────────────────────────┤",
    "│ Approve only if this matches your intent.       │",
    "│ y approve · n reject · Esc reject               │",
    "╰─────────────────────────────────────────────────╯",
  ]);
});
