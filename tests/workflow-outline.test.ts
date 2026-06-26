import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  PROMPT_CHAR_DANGER_THRESHOLD,
  PROMPT_CHAR_WARNING_THRESHOLD,
  parseWorkflowOutline,
  indexOutlineStages,
} from "../src/workflow-outline.ts";

const DEMO_SOURCE = `/**
 * Purpose: demo workflow for outline parsing.
 * Args: { topic, files }.
 * Phase: research, fanout, synthesis.
 * Agent: research/facts/review/synthesis agents.
 * Result: final text.
 */
export const metadata = { name: "demo", description: "Demo workflow", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };

export default async function workflow() {
  phase("research");
  const research = await agent("Research the topic.", { label: "research", model: "gpt-5", reasoning: "low" });
  const facts = await agent(\`Find facts about \${args.topic}\`, { label: "facts" });

  phase("fanout");
  const reviews = await parallel(args.files, (file) => agent("Review " + file, { label: "review" }), { label: "reviews" });

  phase("synthesis");
  const data = await coerce({ schema: {}, prompt: "Extract a title.", label: "extract" });
  return agent("Write the final answer.", { label: "synthesis" });
}
`;

void test("outline_groups_stages_by_phase_with_metadata_and_jsdoc", () => {
  const outline = parseWorkflowOutline(DEMO_SOURCE);

  assert.equal(outline.metadata.name, "demo");
  assert.equal(outline.metadata.description, "Demo workflow");
  assert.deepEqual(outline.metadata.phases, [{ title: "Run" }]);
  assert.ok(outline.jsdoc?.includes("Purpose: demo workflow"));
  assert.deepEqual(
    outline.sections.map((section) => section.phase),
    ["research", "fanout", "synthesis"],
  );
  assert.equal(outline.sections[0].stages.length, 2);
  assert.equal(outline.sections[2].stages.length, 2);
});

void test("outline_extracts_agent_options_and_classifies_prompts", () => {
  const outline = parseWorkflowOutline(DEMO_SOURCE);
  const [research, facts] = outline.sections[0].stages;

  assert.equal(research.kind, "agent");
  assert.equal(research.label, "research");
  assert.equal(research.model, "gpt-5");
  assert.equal(research.reasoning, "low");
  assert.equal(research.prompts[0].source, "literal");
  assert.equal(research.prompts[0].editable, true);
  assert.equal(research.prompts[0].text, "Research the topic.");
  assert.equal(research.prompts[0].charCount, "Research the topic.".length);
  assert.equal(research.prompts[0].sizeWarning, undefined);

  assert.equal(facts.prompts[0].source, "template-literal");
  assert.equal(facts.prompts[0].editable, false);
  assert.ok(facts.prompts[0].text.includes("${args.topic}"));
});

void test("outline_nests_parallel_worker_agents_as_children", () => {
  const outline = parseWorkflowOutline(DEMO_SOURCE);
  const fanout = outline.sections[1].stages[0];

  assert.equal(fanout.kind, "parallel");
  assert.equal(fanout.label, "reviews");
  assert.equal(fanout.children.length, 1);
  assert.equal(fanout.children[0].kind, "agent");
  assert.equal(fanout.children[0].label, "review");
  assert.equal(fanout.children[0].prompts[0].source, "expression");
});

void test("outline_resolves_simple_helper_function_stage_calls", () => {
  const source = `export const metadata = { name: "helpers", description: "Helpers", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
async function child(item) {
  return agent("Review " + item, { label: "review helper", reasoning: "medium" });
}
async function build(item) {
  const first = await child(item);
  return agent("Summarize " + first, { label: "summarize helper", reasoning: "high" });
}
export default async function workflow() {
  phase("Run");
  return parallel(args.items, (item) => build(item), { label: "helper fanout" });
}
`;
  const outline = parseWorkflowOutline(source);
  const fanout = outline.sections[0].stages[0];

  assert.equal(fanout.kind, "parallel");
  assert.equal(fanout.children.length, 2);
  assert.equal(fanout.children[0].label, "review helper");
  assert.equal(fanout.children[0].reasoning, "medium");
  assert.equal(fanout.children[1].label, "summarize helper");
  assert.equal(fanout.children[1].reasoning, "high");
});

void test("outline_extracts_coerce_prompt_role", () => {
  const outline = parseWorkflowOutline(DEMO_SOURCE);
  const coerceStage = outline.sections[2].stages[0];

  assert.equal(coerceStage.kind, "coerce");
  assert.equal(coerceStage.prompts[0].role, "prompt");
  assert.equal(coerceStage.prompts[0].text, "Extract a title.");
  assert.equal(coerceStage.prompts[0].editable, true);
});

