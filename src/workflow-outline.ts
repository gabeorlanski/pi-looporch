import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

export type OutlinePromptSource = "literal" | "template-literal" | "renderPrompt" | "expression";

export interface OutlinePrompt {
  id: string;
  role: string;
  text: string;
  source: OutlinePromptSource;
  editable: boolean;
  loc?: { start: number; end: number };
  templatePath?: string;
}

export type OutlineStageKind = "agent" | "parallel" | "pipeline" | "coerce" | "mapreduce" | "verifier" | "log" | "trace";

export interface OutlineStage {
  id: string;
  kind: OutlineStageKind;
  label?: string;
  model?: string;
  reasoning?: string;
  prompts: OutlinePrompt[];
  children: OutlineStage[];
  loc: { start: number; end: number };
}

export interface OutlineSection {
  id: string;
  phase?: string;
  stages: OutlineStage[];
}

export interface WorkflowOutline {
  metadata: { name: string; description: string; phases: { title: string; detail?: string }[] };
  jsdoc?: string;
  sections: OutlineSection[];
  warnings: string[];
}

export interface ParseWorkflowOutlineOptions {
  workflowDir?: string;
}

export interface PromptEdit {
  promptId: string;
  text: string;
}

export interface OutlineStageContext {
  stage: OutlineStage;
  phase?: string;
}

const STAGE_KINDS = new Set<OutlineStageKind>(["agent", "parallel", "pipeline", "coerce", "mapreduce", "verifier", "log", "trace"]);

export function indexOutlinePrompts(outline: WorkflowOutline): Map<string, OutlinePrompt> {
  const prompts = new Map<string, OutlinePrompt>();
  const walk = (stage: OutlineStage): void => {
    for (const prompt of stage.prompts) prompts.set(prompt.id, prompt);
    stage.children.forEach(walk);
  };
  for (const section of outline.sections) section.stages.forEach(walk);
  return prompts;
}

export function indexOutlineStages(outline: WorkflowOutline): Map<string, OutlineStageContext> {
  const stages = new Map<string, OutlineStageContext>();
  for (const section of outline.sections) {
    const walk = (stage: OutlineStage): void => {
      stages.set(stage.id, { stage, ...(section.phase ? { phase: section.phase } : {}) });
      stage.children.forEach(walk);
    };
    section.stages.forEach(walk);
  }
  return stages;
}

export function applyPromptEdits(source: string, outline: WorkflowOutline, edits: PromptEdit[]): string {
  if (edits.length === 0) return source;
  const prompts = indexOutlinePrompts(outline);
  const replacements = edits.map((edit) => {
    const prompt = prompts.get(edit.promptId);
    if (!prompt) throw new Error(`Cannot apply edit: unknown prompt id '${edit.promptId}'`);
    if (!prompt.editable || !prompt.loc) throw new Error(`Cannot apply edit: prompt '${edit.promptId}' is not editable`);
    return { loc: prompt.loc, replacement: JSON.stringify(edit.text) };
  });
  return replacements
    .sort((left, right) => right.loc.start - left.loc.start)
    .reduce((updated, edit) => `${updated.slice(0, edit.loc.start)}${edit.replacement}${updated.slice(edit.loc.end)}`, source);
}

interface OutlineContext {
  sourceFile: ts.SourceFile;
  source: string;
  workflowDir?: string;
  warnings: Set<string>;
  counter: { value: number };
}

type StageEmit = { kind: "phase"; title: string } | { kind: "stage"; stage: OutlineStage };

export function parseWorkflowOutline(source: string, options: ParseWorkflowOutlineOptions = {}): WorkflowOutline {
  const sourceFile = ts.createSourceFile("workflow.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const ctx: OutlineContext = {
    sourceFile,
    source,
    workflowDir: options.workflowDir,
    warnings: new Set<string>(),
    counter: { value: 0 },
  };
  const metadata = extractOutlineMetadata(sourceFile);
  const jsdoc = extractLeadingJsDoc(source);
  const body = findWorkflowBody(sourceFile);
  const sections = body ? buildSections(body, ctx) : [];
  if (!body) ctx.warnings.add("Could not locate the workflow function body; showing metadata and raw source only.");
  return { metadata, ...(jsdoc ? { jsdoc } : {}), sections, warnings: [...ctx.warnings] };
}

function buildSections(body: ts.Node, ctx: OutlineContext): OutlineSection[] {
  const sections: OutlineSection[] = [{ id: nextId(ctx, "section"), stages: [] }];
  visitStages(body, ctx, (event) => {
    if (event.kind === "phase") {
      sections.push({ id: nextId(ctx, "section"), phase: event.title, stages: [] });
      return;
    }
    sections[sections.length - 1].stages.push(event.stage);
  });
  return sections.filter((section) => section.stages.length > 0 || section.phase !== undefined);
}

