import * as ts from "typescript";
import { preflightJsonSchema } from "../runtime/schema.ts";
import { isStaticJsonLiteral, readStaticJsonLiteral } from "./static-literal.ts";

/** Validates direct literal schemas only when the corresponding workflow primitive is never rebound. */
export function preflightStaticWorkflowSchemas(sourceFile: ts.SourceFile): void {
  for (const primitive of ["agent", "coerce"] as const) {
    if (sourceBindsName(sourceFile, primitive)) continue;
    preflightPrimitiveSchemas(sourceFile, primitive);
  }
}

function preflightPrimitiveSchemas(sourceFile: ts.SourceFile, primitive: "agent" | "coerce"): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === primitive) {
      const schema = staticSchemaArgument(node, primitive, sourceFile);
      if (schema !== undefined) preflightSchema(sourceFile, primitive, schema);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function staticSchemaArgument(
  call: ts.CallExpression,
  primitive: "agent" | "coerce",
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  const options = call.arguments.at(primitive === "agent" ? 1 : 0);
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return undefined;
  const schema = options.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)) &&
      property.name.text === "schema",
  );
  return schema && isStaticJsonLiteral(schema.initializer, sourceFile) ? schema.initializer : undefined;
}

function preflightSchema(sourceFile: ts.SourceFile, primitive: string, schema: ts.Expression): void {
  try {
    preflightJsonSchema(readStaticJsonLiteral(schema, sourceFile, "schema"));
  } catch (error) {
    const location = sourceFile.getLineAndCharacterOfPosition(schema.getStart(sourceFile));
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${primitive} schema at ${sourceFile.fileName}:${String(location.line + 1)}:${String(location.character + 1)} is invalid: ${message}`,
    );
  }
}

function sourceBindsName(sourceFile: ts.SourceFile, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && bindingDeclares(node.name, name)) found = true;
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) &&
      node.name?.text === name
    )
      found = true;
    if (ts.isParameter(node) && bindingDeclares(node.name, name)) found = true;
    if (ts.isCatchClause(node) && node.variableDeclaration && bindingDeclares(node.variableDeclaration.name, name)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function bindingDeclares(binding: ts.BindingName, name: string): boolean {
  return ts.isIdentifier(binding)
    ? binding.text === name
    : binding.elements.some((element) => !ts.isOmittedExpression(element) && bindingDeclares(element.name, name));
}