void test("outline_extracts_mapreduce_and_verifier_prompt_roles", () => {
  const source = `export const metadata = { name: "mr", description: "Map reduce", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  await mapreduce({ inputPrompt: "split {{text}}", mapPrompt: "map {{item}}", reducePrompt: "reduce {{results}}", label: "mr" });
  return verifier({ criteria: [], criteriaPrompt: "judge {{name}}", reducePrompt: "tally {{votes}}", label: "v" });
}
`;
  const outline = parseWorkflowOutline(source);
  const [mapreduceStage, verifierStage] = outline.sections[0].stages;

  assert.deepEqual(
    mapreduceStage.prompts.map((prompt) => prompt.role),
    ["inputPrompt", "mapPrompt", "reducePrompt"],
  );
  assert.deepEqual(
    verifierStage.prompts.map((prompt) => prompt.role),
    ["criteriaPrompt", "reducePrompt"],
  );
});

void test("outline_classifies_renderPrompt_without_template_dir", () => {
  const source = `export const metadata = { name: "rp", description: "Render prompt", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent(renderPrompt("base.txt", { x: 1 }), { label: "r" });
}
`;
  const outline = parseWorkflowOutline(source);
  const prompt = outline.sections[0].stages[0].prompts[0];

  assert.equal(prompt.source, "renderPrompt");
  assert.equal(prompt.editable, false);
  assert.equal(prompt.templatePath, "base.txt");
  assert.ok(prompt.text.includes("renderPrompt"));
});

void test("outline_reads_renderPrompt_template_from_workflow_prompts_directory", () => {
  const project = mkdtempSync(path.join(tmpdir(), "pi-workflow-outline-"));
  const workflowDir = path.join(project, ".pi", "workflows", "rp");
  mkdirSync(path.join(workflowDir, "prompts"), { recursive: true });
  writeFileSync(path.join(workflowDir, "prompts", "base.txt"), "Review {{file}}.", "utf8");
  const source = `export const metadata = { name: "rp", description: "Render prompt", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent(renderPrompt("base.txt", { file: args.file }), { label: "r" });
}
`;
  const outline = parseWorkflowOutline(source, { workflowDir });
  const prompt = outline.sections[0].stages[0].prompts[0];

  assert.equal(prompt.source, "renderPrompt");
  assert.equal(prompt.text, "Review {{file}}.");
  assert.equal(prompt.charCount, "Review {{file}}.".length);
});

void test("outline_warns_when_prompt_exceeds_character_thresholds", () => {
  const warningPrompt = "w".repeat(PROMPT_CHAR_WARNING_THRESHOLD);
  const dangerPrompt = "d".repeat(PROMPT_CHAR_DANGER_THRESHOLD);
  const source = `export const metadata = { name: "large", description: "Large prompts", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  await agent(${JSON.stringify(warningPrompt)}, { label: "warn" });
  return agent(${JSON.stringify(dangerPrompt)}, { label: "danger" });
}`;

  const outline = parseWorkflowOutline(source);
  const [warningStage, dangerStage] = outline.sections[0].stages;
  const warning = warningStage.prompts[0];
  const danger = dangerStage.prompts[0];

  assert.equal(warning.charCount, PROMPT_CHAR_WARNING_THRESHOLD);
  assert.deepEqual(warning.sizeWarning, { severity: "warning", threshold: PROMPT_CHAR_WARNING_THRESHOLD });
  assert.equal(danger.charCount, PROMPT_CHAR_DANGER_THRESHOLD);
  assert.deepEqual(danger.sizeWarning, { severity: "danger", threshold: PROMPT_CHAR_DANGER_THRESHOLD });
  assert.ok(outline.warnings.some((message) => message.includes("warn") && message.includes("4k chars")));
  assert.ok(outline.warnings.some((message) => message.includes("danger") && message.includes("12k chars")));
});

void test("outline_warns_about_dynamic_control_flow", () => {
  const source = `export const metadata = { name: "loopy", description: "Loops", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  for (const item of args.items) {
    await agent("Handle " + item, { label: "handle" });
  }
}
`;
  const outline = parseWorkflowOutline(source);

  assert.ok(outline.warnings.some((warning) => warning.includes("loops or conditionals")));
});

void test("index_outline_stages_maps_ids_to_phase_context", () => {
  const outline = parseWorkflowOutline(DEMO_SOURCE);
  const stages = indexOutlineStages(outline);
  const fanout = outline.sections[1].stages[0];

  assert.equal(stages.get(fanout.id)?.phase, "fanout");
  assert.equal(stages.get(fanout.children[0].id)?.phase, "fanout");
});
