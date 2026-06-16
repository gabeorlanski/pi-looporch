import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowNaturalLanguageRequestMessage } from "../src/workflow-command.ts";

void test("natural_language_workflow_command_steers_current_session_to_tools", () => {
  const message = workflowNaturalLanguageRequestMessage("create a workflow named smoke-created", ["echo"]);

  assert.match(message, /current session/);
  assert.match(message, /run_workflow/);
  assert.match(message, /propose_workflow/);
  assert.match(message, /must not import modules/);
  assert.match(message, /echo/);
});
