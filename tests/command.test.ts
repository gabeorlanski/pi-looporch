import assert from "node:assert/strict";
import { test } from "node:test";
import { naturalLanguageRequestMessage } from "../src/prompt-templates.ts";

void test("natural_language_workflow_command_steers_current_session_to_tools_without_authoring_bloat", () => {
  const message = naturalLanguageRequestMessage("create a workflow named smoke-created", ["echo"]);

  assert.match(message, /current session/);
  assert.match(message, /run_workflow/);
  assert.match(message, /propose_workflow/);
  assert.match(message, /workflow_design_guidance\(\{ topic: "overview" \}\)/);
  assert.match(message, /Workflow primitives:/);
  assert.match(message, /`metadata` \(required\): `export const metadata/);
  assert.match(message, /`workflow` \(required\): `export default async function workflow\(input\)`/);
  assert.match(message, /`agent` \(optional\): `agent\(prompt, options\?\)`/);
  assert.doesNotMatch(message, /Bare workflow primitives/);
  assert.match(message, /echo/);
  assert.doesNotMatch(message, /Workflow source requirements/);
  assert.doesNotMatch(message, /Child-agent prompt quality requirements/);
  assert.doesNotMatch(message, /Available workflow globals/);
});
