import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveWorkflowRequest } from "../src/workflow-request.ts";
import type { WorkflowAgent } from "../src/workflow-runtime.ts";

void test("generated_workflows_save_only_after_review", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-request-"));
  const source = `export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const agent: WorkflowAgent = async () => JSON.stringify({ action: "create", name: "summarize", source });
  const workflowFile = path.join(project, ".pi", "workflows", "summarize", "workflow.js");

  await assert.rejects(resolveWorkflowRequest({ cwd: project, request: "summarize", agent }), /require review/);
  assert.equal(existsSync(workflowFile), false);

  const resolved = await resolveWorkflowRequest({
    cwd: project,
    request: "summarize",
    agent,
    reviewer: () => ({ action: "approve" }),
  });

  assert.equal(resolved.action, "created");
  assert.equal((await readFile(workflowFile, "utf8")).trim(), source);
});
