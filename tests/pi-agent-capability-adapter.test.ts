import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { createPiWorkflowAgent } from "../src/pi-agent/adapter.ts";
import { availableAgentExtensions } from "../src/pi-agent/capabilities/catalog.ts";
import {
  createCapabilityExtensionLoader,
  createCompletedSessionFactory,
  createRealToolProbeSessionFactory,
} from "./pi-agent-session-harness.ts";

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
    tools: [],
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
    tools: [],
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

void test("Pi child agent rejects the same ambiguous extension identifier as proposal validation", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-capabilities-"));
  const agent = createPiWorkflowAgent({
    cwd: project,
    agentCapabilityCatalog: () =>
      Promise.resolve({
        availableExtensions: [
          { identifiers: ["shared"], path: "/extensions/alpha.ts", toolNames: [] },
          { identifiers: ["shared"], path: "/extensions/beta.ts", toolNames: [] },
        ],
        baseToolNames: ["read"],
        loadErrors: [],
      }),
  });

  await assert.rejects(
    agent(
      "work",
      { extensions: ["shared"], tools: [] },
      {
        launched(): void {
          return undefined;
        },
        progress(): void {
          return undefined;
        },
      },
    ),
    /extensions\[0\] "shared": Ambiguous extension selector\. Matches: shared, shared\./,
  );
});

