import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWorkflowInput, resolveWorkflowInput } from "../src/input.ts";
import type { WorkflowAgent } from "../src/runtime.ts";

void test("workflow_input_uses_structured_json_without_agent_resolution", async () => {
  let called = false;
  const agent: WorkflowAgent = () => {
    called = true;
    return Promise.resolve("{}");
  };

  const input = await resolveWorkflowInput({
    rawInput: '{"repo":"owner/name","problem":"bugs"}',
    workflowName: "repo2plan",
    metadata: { name: "repo2plan", description: "Plan repository fixes" },
    source: "export default async function workflow() { return args; }",
    agent,
  });

  assert.deepEqual(input, { repo: "owner/name", problem: "bugs" });
  assert.equal(called, false);
});

void test("workflow_input_uses_key_value_without_agent_resolution", () => {
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

void test("workflow_input_uses_agent_to_resolve_freeform_named_workflow_input", async () => {
  let prompt = "";
  const agent: WorkflowAgent = (agentPrompt) => {
    prompt = agentPrompt;
    return Promise.resolve(
      '{"repo":"scratch/repo_traverse/dagistan/repos/havrikov__codeine","problem":"@problems/python_dag/","prompt":"is the problem."}',
    );
  };

  const input = await resolveWorkflowInput({
    rawInput: "scratch/repo_traverse/dagistan/repos/havrikov__codeine @problems/python_dag/ is the problem.",
    workflowName: "repo2plan",
    metadata: { name: "repo2plan", description: "Turn a repository and problem into a plan" },
    source: "export default async function workflow() { return { repo: args.repo, problem: args.problem }; }",
    agent,
  });

  assert.match(prompt, /workflow\.js/);
  assert.match(prompt, /havrikov__codeine/);
  assert.deepEqual(input, {
    repo: "scratch/repo_traverse/dagistan/repos/havrikov__codeine",
    problem: "@problems/python_dag/",
    prompt: "is the problem.",
  });
});