function visitStages(root: ts.Node, ctx: OutlineContext, emit: (event: StageEmit) => void): void {
  const recurse = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (name === "phase") {
        emit({ kind: "phase", title: phaseTitle(node, ctx) });
        return;
      }
      if (isStageKind(name)) {
        emit({ kind: "stage", stage: buildStage(node, name, ctx) });
        return;
      }
    }
    ts.forEachChild(node, recurse);
  };
  recurse(root);
}

function buildStage(call: ts.CallExpression, kind: OutlineStageKind, ctx: OutlineContext): OutlineStage {
  const stage: OutlineStage = {
    id: nextId(ctx, "stage"),
    kind,
    prompts: [],
    children: [],
    loc: span(call, ctx),
  };
  if (isInsideDynamicControlFlow(call)) {
    ctx.warnings.add("Workflow contains loops or conditionals; each call is shown once but may run a dynamic number of times.");
  }
  const args = call.arguments;
  if (kind === "agent") {
    const promptArg = args.at(0);
    if (promptArg) stage.prompts.push(extractPrompt(promptArg, "prompt", ctx));
    applyOptions(stage, objectLiteral(args.at(1)));
  } else if (kind === "log" || kind === "trace") {
    const messageArg = args.at(0);
    if (messageArg) stage.prompts.push(extractPrompt(messageArg, kind === "log" ? "message" : "label", ctx));
  } else if (kind === "coerce") {
    const optionsArg = objectLiteral(args.at(0));
    pushPromptFromProperty(stage, optionsArg, "prompt", ctx);
    applyOptions(stage, optionsArg);
  } else if (kind === "mapreduce") {
    const optionsArg = objectLiteral(args.at(0));
    for (const role of ["inputPrompt", "mapPrompt", "reducePrompt"]) pushPromptFromProperty(stage, optionsArg, role, ctx);
    applyOptions(stage, optionsArg);
  } else if (kind === "verifier") {
    const optionsArg = objectLiteral(args.at(0));
    for (const role of ["criteriaPrompt", "reducePrompt"]) pushPromptFromProperty(stage, optionsArg, role, ctx);
    applyOptions(stage, optionsArg);
  } else if (kind === "parallel") {
    stage.children = collectChildStages(args.at(1), ctx);
    applyOptions(stage, objectLiteral(args.at(2)));
  } else {
    stage.children = args.slice(1).flatMap((arg) => collectChildStages(arg, ctx));
  }
  return stage;
}

function collectChildStages(node: ts.Node | undefined, ctx: OutlineContext): OutlineStage[] {
  if (!node) return [];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((element) => collectChildStages(element, ctx));
  const body = functionBody(node);
  if (!body) return [];
  const children: OutlineStage[] = [];
  visitStages(body, ctx, (event) => {
    if (event.kind === "stage") children.push(event.stage);
  });
  return children;
}

function extractPrompt(arg: ts.Expression, role: string, ctx: OutlineContext): OutlinePrompt {
  const id = nextId(ctx, "prompt");
  if (ts.isStringLiteral(arg)) return { id, role, text: arg.text, source: "literal", editable: true, loc: span(arg, ctx) };
  if (ts.isNoSubstitutionTemplateLiteral(arg))
    return { id, role, text: arg.text, source: "template-literal", editable: true, loc: span(arg, ctx) };
  if (ts.isTemplateExpression(arg))
    return { id, role, text: reconstructTemplate(arg, ctx), source: "template-literal", editable: false, loc: span(arg, ctx) };
  if (isRenderPromptCall(arg)) return renderPromptPrompt(arg, id, role, ctx);
  return { id, role, text: nodeText(arg, ctx), source: "expression", editable: false, loc: span(arg, ctx) };
}

function renderPromptPrompt(call: ts.CallExpression, id: string, role: string, ctx: OutlineContext): OutlinePrompt {
  const templateArg = call.arguments.at(0);
  const templatePath = templateArg && ts.isStringLiteral(templateArg) ? templateArg.text : undefined;
  const template = templatePath ? readPromptTemplate(ctx, templatePath) : undefined;
  const text = template ?? nodeText(call, ctx);
  return { id, role, text, source: "renderPrompt", editable: false, ...(templatePath ? { templatePath } : {}) };
}

function readPromptTemplate(ctx: OutlineContext, templatePath: string): string | undefined {
  if (!ctx.workflowDir) return undefined;
  const promptDir = path.join(ctx.workflowDir, "prompts");
  const resolved = path.resolve(promptDir, templatePath.replace(/^@/, ""));
  const relative = path.relative(promptDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(resolved)) return undefined;
  return readFileSync(resolved, "utf8");
}

