import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWorkflowInput } from "../src/input.ts";
import { extractWorkflowInputContract, validateWorkflowInput } from "../src/workflow/input-contract.ts";

void test("workflow_input_uses_structured_json_directly", () => {
  const parsed = parseWorkflowInput('{"repo":"owner/name","problem":"bugs"}');

  assert.deepEqual(parsed, { action: "use", input: { repo: "owner/name", problem: "bugs" } });
});

void test("workflow_input_uses_key_value_directly", () => {
  assert.deepEqual(parseWorkflowInput('repo=owner/name --problem @problems/python_dag/ files=a.ts,b.ts note="hello world"'), {
    action: "use",
    input: {
      repo: "owner/name",
      problem: "@problems/python_dag/",
      files: ["a.ts", "b.ts"],
      note: "hello world",
    },
  });
});

void test("input leaves freeform text for session resolution", () => {
  assert.deepEqual(parseWorkflowInput("scratch/repo @problems/python_dag/ is the problem."), {
    action: "resolve",
    rawInput: "scratch/repo @problems/python_dag/ is the problem.",
  });
});

void test("workflow_input_contract_uses_function_signature_and_jsdoc", () => {
  const contract =
    extractWorkflowInputContract(`export const metadata = { name: "plan", description: "Plan", inputInstructions: "Resolve inputs.", phases: [{ title: "Run" }] };
/**
 * Input: repo and problem are required; mode defaults to fast.
 * Phase: plan.
 * Agent: one planner.
 * Result: plan text.
 * @param {object} input
 * @param {string} input.problem - Problem statement.
 */
export default async function workflow({ repo, mode = "fast" }) {
  return { repo, mode };
}`);

  assert.deepEqual(contract.requiredFields, ["problem", "repo"]);
  assert.deepEqual(contract.optionalFields, ["mode"]);
  assert.match(contract.signature ?? "", /repo/);
  assert.match(contract.jsdoc ?? "", /input\.problem/);
});

void test("workflow_input_validation_reports_missing_required_fields", () => {
  assert.throws(
    () =>
      validateWorkflowInput({ repo: "owner/name" }, "plan", {
        requiredFields: ["repo", "problem"],
        optionalFields: ["mode"],
        signature: "workflow({ repo, problem, mode = 'fast' })",
      }),
    /Workflow 'plan' is missing required input: problem[\s\S]*problem=<value>/,
  );
});
