import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { createParentAgentCapabilityCatalogProvider, type AgentCapabilityCatalog } from "../src/pi-agent/capabilities/catalog.ts";
import { resolveAgentCapabilities } from "../src/pi-agent/capabilities/resolution.ts";

void test("extension tool selection infers its owner and exposes only the named tool", () => {
  assert.deepEqual(resolveAgentCapabilities({ extensions: [], tools: ["todo_write"], catalog: capabilityCatalog() }), {
    ok: true,
    extensionPaths: ["/project/.pi/extensions/todo.ts"],
    toolNames: ["todo_write"],
  });
});

void test("capability resolution returns typed unknown and ambiguous diagnostics", () => {
  const unknown = resolveAgentCapabilities({ extensions: ["missing"], tools: ["reed"], catalog: capabilityCatalog() });
  assert.equal(unknown.ok, false);
  assert.deepEqual(
    unknown.diagnostics.map(({ code, capability, index, value }) => ({ code, capability, index, value })),
    [
      { code: "unknown_extension", capability: "extensions", index: 0, value: "missing" },
      { code: "unknown_tool", capability: "tools", index: 0, value: "reed" },
    ],
  );

  const ambiguous = resolveAgentCapabilities({
    extensions: ["shared"],
    tools: "all",
    catalog: {
      ...capabilityCatalog(),
      availableExtensions: [
        { identifiers: ["shared"], path: "/extensions/alpha.ts", toolNames: [] },
        { identifiers: ["shared"], path: "/extensions/beta.ts", toolNames: [] },
      ],
    },
  });
  assert.equal(ambiguous.ok, false);
  assert.deepEqual(ambiguous.diagnostics[0], {
    code: "ambiguous_extension",
    capability: "extensions",
    index: 0,
    value: "shared",
    reason: "Ambiguous extension selector. Matches: shared, shared.",
  });
});

void test("capability resolution rejects malformed lists and tool owner collisions without throwing", () => {
  const malformed = resolveAgentCapabilities({ extensions: [""], tools: "all", catalog: capabilityCatalog() });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.diagnostics[0]?.code, "invalid_entry");

  const collision = resolveAgentCapabilities({
    extensions: [],
    tools: ["read"],
    catalog: { availableExtensions: [], baseToolNames: ["read"], customToolNames: ["read"], loadErrors: [] },
  });
  assert.equal(collision.ok, false);
  assert.equal(collision.diagnostics[0]?.code, "ambiguous_tool");
});

void test("explicit extension selection leaves normal tools unrestricted", () => {
  assert.deepEqual(resolveAgentCapabilities({ extensions: ["todo"], tools: "all", catalog: capabilityCatalog() }), {
    ok: true,
    extensionPaths: ["/project/.pi/extensions/todo.ts"],
  });
});

void test("parent capability catalog uses bound tool metadata without initializing ambient factories", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-parent-catalog-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-parent-agent-"));
  const countPath = path.join(project, "factory-count.txt");
  const extensionPath = path.join(project, ".pi", "extensions", "todo.js");
  await mkdir(path.dirname(extensionPath), { recursive: true });
  await writeFile(
    extensionPath,
    `import { appendFileSync } from "node:fs";
export default function todoExtension() { appendFileSync(${JSON.stringify(countPath)}, "loaded\\n"); }
`,
    "utf8",
  );
  const tools: ToolInfo[] = [
    toolInfo("read", "<builtin:read>", "builtin"),
    toolInfo("workflow_status", "<sdk:workflow_status>", "sdk"),
    toolInfo("todo_read", extensionPath, "auto"),
  ];
  const catalogProvider = createParentAgentCapabilityCatalogProvider({ cwd: project, agentDir, getTools: () => tools });

  const catalog = await catalogProvider({ extensionSelectors: [] });

  assert.deepEqual(catalog.baseToolNames, ["read"]);
  assert.deepEqual(catalog.customToolNames, ["workflow_status"]);
  assert.deepEqual(catalog.availableExtensions, [{ identifiers: [extensionPath], path: extensionPath, toolNames: ["todo_read"] }]);
  await assert.rejects(readFile(countPath, "utf8"), { code: "ENOENT" });
});

void test("parent capability catalog inspects only an explicit extension missing from bound metadata", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-parent-explicit-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-parent-agent-"));
  const countPath = path.join(project, "factory-count.txt");
  const extensionPath = path.join(project, "todo.js");
  await writeFile(
    extensionPath,
    `import { appendFileSync } from "node:fs";
export default function todoExtension(pi) {
  appendFileSync(${JSON.stringify(countPath)}, "loaded\\n");
  pi.registerTool({
    name: "todo_read",
    label: "todo_read",
    description: "todo_read",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
  });
}
`,
    "utf8",
  );
  const catalogProvider = createParentAgentCapabilityCatalogProvider({
    cwd: project,
    agentDir,
    getTools: () => [toolInfo("read", "<builtin:read>", "builtin")],
  });

  const catalog = await catalogProvider({ extensionSelectors: ["./todo.js"] });

  assert.ok(catalog.availableExtensions.some((extension) => extension.path === extensionPath && extension.toolNames.includes("todo_read")));
  assert.equal((await readFile(countPath, "utf8")).trim(), "loaded");
});

function toolInfo(name: string, sourcePath: string, source: string): ToolInfo {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    sourceInfo: { path: sourcePath, source, scope: "project", origin: "top-level" },
  };
}

function capabilityCatalog(): AgentCapabilityCatalog {
  return {
    availableExtensions: [
      {
        identifiers: ["todo", "./extensions/todo.ts"],
        path: "/project/.pi/extensions/todo.ts",
        toolNames: ["todo_read", "todo_write"],
      },
    ],
    baseToolNames: ["read", "bash"],
    loadErrors: [],
  };
}
