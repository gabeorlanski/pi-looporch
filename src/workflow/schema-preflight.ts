/** Provides schema preflight behavior. */
import * as ts from "typescript";
import { preflightJsonSchema } from "../runtime/schema.ts";
import { analyzeWorkflowPrimitiveCalls } from "./primitive-calls.ts";
import { isStaticJsonLiteral, readStaticJsonLiteral } from "./static-literal.ts";

/** Validates direct literal schemas only when the corresponding workflow primitive is never rebound. */
export function preflightStaticWorkflowSchemas(sourceFile: ts.SourceFile): void {
  for (const { call, primitive } of analyzeWorkflowPrimitiveCalls(sourceFile, ["agent", "coerce"] as const).calls) {
    const schema = staticSchemaArgument(call, primitive, sourceFile);
    if (schema !== undefined) preflightSchema(sourceFile, primitive, schema);
  }
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
