import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedJson } from "../src/runtime/json-response.ts";
import { jsonRepairPrompt, parseAndValidateJsonResponse, preflightJsonSchema } from "../src/runtime/schema.ts";

const schema = {
  type: "object",
  properties: { status: { type: "string", enum: ["pass", "fail"] } },
  required: ["status"],
  additionalProperties: false,
};

void test("structured response accepts exact JSON values and a single exact markdown fence", () => {
  assert.deepEqual(parseAndValidateJsonResponse('"pass"', { enum: ["pass", "fail"] }), { ok: true, value: "pass" });
  assert.deepEqual(parseAndValidateJsonResponse("42", { type: "number" }), { ok: true, value: 42 });
  assert.deepEqual(parseAndValidateJsonResponse("null", { type: "null" }), { ok: true, value: null });
  assert.deepEqual(parseAndValidateJsonResponse('```json\n"pass"\n```', { type: "string" }), { ok: true, value: "pass" });
  assert.deepEqual(parseAndValidateJsonResponse("```\n42\n```", { type: "number" }), { ok: true, value: 42 });
});

void test("structured response recovers one object or array from prose but not scalar-looking prose", () => {
  assert.deepEqual(parseAndValidateJsonResponse('Result: {"status":"pass"}.', schema), { ok: true, value: { status: "pass" } });
  assert.deepEqual(parseAndValidateJsonResponse('Result: ["pass"].', { type: "array", items: { type: "string" } }), {
    ok: true,
    value: ["pass"],
  });
  const count = parseAndValidateJsonResponse("There are 42 results; true.", { type: "number" });
  assert.equal(count.ok, false);
  assert.match(count.error, /no complete JSON object or array/);
});

void test("structured response rejects ambiguous and malformed enclosing containers", () => {
  const ambiguous = parseAndValidateJsonResponse('First {"status":"pass"}; second {"status":"fail"}', schema);
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error, /multiple JSON object or array/);
  const truncated = parseAndValidateJsonResponse('Result: {"status":"pass"', schema);
  assert.equal(truncated.ok, false);
  assert.match(truncated.error, /incomplete JSON object or array/);
  const nested = parseAndValidateJsonResponse('Result: { broken: {"status":"pass"}', schema);
  assert.equal(nested.ok, false);
  assert.match(nested.error, /incomplete JSON object or array/);
});

void test("bounded JSON formatting is total and powers repair prompts", () => {
  assert.equal(boundedJson(undefined, 100), "undefined");
  assert.equal(boundedJson("result", 100), '"result"');
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.match(boundedJson(circular, 100), /\[object Object\]/);
  const hostile = {
    toJSON(): never {
      throw new Error("no JSON");
    },
    toString(): never {
      throw new Error("no string");
    },
  };
  assert.equal(boundedJson(hostile, 100), "[unprintable value]");
  assert.match(jsonRepairPrompt(schema, undefined, "invalid", undefined), /Rejected response .*\nundefined/);
});

void test("schema diagnostics identify paths, expectations, and received values", () => {
  const result = parseAndValidateJsonResponse('{"status":"unknown","extra":true}', schema);
  assert.equal(result.ok, false);
  assert.match(result.error, /disallowed properties/);
  assert.match(result.error, /\/status must be one of/);
  assert.match(result.error, /received "unknown"/);
});

void test("schema preflight accepts only object or boolean schemas and validates local references", () => {
  preflightJsonSchema(true);
  preflightJsonSchema(false);
  preflightJsonSchema({ type: ["string", "null"], unevaluatedProperties: false, vendorExtension: true });
  assert.throws(() => {
    preflightJsonSchema([]);
  }, /object or boolean/);
  assert.throws(() => {
    preflightJsonSchema("not-a-schema");
  }, /object or boolean/);
  assert.throws(() => {
    preflightJsonSchema({ type: "not-a-type" });
  }, /schema.type must name/);
  assert.throws(() => {
    preflightJsonSchema({ $ref: "#/$defs/missing", $defs: {} });
  }, /unresolved local \$ref/);
  assert.throws(() => {
    preflightJsonSchema({ $ref: "https://example.test/schema" });
  }, /unsupported external \$ref/);
  preflightJsonSchema({ $ref: "#/$defs/value", $defs: { value: { type: "string" } } });
  assert.throws(() => {
    preflightJsonSchema({ type: "string", pattern: "[" });
  }, /schema is invalid/);
});
