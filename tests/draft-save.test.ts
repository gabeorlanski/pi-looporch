import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readWorkflowDraft } from "../src/workflow/drafts.ts";
import { saveWorkflowDraft } from "../src/workflow/draft-save.ts";

const workflowSource = `/**
 * Input: a prompt to summarize.
 * Phase: writes a summary.
 * Agent: does not launch child agents.
 * Result: returns the prompt.
 */
export const metadata = { name: "summarize", description: "Summarize input", inputInstructions: "Provide prompt.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}
`;

void test("saving a draft preserves its workflow source and assets", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-draft-save-"));
  const draftDirectory = await mkdtemp(path.join(tmpdir(), "pi-workflow-draft-source-"));
  await mkdir(path.join(draftDirectory, "prompts"));
  await Promise.all([
    writeFile(path.join(draftDirectory, "workflow.js"), workflowSource, "utf8"),
    writeFile(path.join(draftDirectory, "prompts", "summary.txt"), "Summarize {{prompt}}", "utf8"),
  ]);

  await saveWorkflowDraft({
    cwd: project,
    draft: await readWorkflowDraft({ cwd: project, name: "summarize", draftDir: draftDirectory }),
  });

  const savedDirectory = path.join(project, ".pi", "workflows", "summarize");
  assert.equal(await readFile(path.join(savedDirectory, "workflow.js"), "utf8"), workflowSource);
  assert.equal(await readFile(path.join(savedDirectory, "prompts", "summary.txt"), "utf8"), "Summarize {{prompt}}");
});

void test("draft sources cannot overlap published workflows", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-draft-save-"));
  const publishedDirectory = path.join(project, ".pi", "workflows", "summarize");
  await mkdir(publishedDirectory, { recursive: true });
  await writeFile(path.join(publishedDirectory, "workflow.js"), workflowSource, "utf8");

  await assert.rejects(
    readWorkflowDraft({ cwd: project, name: "summarize", draftDir: publishedDirectory }),
    /must not be inside, equal to, or an ancestor of \.pi\/workflows/,
  );
});
