import * as ts from "typescript";

export interface SourceEdit {
  start: number;
  end: number;
  replacement: string;
}

export interface WorkflowSourceAnalysis {
  sourceFile: ts.SourceFile;
  metadataExpression?: ts.Expression;
  moduleEdits: SourceEdit[];
}

export function analyzeWorkflowSource(source: string, filePath = "workflow.js"): WorkflowSourceAnalysis {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return {
    sourceFile,
    metadataExpression: findExportedMetadataExpression(sourceFile),
    moduleEdits: workflowModuleEdits(sourceFile),
  };
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

function findExportedMetadataExpression(sourceFile: ts.SourceFile): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    if (statement.declarationList.declarations.length !== 1) continue;
    const declaration = statement.declarationList.declarations[0];
    if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "metadata") continue;
    return declaration.initializer;
  }
  return undefined;
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

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
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
