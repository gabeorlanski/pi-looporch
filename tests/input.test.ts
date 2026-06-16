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

void test("workflow_input_forwards_resolver_agent_progress", async () => {
  const progressMessages: string[] = [];
  const agent: WorkflowAgent = (_agentPrompt, _options, reportProgress) => {
    reportProgress({ statusMessage: "thinking", inputTokenCount: 120, outputTokenCount: 8, toolCallCount: 1 });
    reportProgress({ statusMessage: "finished readJson", inputTokenCount: 120, outputTokenCount: 16, toolCallCount: 1 });
    return Promise.resolve('{"prompt":"summarize the repo"}');
  };

  const input = await resolveWorkflowInput({
    rawInput: "summarize the repo",
    workflowName: "summarize",
    metadata: { name: "summarize", description: "Summarize files" },
    source: "export default async function workflow() { return args; }",
    agent,
    onProgress: (progress) => {
      if (progress.statusMessage) progressMessages.push(progress.statusMessage);
    },
  });

  assert.deepEqual(input, { prompt: "summarize the repo" });
  assert.deepEqual(progressMessages, ["thinking", "finished readJson"]);
});

void test("workflow_input_forwards_resolver_session_log_context", async () => {
  let sessionLog: unknown;
  const agent: WorkflowAgent = (_agentPrompt, options) => {
    sessionLog = options.sessionLog;
    return Promise.resolve('{"prompt":"summarize the repo"}');
  };

  await resolveWorkflowInput({
    rawInput: "summarize the repo",
    workflowName: "summarize",
    metadata: { name: "summarize", description: "Summarize files" },
    source: "export default async function workflow() { return args; }",
    agent,
    sessionLog: {
      parentId: "parent-1",
      agentId: 0,
      agentKey: "agent-000-input-resolution",
      workflowName: "summarize",
      label: "resolve summarize input",
      phaseIndex: 0,
    },
  });

  assert.deepEqual(sessionLog, {
    parentId: "parent-1",
    agentId: 0,
    agentKey: "agent-000-input-resolution",
    workflowName: "summarize",
    label: "resolve summarize input",
    phaseIndex: 0,
  });
});
