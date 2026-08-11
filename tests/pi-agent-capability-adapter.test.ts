import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createPiWorkflowAgent } from "../src/pi-agent/adapter.ts";
import { availableAgentExtensions } from "../src/pi-agent/capabilities/catalog.ts";
import { createCompletedSessionFactory, createRealToolProbeSessionFactory } from "./pi-agent-session-harness.ts";

void test("child agent extension catalog comes from loaded Pi factory metadata", () => {
  assert.deepEqual(
    availableAgentExtensions([
      {
        path: "/project/.pi/extensions/todo.ts",
        resolvedPath: "/project/.pi/extensions/todo.ts",
        sourceInfo: {
          path: "/project/.pi/extensions/todo.ts",
          source: "auto",
        },
        tools: new Map([
          ["todo_read", {}],
          ["todo_write", {}],
        ]),
      },
    ]),
    [
      {
        identifiers: ["/project/.pi/extensions/todo.ts"],
        path: "/project/.pi/extensions/todo.ts",
        toolNames: ["todo_read", "todo_write"],
      },
    ],
  );
});

void test("Pi child agent rejects a dynamic unknown tool before session creation", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-capabilities-"));
  const agent = createPiWorkflowAgent({
    cwd: project,
    agentCapabilityCatalog: () => Promise.resolve({ availableExtensions: [], baseToolNames: ["read"], loadErrors: [] }),
  });

  await assert.rejects(
    agent(
      "work",
      { extensions: [], tools: ["reed"] },
      {
        launched(): void {
          return undefined;
        },
        progress(): void {
          return undefined;
        },
      },
    ),
    /tools\[0\] "reed": Unknown tool/,
  );
});

void test("Pi child agent rejects ambiguous tool ownership before session creation", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-capabilities-"));
  let launched = false;
  const agent = createPiWorkflowAgent({
    cwd: project,
    agentCapabilityCatalog: () =>
      Promise.resolve({
        availableExtensions: [{ identifiers: ["shadow-read"], path: "/extensions/shadow-read.ts", toolNames: ["read"] }],
        baseToolNames: ["read"],
        loadErrors: [],
      }),
  });

  await assert.rejects(
    agent(
      "work",
      { extensions: [], tools: ["read"] },
      {
        launched(): void {
          launched = true;
        },
        progress(): void {
          return undefined;
        },
      },
    ),
    /tools\[0\] "read": Ambiguous tool owner\. Registered by: Pi base tools, shadow-read/,
  );
  assert.equal(launched, false);
});

void test("Pi child agent rejects malformed dynamic capability values before loading resources", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-capabilities-"));
  const agent = createPiWorkflowAgent({ cwd: project });

  await assert.rejects(
    agent(
      "work",
      { extensions: "todo" as never, tools: [] },
      {
        launched(): void {
          return undefined;
        },
        progress(): void {
          return undefined;
        },
      },
    ),
    /extensions "todo": Capability selection must be "all" or an array of unique, non-empty strings/,
  );
});

void test("Pi child agent with empty capabilities does not initialize ambient extensions", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-capabilities-"));
  const countPath = path.join(project, "factory-count.txt");
  await mkdir(path.join(project, ".pi", "extensions"), { recursive: true });
  await writeFile(
    path.join(project, ".pi", "extensions", "ambient.js"),
    `import { appendFileSync } from "node:fs";
export default function ambientExtension() { appendFileSync(${JSON.stringify(countPath)}, "loaded\\n"); }
`,
    "utf8",
  );
  let sessionExtensionCount = -1;
  let sessionTools: string[] | undefined;
  const agent = createPiWorkflowAgent({
    cwd: project,
    createSession: createCompletedSessionFactory((sessionOptions) => {
      sessionExtensionCount = sessionOptions.resourceLoader?.getExtensions().extensions.length ?? -1;
      sessionTools = sessionOptions.tools;
    }),
  });

  await agent(
    "work",
    { extensions: [], tools: [] },
    {
      launched(): void {
        return undefined;
      },
      progress(): void {
        return undefined;
      },
    },
  );

  assert.equal(sessionExtensionCount, 0);
  assert.deepEqual(sessionTools, []);
  await assert.rejects(readFile(countPath, "utf8"), { code: "ENOENT" });
});

