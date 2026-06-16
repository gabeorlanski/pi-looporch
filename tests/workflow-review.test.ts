import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowApprovalLines } from "../src/workflow-review.ts";
import type { GeneratedWorkflowDraft } from "../src/workflow-request.ts";

void test("workflow_approval_lines_render_spaced_checklist_review", () => {
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
    "╭─ Workflow approval ──────────────────────────────────────────────────────────╮",
    "│ smoke-created                                                                │",
    "│ Return prompt                                                                │",
    "├─ Review ─────────────────────────────────────────────────────────────────────┤",
    "│ Goal                                                                         │",
    "│   Create a smoke test workflow.                                              │",
    "│                                                                              │",
    "│ Steps                                                                        │",
    "│   1. Read args.prompt                                                        │",
    "│   2. Return the prompt                                                       │",
    "│                                                                              │",
    "│ What will run                                                                │",
    "│   • Save .pi/workflows/smoke-created/workflow.js                             │",
    "├─ Decision ───────────────────────────────────────────────────────────────────┤",
    "│ Approve only if this matches your intent.                                    │",
    "│ y approve · n reject · Esc reject                                            │",
    "╰──────────────────────────────────────────────────────────────────────────────╯",
  ]);
});

void test("workflow_approval_lines_wrap_long_content_inside_frame", () => {
  const draft: GeneratedWorkflowDraft = {
    name: "reports2phase2",
    source: "ignored",
    metadata: {
      name: "reports2phase2",
      description: "Convert repo2plan report directories into staged Library Design Bench phase-2 steps.",
    },
    proposal: {
      summary:
        "Create a reusable staged workflow that turns repo2plan-style report directories into a Library Design Bench phase-2 step under a target phase_2 directory.",
      steps: ["Load and summarize the report files from the reports directory and inspect the target phase_2 shape."],
      willRun: ["Read report files from scratch/sg_repos/dagistan/reports/awslabs__aws-service-catalog-puppet by default."],
    },
  };

  const lines = workflowApprovalLines(draft);

  assert.ok(lines.every((line) => line.length === lines[0].length));
  assert.ok(lines.includes("│ Convert repo2plan report directories into staged Library Design Bench        │"));
  assert.ok(lines.includes("│ phase-2 steps.                                                               │"));
  assert.ok(lines.includes("│   Create a reusable staged workflow that turns repo2plan-style report        │"));
  assert.ok(lines.includes("│   directories into a Library Design Bench phase-2 step under a target        │"));
  assert.ok(lines.includes("│   phase_2 directory.                                                         │"));
});