void test("Pi child agent resolves relative extension selectors from the project", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-extension-"));
  await writeFile(path.join(project, "todo-extension.js"), "export default function todoExtension() {}\n", "utf8");
  const agent = createPiWorkflowAgent({ cwd: project, tools: [] });

  await assert.rejects(
    agent(
      "work",
      { extensions: ["./todo-extension.js"], tools: ["reed"] },
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

void test("Pi child agent rejects malformed dynamic capability values before loading resources", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-capabilities-"));
  const agent = createPiWorkflowAgent({ cwd: project, tools: [] });

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
    tools: [],
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
    tools: [],
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

void test("Pi child agent filters an injected resource loader for empty capabilities", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-injected-"));
  const { loader } = await createCapabilityExtensionLoader(project);
  let extensionPaths: string[] = [];
  let providerPaths: string[] = [];
  let sessionTools: string[] | undefined;
  const agent = createPiWorkflowAgent({
    cwd: project,
    tools: [],
    session: { resourceLoader: loader },
    createSession: createCompletedSessionFactory((sessionOptions) => {
      const extensions = sessionOptions.resourceLoader?.getExtensions();
      if (!extensions) throw new Error("Expected session extensions");
      extensionPaths = extensions.extensions.map((extension) => extension.resolvedPath);
      providerPaths = extensions.runtime.pendingProviderRegistrations.map((registration) => registration.extensionPath);
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

  assert.deepEqual(extensionPaths, []);
  assert.deepEqual(providerPaths, []);
  assert.deepEqual(sessionTools, []);
});

void test("Pi child agent filters an injected resource loader to the selected extension and provider", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-injected-"));
  const { loader, alphaPath } = await createCapabilityExtensionLoader(project);
  let extensionPaths: string[] = [];
  let providerPaths: string[] = [];
  let sessionTools: string[] | undefined;
  const agent = createPiWorkflowAgent({
    cwd: project,
    tools: [],
    session: { resourceLoader: loader },
    createSession: createCompletedSessionFactory((sessionOptions) => {
      const extensions = sessionOptions.resourceLoader?.getExtensions();
      if (!extensions) throw new Error("Expected session extensions");
      extensionPaths = extensions.extensions.map((extension) => extension.resolvedPath);
      providerPaths = extensions.runtime.pendingProviderRegistrations.map((registration) => registration.extensionPath);
      sessionTools = sessionOptions.tools;
    }),
  });

  await agent(
    "work",
    { extensions: [alphaPath], tools: ["alpha_tool"] },
    {
      launched(): void {
        return undefined;
      },
      progress(): void {
        return undefined;
      },
    },
  );

  assert.deepEqual(extensionPaths, [alphaPath]);
  assert.deepEqual(providerPaths, [alphaPath]);
  assert.deepEqual(sessionTools, ["alpha_tool"]);
});

void test("Pi child agent binds selected extension actions to its session runtime", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-injected-"));
  const { loader, alphaPath } = await createCapabilityExtensionLoader(project);
  let activeTools = "";
  const agent = createPiWorkflowAgent({
    cwd: project,
    tools: [],
    session: { resourceLoader: loader },
    createSession: createRealToolProbeSessionFactory("alpha_tool", (text) => {
      activeTools = text;
    }),
  });

  await agent(
    "work",
    { extensions: [alphaPath], tools: ["alpha_tool"] },
    {
      launched(): void {
        return undefined;
      },
      progress(): void {
        return undefined;
      },
    },
  );

  assert.equal(activeTools, "alpha_tool");
});

void test("Pi child agent reuses an injected resource loader without consuming providers", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-injected-"));
  const { loader, alphaPath, betaPath } = await createCapabilityExtensionLoader(project);
  const sharedResult = loader.getExtensions();
  const sessions: { extensions: string[]; providers: string[]; tools: string[] | undefined }[] = [];
  const sessionResults: LoadExtensionsResult[] = [];
  const agent = createPiWorkflowAgent({
    cwd: project,
    tools: [],
    session: { resourceLoader: loader },
    createSession: createCompletedSessionFactory((sessionOptions) => {
      const extensions = sessionOptions.resourceLoader?.getExtensions();
      if (!extensions) throw new Error("Expected session extensions");
      sessionResults.push(extensions);
      sessions.push({
        extensions: extensions.extensions.map((extension) => extension.resolvedPath),
        providers: extensions.runtime.pendingProviderRegistrations.map((registration) => registration.extensionPath),
        tools: sessionOptions.tools,
      });
    }),
  });
  const reporter = {
    launched(): void {
      return undefined;
    },
    progress(): void {
      return undefined;
    },
  };

  await agent("empty", { extensions: [], tools: [] }, reporter);
  await agent("alpha", { extensions: [alphaPath], tools: ["alpha_tool"] }, reporter);

  assert.deepEqual(sessions, [
    { extensions: [], providers: [], tools: [] },
    { extensions: [alphaPath], providers: [alphaPath], tools: ["alpha_tool"] },
  ]);
  assert.deepEqual(
    loader.getExtensions().extensions.map((extension) => extension.resolvedPath),
    [alphaPath, betaPath],
  );
  assert.deepEqual(
    loader.getExtensions().runtime.pendingProviderRegistrations.map((registration) => registration.extensionPath),
    [alphaPath, betaPath],
  );
  for (const sessionResult of sessionResults) {
    assert.notStrictEqual(sessionResult, sharedResult);
    assert.notStrictEqual(sessionResult.extensions, sharedResult.extensions);
    assert.notStrictEqual(sessionResult.errors, sharedResult.errors);
    assert.notStrictEqual(sessionResult.runtime, sharedResult.runtime);
    assert.notStrictEqual(sessionResult.runtime.pendingProviderRegistrations, sharedResult.runtime.pendingProviderRegistrations);
  }
});

void test("Pi child agent loads an inferred tool extension once and passes the exact allowlist to the session", async () => {
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
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
    });
  }
}
`,
    "utf8",
  );
  let sessionExtensionTools: string[] = [];
  let sessionTools: string[] | undefined;
  const agent = createPiWorkflowAgent({
    cwd: project,
    tools: [],
    agentCapabilityCatalog: () =>
      Promise.resolve({
        availableExtensions: [{ identifiers: [todoPath], path: todoPath, toolNames: ["todo_read", "todo_write"] }],
        baseToolNames: ["read", "bash"],
        loadErrors: [],
      }),
    createSession: createCompletedSessionFactory((sessionOptions) => {
      sessionExtensionTools =
        sessionOptions.resourceLoader?.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]) ?? [];
      sessionTools = sessionOptions.tools;
    }),
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
  assert.deepEqual(sessionTools, ["todo_write"]);
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
    tools: [],
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
