import { IsSchema, type TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import { boundedJson } from "./json-response.ts";

const jsonSchemaTypes = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);
const schemaMapKeywords = ["$defs", "definitions", "dependentSchemas", "patternProperties", "properties"];
const schemaKeywords = [
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedProperties",
];
const schemaArrayKeywords = ["allOf", "anyOf", "oneOf", "prefixItems"];

/** Rejects values that TypeBox cannot use as object or boolean schemas before agent work begins. */
export function preflightJsonSchema(schema: unknown): asserts schema is TSchema | boolean {
  if (schema === true || schema === false) return;
  if (!isRecord(schema) || !IsSchema(schema)) throw new Error("schema must be a JSON Schema object or boolean");
  try {
    Compile(schema);
    preflightSchemaSemantics(schema);
  } catch (error) {
    throw new Error(`schema is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function schemaValidationFailure(schema: TSchema | boolean, value: unknown): string {
  const errors = [...Value.Errors(schema as TSchema, value)].slice(0, 5).map((error) => {
    const params = error.params as Record<string, unknown>;
    return `${error.instancePath || "/"} ${validationExpectation(error.keyword, params)}; received ${boundedJson(
      valueAtJsonPointer(value, error.instancePath),
      240,
    )}`;
  });
  return errors.length ? `schema validation failed: ${errors.join("; ")}` : "schema validation failed: response did not match schema";
}

function preflightSchemaSemantics(schema: TSchema): void {
  const seen = new Set<object>();
  const walkSchema = (candidate: unknown, path: string): void => {
    if (candidate === true || candidate === false || !isRecord(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    validateSchemaType(candidate.type, `${path}.type`);
    if (typeof candidate.$ref === "string") walkSchema(resolveLocalReference(schema, candidate.$ref, path), candidate.$ref);
    for (const keyword of schemaMapKeywords) {
      const map = candidate[keyword];
      if (!isRecord(map)) continue;
      for (const [name, child] of Object.entries(map)) walkSchema(child, `${path}.${keyword}.${name}`);
    }
    for (const keyword of schemaKeywords) {
      const child = candidate[keyword];
      if (Array.isArray(child) && keyword === "items") child.forEach((item, index) => walkSchema(item, `${path}.items[${String(index)}]`));
      else walkSchema(child, `${path}.${keyword}`);
    }
    for (const keyword of schemaArrayKeywords) {
      const children = candidate[keyword];
      if (Array.isArray(children)) children.forEach((child, index) => walkSchema(child, `${path}.${keyword}[${String(index)}]`));
    }
  };
  walkSchema(schema, "schema");
}

function validateSchemaType(value: unknown, path: string): void {
  if (value === undefined) return;
  const types = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined;
  if (!types?.length || types.some((type) => typeof type !== "string" || !jsonSchemaTypes.has(type)))
    throw new Error(`${path} must name one or more JSON Schema primitive types`);
}

function resolveLocalReference(root: unknown, reference: string, path: string): unknown {
  if (!reference.startsWith("#")) throw new Error(`${path} uses unsupported external $ref '${reference}'`);
  if (reference === "#") return root;
  if (!reference.startsWith("#/")) throw new Error(`${path} has invalid local $ref '${reference}'`);
  let current = root;
  for (const encodedSegment of reference.slice(2).split("/")) {
    const segment = decodeJsonPointerSegment(encodedSegment, reference, path);
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment) || Number(segment) >= current.length)
        throw new Error(`${path} has unresolved local $ref '${reference}'`);
      current = current[Number(segment)];
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      throw new Error(`${path} has unresolved local $ref '${reference}'`);
    }
  }
  return current;
}

function decodeJsonPointerSegment(segment: string, reference: string, path: string): string {
  if (/(?:~[^01]|~$)/.test(segment)) throw new Error(`${path} has invalid local $ref '${reference}'`);
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function validationExpectation(keyword: string, params: Record<string, unknown>): string {
  if (keyword === "type") return `must be ${String(params.type)}`;
  if (keyword === "enum") return `must be one of ${boundedJson(params.allowedValues, 160)}`;
  if (keyword === "required") return `is missing required properties ${boundedJson(params.requiredProperties, 160)}`;
  if (keyword === "additionalProperties") return `has disallowed properties ${boundedJson(params.additionalProperties, 160)}`;
  if (keyword === "maxLength") return `must be at most ${String(params.limit)} characters`;
  if (keyword === "maxItems") return `must contain at most ${String(params.limit)} items`;
  return `violates ${keyword}`;
}

function valueAtJsonPointer(value: unknown, pointer: string): unknown {
  if (!pointer) return value;
  let current = value;
  for (const segment of pointer.slice(1).split("/")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
