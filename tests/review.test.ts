import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalLines } from "../src/display/approval.ts";
import type { GeneratedWorkflowDraft } from "../src/request.ts";

void test("workflow_approval_lines_render_flowchart_and_feedback_hint", () => {
  const draft: GeneratedWorkflowDraft = {
    name: "smoke-created",
    source:
      "export const metadata = { name: 'smoke-created', description: 'Return prompt', inputInstructions: 'Use the workflow function JSDoc and signature to resolve input.', phases: [{ title: 'Run' }] };\nexport default async function workflow(args) {\nphase('run');\nawait agent(args.prompt, { label: 'echo' });\n}",
    metadata: {
      name: "smoke-created",
      description: "Return prompt",
      inputInstructions: "Use the workflow function JSDoc and signature to resolve input.",
      phases: [{ title: "Run" }],
    },
    proposal: {
      summary: "Create a smoke test workflow.",
      steps: ["Read args.prompt", "Return the prompt"],
      willRun: ["Save .pi/workflows/smoke-created/workflow.js"],
    },
    filePaths: ["workflow.js", "prompts/review.txt"],
  };

  const lines = approvalLines(draft);

  assert.ok(lines[0].includes("Review generated workflow: smoke-created"));
  assert.ok(lines.some((line) => line.includes("Flowchart")));
  assert.ok(lines.some((line) => line.includes("phase: run")));
  assert.ok(lines.some((line) => line.includes("agent: echo") && line.includes("think default")));
  assert.ok(lines.some((line) => line.includes("prompts/review.txt")));
  assert.ok(lines.some((line) => line.includes("Tab give feedback")));
  assert.ok(lines.every((line) => line.length === lines[0].length));
});

void test("workflow_approval_feedback_mode_shows_feedback_entry", () => {
  const draft: GeneratedWorkflowDraft = {
    name: "smoke-created",
    source: "await agent(args.prompt);",
    metadata: {
      name: "smoke-created",
      description: "Return prompt",
      inputInstructions: "Use the workflow function JSDoc and signature to resolve input.",
      phases: [{ title: "Run" }],
    },
    filePaths: ["workflow.js"],
    proposal: {
      summary: "Create a smoke test workflow.",
      steps: ["Read args.prompt"],
      willRun: ["Save .pi/workflows/smoke-created/workflow.js"],
    },
  };

  const lines = approvalLines(draft, { feedbackMode: true, feedback: "Use gpt-5-mini for the cheap scan." });

  assert.ok(lines.some((line) => line.includes("Feedback will be sent to the agent")));
  assert.ok(lines.some((line) => line.includes("> Use gpt-5-mini for the cheap scan.")));
  assert.ok(lines.every((line) => line.length === lines[0].length));
});

void test("workflow_approval_lines_wrap_long_content_inside_frame", () => {
  const draft: GeneratedWorkflowDraft = {
    name: "reports2phase2",
    source: "ignored",
    metadata: {
      name: "reports2phase2",
      description: "Convert repo2plan report directories into staged Library Design Bench phase-2 steps.",
      inputInstructions: "Use the workflow function JSDoc and signature to resolve input.",
      phases: [{ title: "Run" }],
    },
    filePaths: ["workflow.js"],
    proposal: {
      summary:
        "Create a reusable staged workflow that turns repo2plan-style report directories into a Library Design Bench phase-2 step under a target phase_2 directory.",
      steps: ["Load and summarize the report files from the reports directory and inspect the target phase_2 shape."],
      willRun: ["Read report files from scratch/sg_repos/dagistan/reports/awslabs__aws-service-catalog-puppet by default."],
    },
  };

  const lines = approvalLines(draft);

  assert.ok(lines.every((line) => line.length === lines[0].length));
  assert.ok(lines.some((line) => line.includes("Description: Convert repo2plan report directories into staged Library")));
  assert.ok(lines.some((line) => line.includes("phase-2 steps.")));
  assert.ok(lines.some((line) => line.includes("Flowchart")));
  assert.ok(lines.some((line) => line.includes("save: .pi/workflows/reports2phase2/")));
});
