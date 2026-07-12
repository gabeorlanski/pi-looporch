import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkDocumentationContracts, docsSynchronizationIssues, shouldCheckDocstrings } from "../scripts/check-doc-contracts.ts";

void test("documentation contracts require JSDoc on exports", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-doc-contracts-"));
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(
    path.join(project, "src", "tools.ts"),
    `export interface MissingOptions { value: string; }

/** Build tools for callers. */
export function documented(): void {}

function privateHelper(): void {}
`,
    "utf8",
  );

  const result = checkDocumentationContracts({ cwd: project, staged: false });

  assert.deepEqual(result.issues, [
    {
      filePath: "src/tools.ts",
      line: 1,
      message: "exported interface MissingOptions is missing a leading JSDoc contract",
    },
  ]);
});

void test("staged documentation checks only public source", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-doc-contracts-"));
  await mkdir(path.join(project, "src"), { recursive: true });
  await mkdir(path.join(project, "tests"), { recursive: true });
  await writeFile(path.join(project, "src", "tools.ts"), "export function missing(): void {}\n", "utf8");
  await writeFile(path.join(project, "tests", "tools.test.ts"), "export function helper(): void {}\n", "utf8");

  const result = checkDocumentationContracts({ cwd: project, staged: true, stagedFiles: ["tests/tools.test.ts"] });

  assert.deepEqual(result.issues, []);
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

void test("documentation scope skips tests and primitives", () => {
  assert.equal(shouldCheckDocstrings("src/tools.ts"), true);
  assert.equal(shouldCheckDocstrings("extensions/workflow.ts"), true);
  assert.equal(shouldCheckDocstrings("src/runtime/primitives/agent.ts"), false);
  assert.equal(shouldCheckDocstrings("tests/tools.test.ts"), false);
});
