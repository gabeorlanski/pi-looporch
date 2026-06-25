import assert from "node:assert/strict";
import { test } from "node:test";
import { PROMPT_CHAR_WARNING_THRESHOLD, parseWorkflowOutline } from "../src/workflow-outline.ts";
import {
  buildChangeRequest,
  defaultExpanded,
  flattenReviewNodes,
  promptCommentKey,
  renderWorkflowReview,
  reviewHasFeedback,
  type ReviewComment,
} from "../src/display/workflow-review.ts";

const SOURCE = `export const metadata = { name: "demo", description: "Demo workflow", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
/**
 * args: a topic string.
 * phase: Search then Synthesize.
 * agent: web searchers and a writer.
 * result: a report.
 */
export default async function workflow() {
  phase("Search");
  const hits = await agent("Search the web for the given topic and collect sources.", {
    label: "search-web",
    model: "opus",
    reasoning: "high",
  });
  phase("Synthesize");
  return agent("Write a cited report from the sources.", { label: "write-report" });
}
`;

function outline() {
  return parseWorkflowOutline(SOURCE);
}

void test("default_expanded_includes_every_section_and_stage", () => {
  const parsed = outline();
  const expanded = defaultExpanded(parsed);
  const nodes = flattenReviewNodes(parsed, expanded);
  const kinds = nodes.map((node) => node.kind);
  assert.ok(kinds.includes("section"));
  assert.ok(kinds.includes("stage"));
  // Prompts are revealed because their parent stage is expanded by default.
  assert.ok(kinds.includes("prompt"));
  const stageLabels = nodes.filter((node) => node.kind === "stage").map((node) => node.label);
  assert.deepEqual(stageLabels, ["search-web", "write-report"]);
});

void test("collapsing_a_section_hides_its_stages", () => {
  const parsed = outline();
  const expanded = defaultExpanded(parsed);
  const sectionId = flattenReviewNodes(parsed, expanded).find((node) => node.kind === "section" && node.label.includes("Search"))?.id;
  assert.ok(sectionId);
  expanded.delete(sectionId);
  const nodes = flattenReviewNodes(parsed, expanded);
  assert.ok(!nodes.some((node) => node.label === "search-web"));
  // The other section's stage remains visible.
  assert.ok(nodes.some((node) => node.label === "write-report"));
});

void test("prompt_nodes_carry_a_composite_comment_key", () => {
  const parsed = outline();
  const nodes = flattenReviewNodes(parsed, defaultExpanded(parsed));
  const prompt = nodes.find((node) => node.kind === "prompt");
  const stage = nodes.find((node) => node.kind === "stage");
  assert.ok(prompt && stage && prompt.stageId && prompt.promptId);
  assert.equal(prompt.commentKey, promptCommentKey(prompt.stageId, prompt.promptId));
  assert.equal(stage.commentKey, stage.stageId);
});

void test("review_has_feedback_detects_notes_and_general_comment", () => {
  const empty = new Map<string, ReviewComment>();
  assert.equal(reviewHasFeedback(empty, "   "), false);
  assert.equal(reviewHasFeedback(empty, "tighten the prompt"), true);
  const withNote = new Map<string, ReviewComment>([["stage-1", { stageId: "stage-1", text: "use a cheaper model" }]]);
  assert.equal(reviewHasFeedback(withNote, ""), true);
});

void test("build_change_request_includes_general_and_targeted_notes", () => {
  const parsed = outline();
  const nodes = flattenReviewNodes(parsed, defaultExpanded(parsed));
  const stage = nodes.find((node) => node.label === "search-web");
  assert.ok(stage?.stageId);
  const comments = new Map<string, ReviewComment>([[stage.stageId, { stageId: stage.stageId, text: "Limit to five sources." }]]);
  const request = buildChangeRequest(parsed, comments, "Overall this is close.");
  assert.match(request, /requested changes/);
  assert.match(request, /Overall this is close\./);
  assert.match(request, /Targeted notes:/);
  assert.match(request, /\[search-web · phase 'Search'\] Limit to five sources\./);
});

void test("render_shows_metadata_thinking_level_and_footer", () => {
  const parsed = outline();
  const lines = renderWorkflowReview(
    parsed,
    {
      selectedIndex: 0,
      expanded: defaultExpanded(parsed),
      comments: new Map(),
      generalComment: "",
      height: 40,
    },
    100,
  );
  const text = lines.join("\n");
  assert.match(text, /review workflow demo/);
  assert.match(text, /Phase: Search/);
  assert.match(text, /AGENT/);
  assert.match(text, /opus/);
  assert.match(text, /think high/);
  assert.match(text, /55 chars/);
  assert.match(text, /Ctrl\+O expand/);
  assert.match(text, /a approve · r request changes/);
});

void test("render_warns_for_large_prompt_character_counts", () => {
  const largePrompt = "x".repeat(PROMPT_CHAR_WARNING_THRESHOLD);
  const parsed =
    parseWorkflowOutline(`export const metadata = { name: "large", description: "Large workflow", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent(${JSON.stringify(largePrompt)}, { label: "large-review" });
}`);
  const lines = renderWorkflowReview(
    parsed,
    {
      selectedIndex: 0,
      expanded: defaultExpanded(parsed),
      comments: new Map(),
      generalComment: "",
      height: 40,
    },
    120,
  );
  const text = lines.join("\n");

  assert.match(text, /⚠/);
  assert.match(text, /large-review prompt is 4k chars/);
  assert.match(text, /1 prompt · 4k chars/);
});

void test("render_shows_editor_box_when_editing_general_comment", () => {
  const parsed = outline();
  const lines = renderWorkflowReview(
    parsed,
    {
      selectedIndex: 0,
      expanded: defaultExpanded(parsed),
      comments: new Map(),
      generalComment: "",
      editing: { kind: "general", text: "use gpt-5-mini" },
      height: 40,
    },
    100,
  );
  const text = lines.join("\n");
  assert.match(text, /general comment/);
  assert.match(text, /use gpt-5-mini/);
  assert.match(text, /enter save · esc cancel/);
});
