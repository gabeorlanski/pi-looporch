/** Verifies repository documentation-map and staged-documentation contracts. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  checkDocumentationContracts,
  docsSynchronizationIssues,
  requiredDocumentationDirectories,
} from "../scripts/check-doc-contracts.ts";

void test("documentation contracts require a local AGENTS map for source and docs directories", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-doc-contracts-"));
  await mkdir(path.join(project, "src", "runtime"), { recursive: true });
  await writeFile(path.join(project, "src", "runtime", "queue.ts"), "/** Queue module. */\nexport {};\n", "utf8");

  const result = checkDocumentationContracts({ cwd: project, staged: false });

  assert.deepEqual(result.issues, [
    { filePath: "src/runtime", line: 1, message: "directory with maintained source or docs must contain a concise AGENTS.md map" },
  ]);
});

void test("documentation directory discovery excludes tests and prompt-only directories", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-doc-contracts-"));
  await mkdir(path.join(project, "tests"), { recursive: true });
  await mkdir(path.join(project, "src", "prompts"), { recursive: true });
  await writeFile(path.join(project, "tests", "tool.test.ts"), "export {};\n", "utf8");
  await writeFile(path.join(project, "src", "prompts", "guide.txt"), "guide\n", "utf8");

  assert.deepEqual(requiredDocumentationDirectories(project), []);
});

void test("behavior changes require staged documentation", () => {
  assert.deepEqual(docsSynchronizationIssues(["src/tools.ts"]), [
    {
      filePath: "<staged files>",
      line: 1,
      message: "behavior-surface changes must stage a documentation update in README.md, AGENTS.md, docs/**, or agent_docs/**",
    },
  ]);
  assert.deepEqual(docsSynchronizationIssues(["src/tools.ts", "README.md"]), []);
  assert.deepEqual(docsSynchronizationIssues(["tests/tools.test.ts"]), []);
});
