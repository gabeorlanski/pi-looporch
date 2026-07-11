import assert from "node:assert/strict";
import { test } from "node:test";
import { naturalLanguageRequestMessage } from "../src/prompt-templates.ts";
import { defaultWorkflowDraftRoot } from "../src/workflow/drafts.ts";

void test("natural language workflow requests steer to tools", () => {
  const message = naturalLanguageRequestMessage("create a workflow named smoke-created", ["echo"]);

  assert.match(message, /current session/);
  assert.match(message, /run_workflow/);
  assert.match(message, /propose_workflow/);
  assert.match(message, /workflow_design_guidance\(\{ topic: "overview" \}\)/);
  assert.match(message, /MUST try to resolve clear ambiguities/);
  assert.match(message, /Infer the workflow purpose, inputs\/defaults, phases, child-agent roles, file reads, and result shape/);
  assert.match(message, new RegExp(escapeRegExp(defaultWorkflowDraftRoot())));
  assert.match(message, /omit draftDir when using that default location/);
  assert.match(message, /echo/);
  assert.doesNotMatch(message, /Available workflow globals/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
