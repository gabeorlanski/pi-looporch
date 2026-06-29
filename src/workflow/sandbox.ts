import vm from "node:vm";
import * as ts from "typescript";

export type WorkflowFunction = (input: unknown) => unknown;

export function compileWorkflow(
  source: string,
  filePath: string,
  globals: Record<string, unknown>,
): { metadata: unknown; workflow: WorkflowFunction } {
  const context = vm.createContext({ ...globals });
  const script = new vm.Script(
    `${transformWorkflowModule(source)}\n;({ metadata: typeof metadata === "undefined" ? undefined : metadata, workflow: typeof workflow === "undefined" ? undefined : workflow });`,
    { filename: filePath },
  );
  const exports = script.runInContext(context, { timeout: 1000 }) as { metadata?: unknown; workflow?: unknown };
  if (typeof exports.workflow !== "function") throw new Error("workflow.js must export a default function");
  return { metadata: exports.metadata, workflow: exports.workflow as WorkflowFunction };
}

function transformWorkflowModule(source: string): string {
  const sourceFile = ts.createSourceFile("workflow.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = workflowModuleEdits(sourceFile);
  return applySourceEdits(source, edits);
}

interface SourceEdit {
  start: number;
  end: number;
  replacement: string;
}

function workflowModuleEdits(sourceFile: ts.SourceFile): SourceEdit[] {
  const edits: SourceEdit[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) throw new Error("workflow.js cannot import modules");
    if (ts.isExportDeclaration(statement)) throw new Error("workflow.js may only export metadata and a default workflow function");
    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) throw new Error("workflow.js may only export metadata and a default workflow function");
      edits.push({
        start: statement.getStart(sourceFile),
        end: statement.expression.getStart(sourceFile),
        replacement: "const workflow = ",
      });
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exportModifier = modifiers?.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportModifier) continue;
    const defaultModifier = modifiers?.find((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    if (defaultModifier) {
      edits.push({ start: exportModifier.getStart(sourceFile), end: defaultModifier.getEnd(), replacement: "const workflow =" });
      continue;
    }
    if (ts.isVariableStatement(statement) && exportsOnlyMetadata(statement)) {
      edits.push({ start: exportModifier.getStart(sourceFile), end: exportModifier.getEnd(), replacement: "" });
      continue;
    }
    throw new Error("workflow.js may only export metadata and a default workflow function");
  }
  assertNoModuleLoadCalls(sourceFile);
  return edits;
}

function exportsOnlyMetadata(statement: ts.VariableStatement): boolean {
  const declarations = statement.declarationList.declarations;
  if (declarations.length !== 1) return false;
  const declaration = declarations[0];
  return (
    (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === "metadata"
  );
}

function assertNoModuleLoadCalls(sourceFile: ts.SourceFile): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) throw new Error("workflow.js cannot import modules");
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") throw new Error("workflow.js cannot use require()");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function applySourceEdits(source: string, edits: SourceEdit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((updated, edit) => `${updated.slice(0, edit.start)}${edit.replacement}${updated.slice(edit.end)}`, source);
}
