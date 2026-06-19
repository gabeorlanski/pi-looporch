import assert from "node:assert/strict";
import { test } from "node:test";
import { naturalLanguageRequestMessage, selectionPrompt } from "../src/prompt-templates.ts";

void test("natural_language_workflow_command_steers_current_session_to_tools", () => {
  const message = naturalLanguageRequestMessage("create a workflow named smoke-created", ["echo"]);

  assert.match(message, /current session/);
  assert.match(message, /run_workflow/);
  assert.match(message, /propose_workflow/);
  assert.match(message, /must not import modules/);
  assert.match(message, /JSDoc/);
  assert.match(message, /Available workflow globals/);
  assert.match(message, /phase, log, trace, args/);
  assert.match(message, /bare relative paths resolve from project cwd/);
  assert.match(message, /@workflow\/\.\.\. resolves inside the workflow directory/);
  assert.match(message, /echo/);
});

void test("workflow_selection_prompt_includes_rendered_authoring_guide", () => {
  const message = selectionPrompt("create a workflow named smoke-created", []);

  assert.match(message, /Workflow source requirements/);
  assert.match(message, /JSDoc/);
  assert.match(message, /Available workflow globals/);
  assert.match(message, /agent\(prompt: string/);
  assert.match(message, /bare relative paths resolve from project cwd/);
  assert.match(message, /@workflow\/\.\.\. resolves inside the workflow directory/);
});
