import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import { createExtensionHarness, waitForCondition, writeProjectWorkflow } from "./extension-harness.ts";

void test("dummy workflow command initializes a schema child agent through Pi", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-e2e-"));
  await writeProjectWorkflow(
    project,
    "dummy",
    `export const metadata = { name: "dummy", description: "Run deterministic schema child", inputInstructions: "No input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  const child = await agent("Return the deterministic status.", {
    schema: {
      type: "object",
      properties: { status: { type: "string" } },
      required: ["status"],
    },
    extensions: [],
    tools: [],
  });
  return { status: child.status };
}`,
  );
  let modelRuntimeReachedSession = false;
  let promptRan = false;
  const harness = createExtensionHarness({
    cwd: project,
    extensionDependencies: {
      createAgent: (options) =>
        createPiWorkflowAgent({
          ...options,
          tools: [],
          createSession: (sessionOptions) => {
            modelRuntimeReachedSession = sessionOptions?.modelRuntime !== undefined;
            return {
              session: {
                model: undefined,
                messages: [],
                subscribe: () => () => undefined,
                prompt: async () => {
                  promptRan = true;
                  const structuredOutput = sessionOptions?.customTools?.find((tool) => tool.name === "StructuredOutput");
                  if (!structuredOutput) throw new Error("Expected StructuredOutput");
                  await structuredOutput.execute("dummy-output", { status: "ok" }, undefined, undefined, {
                    abort: () => undefined,
                  } as never);
                },
                getSessionStats: () => ({ tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 } }),
                dispose: () => undefined,
              },
            } as never;
          },
        }),
    },
  });

  await harness.sessionStart();
  await harness.command("workflow:dummy", "");
  await waitForCondition(() => harness.sentUserMessages.length === 1);

  assert.equal(modelRuntimeReachedSession, true);
  assert.equal(promptRan, true);
  const handoff = harness.sentUserMessages[0];
  if (typeof handoff.message !== "string") throw new TypeError("Expected text workflow handoff");
  assert.match(handoff.message, /<workflow_handoff event="completed">/);
  const resultPath = /Workflow result: (.*final\.json)/.exec(handoff.message)?.[1];
  assert.ok(resultPath);
  assert.deepEqual(JSON.parse(await readFile(resultPath, "utf8")), { status: "ok" });
});