function pushPromptFromProperty(
  stage: OutlineStage,
  object: ts.ObjectLiteralExpression | undefined,
  role: string,
  ctx: OutlineContext,
): void {
  const initializer = object ? propertyInitializer(object, role) : undefined;
  if (initializer) stage.prompts.push(extractPrompt(initializer, role, ctx));
}

function applyOptions(stage: OutlineStage, object: ts.ObjectLiteralExpression | undefined): void {
  if (!object) return;
  const label = stringProperty(object, "label");
  const model = stringProperty(object, "model");
  const reasoning = stringProperty(object, "reasoning");
  if (label !== undefined) stage.label = label;
  if (model !== undefined) stage.model = model;
  if (reasoning !== undefined) stage.reasoning = reasoning;
}

function objectLiteral(arg: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  return arg && ts.isObjectLiteralExpression(arg) ? arg : undefined;
}

function propertyInitializer(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === name) return property.initializer;
  }
  return undefined;
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const initializer = propertyInitializer(object, name);
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) return initializer.text;
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function phaseTitle(call: ts.CallExpression, ctx: OutlineContext): string {
  const arg = call.arguments.at(0);
  if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) return arg.text;
  return arg ? nodeText(arg, ctx) : "phase";
}

function reconstructTemplate(template: ts.TemplateExpression, ctx: OutlineContext): string {
  let text = template.head.text;
  for (const templateSpan of template.templateSpans) {
    text += `\${${nodeText(templateSpan.expression, ctx)}}${templateSpan.literal.text}`;
  }
  return text;
}

function isRenderPromptCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "renderPrompt";
}

function isStageKind(name: string): name is OutlineStageKind {
  return STAGE_KINDS.has(name as OutlineStageKind);
}

function isInsideDynamicControlFlow(node: ts.Node): boolean {
  return ts.findAncestor(node.parent, isDynamicControlFlowNode) !== undefined;
}

function isDynamicControlFlowNode(node: ts.Node): boolean {
  return (
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isIfStatement(node) ||
    ts.isConditionalExpression(node) ||
    isArrayIteratorCall(node)
  );
}

function isArrayIteratorCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  return ["map", "forEach", "filter", "flatMap", "reduce"].includes(node.expression.name.text);
}

function functionBody(node: ts.Node): ts.Node | undefined {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) return node.body;
  return undefined;
}

function findWorkflowBody(sourceFile: ts.SourceFile): ts.Node | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const body = resolveExpressionBody(statement.expression, sourceFile);
      if (body) return body;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const hasDefault = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    if (hasDefault && ts.isFunctionDeclaration(statement) && statement.body) return statement.body;
  }
  return undefined;
}

function resolveExpressionBody(expression: ts.Expression, sourceFile: ts.SourceFile): ts.Node | undefined {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression.body;
  if (ts.isIdentifier(expression)) return findNamedFunctionBody(sourceFile, expression.text);
  return undefined;
}

function findNamedFunctionBody(sourceFile: ts.SourceFile, name: string): ts.Node | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body) return statement.body;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
          const body = functionBody(declaration.initializer);
          if (body) return body;
        }
      }
    }
  }
  return undefined;
}

function extractOutlineMetadata(sourceFile: ts.SourceFile): {
  name: string;
  description: string;
  phases: { title: string; detail?: string }[];
} {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "metadata") continue;
      if (declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
        return {
          name: stringProperty(declaration.initializer, "name") ?? "",
          description: stringProperty(declaration.initializer, "description") ?? "",
          phases: phaseMetadataProperty(declaration.initializer),
        };
      }
    }
  }
  return { name: "", description: "", phases: [] };
}

function phaseMetadataProperty(object: ts.ObjectLiteralExpression): { title: string; detail?: string }[] {
  const initializer = propertyInitializer(object, "phases");
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) return [];
  const phases: { title: string; detail?: string }[] = [];
  for (const element of initializer.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    const title = stringProperty(element, "title");
    if (title === undefined) continue;
    const detail = stringProperty(element, "detail");
    phases.push({ title, ...(detail !== undefined ? { detail } : {}) });
  }
  return phases;
}

function extractLeadingJsDoc(source: string): string | undefined {
  const match = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source);
  if (!match) return undefined;
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\*?/, "").trim())
    .filter((line, index, lines) => line !== "" || (index > 0 && index < lines.length - 1))
    .join("\n")
    .trim();
}

function nodeText(node: ts.Node, ctx: OutlineContext): string {
  return ctx.source.slice(node.getStart(ctx.sourceFile), node.getEnd());
}

function span(node: ts.Node, ctx: OutlineContext): { start: number; end: number } {
  return { start: node.getStart(ctx.sourceFile), end: node.getEnd() };
}

function nextId(ctx: OutlineContext, prefix: string): string {
  ctx.counter.value += 1;
  return `${prefix}-${String(ctx.counter.value)}`;
}
