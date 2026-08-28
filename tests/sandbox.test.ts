import assert from "node:assert/strict";
import { test } from "node:test";
import { compileWorkflow } from "../src/workflow/sandbox.ts";

const metadata = `export const metadata = { name: "check", description: "Check source", inputInstructions: "No input.", phases: [{ title: "Run" }] };`;

void test("workflow compilation exposes only declared globals", () => {
  const compiled = compileWorkflow(
    `${metadata}
export default function workflow() {
  return typeof process;
}`,
    "workflow.js",
    {},
  );

  assert.equal(compiled.workflow({}), "undefined");
});

void test("workflow compilation rejects module loading syntax", () => {
  assert.throws(
    () =>
      compileWorkflow(
        `import fs from "node:fs";
${metadata}
export default function workflow() {
  return fs.existsSync(".");
}`,
        "workflow.js",
        {},
      ),
    /cannot import modules/,
  );
  assert.throws(
    () =>
      compileWorkflow(
        `${metadata}
export default function workflow() {
  return require("node:fs");
}`,
        "workflow.js",
        {},
      ),
    /cannot use require/,
  );
});
