import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadSessionMessages } from "../src/session-transcript.ts";

void test("load_session_messages_ignores_missing_and_malformed_jsonl", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-transcript-"));
  const sessionFile = path.join(project, "session.jsonl");
  await writeFile(
    sessionFile,
    [
      JSON.stringify({ message: { role: "user", content: "hello" } }),
      "{ malformed append",
      JSON.stringify({ event: "without-message" }),
      JSON.stringify({ message: { role: "assistant", content: "done" } }),
      "",
    ].join("\n"),
    "utf8",
  );

  assert.deepEqual(loadSessionMessages(path.join(project, "missing.jsonl")), []);
  assert.deepEqual(loadSessionMessages(sessionFile), [
    { role: "user", content: "hello" },
    { role: "assistant", content: "done" },
  ]);
});