void test("Pi child agent with a base-only tool does not initialize ambient extensions", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-capabilities-"));
  const countPath = path.join(project, "factory-count.txt");
  await mkdir(path.join(project, ".pi", "extensions"), { recursive: true });
  await writeFile(
    path.join(project, ".pi", "extensions", "ambient.js"),
    `import { appendFileSync } from "node:fs";
export default function ambientExtension() { appendFileSync(${JSON.stringify(countPath)}, "loaded\\n"); }
`,
    "utf8",
  );
  let sessionTools: string[] | undefined;
  const agent = createPiWorkflowAgent({
    cwd: project,
    createSession: createCompletedSessionFactory((sessionOptions) => {
      sessionTools = sessionOptions.tools;
    }),
  });

  await agent(
    "work",
    { extensions: [], tools: ["read"] },
    {
      launched(): void {
        return undefined;
      },
      progress(): void {
        return undefined;
      },
    },
  );

  assert.deepEqual(sessionTools, ["read"]);
  await assert.rejects(readFile(countPath, "utf8"), { code: "ENOENT" });
});

void test("Pi child agent binds an inferred extension tool with its provider and exact allowlist", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-capabilities-"));
  const countPath = path.join(project, "factory-count.txt");
  const todoPath = path.join(project, ".pi", "extensions", "todo.js");
  await mkdir(path.join(project, ".pi", "extensions"), { recursive: true });
  await writeFile(
    todoPath,
    `import { appendFileSync } from "node:fs";
export default function todoExtension(pi) {
  appendFileSync(${JSON.stringify(countPath)}, "loaded\\n");
  for (const name of ["todo_read", "todo_write"]) {
    pi.registerTool({
      name,
      label: name,
      description: name,
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: pi.getActiveTools().join(",") }], details: {} }),
    });
  }
  pi.registerProvider("todo_provider", {
    baseUrl: "https://example.com",
    apiKey: "test",
    api: "openai-completions",
    models: [],
  });
}
`,
    "utf8",
  );
  let sessionExtensionTools: string[] = [];
  let providerPaths: string[] = [];
  let sessionTools: string[] | undefined;
  let toolOutput = "";
  const agent = createPiWorkflowAgent({
    cwd: project,
    agentCapabilityCatalog: () =>
      Promise.resolve({
        availableExtensions: [{ identifiers: [todoPath], path: todoPath, toolNames: ["todo_read", "todo_write"] }],
        baseToolNames: ["read", "bash"],
        loadErrors: [],
      }),
    createSession: createRealToolProbeSessionFactory(
      "todo_write",
      (sessionOptions) => {
        const extensions = sessionOptions.resourceLoader?.getExtensions();
        sessionExtensionTools = extensions?.extensions.flatMap((extension) => [...extension.tools.keys()]) ?? [];
        providerPaths = extensions?.runtime.pendingProviderRegistrations.map((registration) => registration.extensionPath) ?? [];
        sessionTools = sessionOptions.tools;
      },
      (text) => {
        toolOutput = text;
      },
    ),
  });

  await agent(
    "work",
    { extensions: [], tools: ["todo_write"] },
    {
      launched(): void {
        return undefined;
      },
      progress(): void {
        return undefined;
      },
    },
  );

  assert.deepEqual(sessionExtensionTools, ["todo_read", "todo_write"]);
  assert.deepEqual(providerPaths, [todoPath]);
  assert.deepEqual(sessionTools, ["todo_write"]);
  assert.equal(toolOutput, "todo_write");
  assert.equal((await readFile(countPath, "utf8")).trim().split("\n").length, 1);
});

void test("Pi child agent discovers project extensions when its session cwd is elsewhere", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-project-"));
  const childCwd = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-child-"));
  await mkdir(path.join(project, ".pi", "extensions"), { recursive: true });
  await writeFile(
    path.join(project, ".pi", "extensions", "project.js"),
    `export default function projectExtension(pi) {
  pi.registerTool({
    name: "project_tool",
    label: "project_tool",
    description: "project_tool",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
  });
}
`,
    "utf8",
  );
  let sessionCwd = "";
  let extensionTools: string[] = [];
  const agent = createPiWorkflowAgent({
    cwd: project,
    createSession: createCompletedSessionFactory((sessionOptions) => {
      sessionCwd = sessionOptions.cwd ?? "";
      extensionTools = sessionOptions.resourceLoader?.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]) ?? [];
    }),
  });

  await agent(
    "work",
    { cwd: childCwd, extensions: ["./.pi/extensions/project.js"], tools: [] },
    {
      launched(): void {
        return undefined;
      },
      progress(): void {
        return undefined;
      },
    },
  );

  assert.equal(sessionCwd, childCwd);
  assert.deepEqual(extensionTools, ["project_tool"]);
});
