import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  parseWorkflowOutline,
  applyPromptEdits,
  indexOutlinePrompts,
  indexOutlineStages,
  type OutlinePrompt,
} from "../src/workflow-outline.ts";
import { parseWorkflowSourceMetadata } from "../src/runtime.ts";

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

void test("apply_prompt_edits_splices_editable_prompt_into_valid_source", () => {
  const outline = parseWorkflowOutline(DEMO_SOURCE);
  const prompts = indexOutlinePrompts(outline);
  const editable = [...prompts.values()].find((prompt: OutlinePrompt) => prompt.editable && prompt.text === "Research the topic.");
  assert.ok(editable);

  const edited = applyPromptEdits(DEMO_SOURCE, outline, [{ promptId: editable.id, text: "Research the topic deeply." }]);

  assert.notEqual(edited, DEMO_SOURCE);
  assert.ok(edited.includes("Research the topic deeply."));
  assert.equal(parseWorkflowSourceMetadata(edited, "demo").name, "demo");
});

void test("apply_prompt_edits_rejects_non_editable_prompt", () => {
  const outline = parseWorkflowOutline(DEMO_SOURCE);
  const prompts = indexOutlinePrompts(outline);
  const readOnly = [...prompts.values()].find((prompt: OutlinePrompt) => !prompt.editable);
  assert.ok(readOnly);

  assert.throws(() => applyPromptEdits(DEMO_SOURCE, outline, [{ promptId: readOnly.id, text: "nope" }]), /not editable/);
});

void test("index_outline_stages_maps_ids_to_phase_context", () => {
  const outline = parseWorkflowOutline(DEMO_SOURCE);
  const stages = indexOutlineStages(outline);
  const fanout = outline.sections[1].stages[0];

  assert.equal(stages.get(fanout.id)?.phase, "fanout");
  assert.equal(stages.get(fanout.children[0].id)?.phase, "fanout");
});
