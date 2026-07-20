import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createAgentCapabilityCatalogProvider, type AgentCapabilityCatalogProvider } from "../src/pi-agent/capabilities/catalog.ts";
import { validateWorkflowAgentCapabilities } from "../src/workflow/agent-capability-validation.ts";

function catalogProvider(
  overrides: {
    extensions?: { identifiers: string[]; path: string; toolNames: string[] }[];
    tools?: string[];
    loadErrors?: { path: string; error: string; selectors?: string[] }[];
  } = {},
): AgentCapabilityCatalogProvider {
  return () =>
    Promise.resolve({
      availableExtensions: overrides.extensions ?? [],
      baseToolNames: overrides.tools ?? ["bash", "read"],
      loadErrors: overrides.loadErrors ?? [],
    });
}

void test("proposal capability validation accepts top-level const lists on every agent-launching primitive", async () => {
  const source = `const EXTENSIONS = ["todo"];
const TOOLS = ["todo_write"];
export default async function workflow() {
  await agent("work", { extensions: EXTENSIONS, tools: TOOLS });
  await mapreduce({ inputPrompt: "input", mapPrompt: "map", reducePrompt: "reduce", extensions: EXTENSIONS, tools: TOOLS });
  return verifier({ criteria: [], criteriaPrompt: "vote", reducePrompt: "reduce", extensions: EXTENSIONS, tools: TOOLS });
}`;

  await validateWorkflowAgentCapabilities({
    source,
    workflowName: "review",
    defaultExtensions: "all",
    defaultTools: "all",
    catalogProvider: catalogProvider({
      extensions: [{ identifiers: ["todo"], path: "/extensions/todo.ts", toolNames: ["todo_read", "todo_write"] }],
    }),
  });
});

void test("proposal capability validation aggregates malformed dynamic duplicate and unknown selections", async () => {
  const source = `const options = { tools: ["read"] };
export default async function workflow() {
  await agent("work", { extensions: "todo", tools: ["", 42, "read", "read"] });
  await agent("spread", { ...options });
  await agent("duplicate", { tools: ["read"], tools: ["missing_duplicate"] });
  await agent("computed", { ["tools"]: ["missing_computed"] });
  await mapreduce(options);
  return verifier({ criteria: [], criteriaPrompt: "vote", reducePrompt: "reduce", extensions: ["missing"], tools: ["missing_tool"] });
}`;

  await assert.rejects(
    validateWorkflowAgentCapabilities({
      source,
      workflowName: "review",
      defaultExtensions: [],
      defaultTools: ["read"],
      catalogProvider: catalogProvider(),
    }),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /agent extensions "\\"todo\\"": Capability selection must be an array/);
      assert.match(message, /agent tools\[0\] "\\"\\"": Capability entries must be non-empty strings/);
      assert.match(message, /agent tools\[1\] "42": Capability entries must be non-empty strings/);
      assert.match(message, /agent tools\[3\] "read": Duplicate capability entry/);
      assert.match(message, /agent extensions: Agent primitive options cannot use spreads/);
      assert.match(message, /agent tools: Agent primitive options cannot use spreads/);
      assert.match(message, /agent tools: Capability must be specified at most once/);
      assert.match(message, /agent tools\[0\] "missing_computed": Unknown tool/);
      assert.match(message, /mapreduce extensions: Agent primitive options must be an object literal/);
      assert.match(message, /mapreduce tools: Agent primitive options must be an object literal/);
      assert.match(message, /verifier extensions\[0\] "missing": Unknown extension/);
      assert.match(message, /verifier tools\[0\] "missing_tool": Unknown tool/);
      assert.match(message, /No workflow files were saved\./);
      return true;
    },
  );
});

void test("proposal capability validation applies settings defaults when primitive fields are omitted", async () => {
  const requests: string[][] = [];
  const provider: AgentCapabilityCatalogProvider = (request) => {
    requests.push(request.extensionSelectors);
    return Promise.resolve({
      availableExtensions: [{ identifiers: ["todo"], path: "/extensions/todo.ts", toolNames: ["todo_read", "todo_write"] }],
      baseToolNames: ["read"],
      loadErrors: [],
    });
  };

  await validateWorkflowAgentCapabilities({
    source: `export default async function workflow() { return agent("work"); }`,
    workflowName: "review",
    defaultExtensions: ["todo"],
    defaultTools: ["todo_write"],
    catalogProvider: provider,
  });

  assert.deepEqual(requests, [["todo"]]);
});

void test("proposal capability validation rejects duplicate and unavailable settings defaults", async () => {
  await assert.rejects(
    validateWorkflowAgentCapabilities({
      source: `export default async function workflow() { return agent("work"); }`,
      workflowName: "review",
      defaultExtensions: ["todo", "todo"],
      defaultTools: ["missing_tool", "missing_tool"],
      catalogProvider: catalogProvider({
        extensions: [{ identifiers: ["todo"], path: "/extensions/todo.ts", toolNames: ["todo_write"] }],
      }),
    }),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /agent extensions\[1\] "todo": Duplicate capability entry/);
      assert.match(message, /agent tools\[0\] "missing_tool": Unknown tool/);
      assert.match(message, /agent tools\[1\] "missing_tool": Duplicate capability entry/);
      return true;
    },
  );
});

void test("proposal capability validation reports extension loader failures", async () => {
  await assert.rejects(
    validateWorkflowAgentCapabilities({
      source: `export default async function workflow() { return agent("work"); }`,
      workflowName: "review",
      defaultExtensions: "all",
      defaultTools: "all",
      catalogProvider: catalogProvider({
        loadErrors: [{ path: "broken-extension", error: "Failed to load extension: invalid factory" }],
      }),
    }),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /workflow\.js:1:\d+ agent extensions: Extension failed to load/);
      assert.match(message, /broken-extension: Failed to load extension: invalid factory/);
      return true;
    },
  );
});

void test("proposal capability validation ignores unrelated ambient loader failures for an explicit valid subset", async () => {
  await validateWorkflowAgentCapabilities({
    source: `export default async function workflow() { return agent("work", { extensions: ["good"], tools: ["read"] }); }`,
    workflowName: "review",
    defaultExtensions: "all",
    defaultTools: "all",
    catalogProvider: catalogProvider({
      extensions: [{ identifiers: ["good"], path: "/extensions/good.ts", toolNames: [] }],
      loadErrors: [{ path: "/extensions/broken.ts", error: "Failed to load extension", selectors: [] }],
    }),
  });
});

void test("proposal capability validation rejects ambiguous extension tool owners", async () => {
  await assert.rejects(
    validateWorkflowAgentCapabilities({
      source: `export default async function workflow() { return agent("work", { extensions: [], tools: ["search"] }); }`,
      workflowName: "review",
      defaultExtensions: "all",
      defaultTools: "all",
      catalogProvider: catalogProvider({
        extensions: [
          { identifiers: ["alpha"], path: "/extensions/alpha.ts", toolNames: ["search"] },
          { identifiers: ["beta"], path: "/extensions/beta.ts", toolNames: ["search"] },
        ],
      }),
    }),
    /agent tools\[0\] "search": Ambiguous tool owner\. Registered by: alpha, beta/,
  );
});

void test("proposal capability validation rejects ambiguous extension identifiers", async () => {
  await assert.rejects(
    validateWorkflowAgentCapabilities({
      source: `export default async function workflow() { return agent("work", { extensions: ["shared"], tools: [] }); }`,
      workflowName: "review",
      defaultExtensions: "all",
      defaultTools: "all",
      catalogProvider: catalogProvider({
        extensions: [
          { identifiers: ["shared"], path: "/extensions/alpha.ts", toolNames: [] },
          { identifiers: ["shared"], path: "/extensions/beta.ts", toolNames: [] },
        ],
      }),
    }),
    /agent extensions\[0\] "shared": Ambiguous extension selector\. Matches: shared, shared\./,
  );
});

void test("proposal capability validation ignores locally shadowed primitive names", async () => {
  let catalogLoads = 0;
  await validateWorkflowAgentCapabilities({
    source: `const agent = () => undefined;
const mapreduce = () => undefined;
const verifier = () => undefined;
export default async function workflow() {
  agent("work", { tools: ["missing"] });
  mapreduce({ tools: ["missing"] });
  return verifier({ tools: ["missing"] });
}`,
    workflowName: "review",
    defaultExtensions: "all",
    defaultTools: "all",
    catalogProvider: () => {
      catalogLoads++;
      return catalogProvider()({ extensionSelectors: [] });
    },
  });
  assert.equal(catalogLoads, 0);
});

void test("capability analyzer follows primitive aliases and ignores unrelated nested shadowing", async () => {
  const source = `function unrelated(agent) { return agent; }
const launch = agent;
export default async function workflow() {
  await launch("aliased", { tools: ["misspelled_alias"] });
  return (agent)("parenthesized", { tools: ["misspelled_parenthesized"] });
}`;

  await assert.rejects(
    validateWorkflowAgentCapabilities({
      source,
      workflowName: "review",
      defaultExtensions: [],
      defaultTools: [],
      catalogProvider: catalogProvider(),
    }),
    (error: unknown) => {
      assert.match(String(error), /agent tools\[0\] "misspelled_alias": Unknown tool/);
      assert.match(String(error), /agent tools\[0\] "misspelled_parenthesized": Unknown tool/);
      return true;
    },
  );
});

void test("capability analyzer rejects indirect invocation and unsafe const arrays", async () => {
  const source = `const MUTATED_TOOLS = ["read"];
MUTATED_TOOLS.push("reed");
const ORIGINAL_TOOLS = ["read"];
const ALIASED_TOOLS = ORIGINAL_TOOLS;
export default async function workflow() {
  agent.call(undefined, "indirect", { tools: ["read"] });
  await agent("mutated", { tools: MUTATED_TOOLS });
  return agent("aliased", { tools: ALIASED_TOOLS });
}`;

  await assert.rejects(
    validateWorkflowAgentCapabilities({
      source,
      workflowName: "review",
      defaultExtensions: [],
      defaultTools: [],
      catalogProvider: catalogProvider(),
    }),
    (error: unknown) => {
      assert.match(String(error), /agent invocation: Primitive references must be invoked directly/);
      assert.match(
        String(error),
        /agent tools "MUTATED_TOOLS": Capability const arrays cannot be mutated or used outside capability fields/,
      );
      assert.match(String(error), /agent tools "ALIASED_TOOLS": Capability const arrays cannot be mutated or aliased/);
      return true;
    },
  );
});

void test("proposal capability validation rejects a base and extension tool collision", async () => {
  await assert.rejects(
    validateWorkflowAgentCapabilities({
      source: `export default async function workflow() { return agent("work", { extensions: [], tools: ["read"] }); }`,
      workflowName: "review",
      defaultExtensions: [],
      defaultTools: [],
      catalogProvider: catalogProvider({
        extensions: [{ identifiers: ["shadow-read"], path: "/extensions/shadow-read.ts", toolNames: ["read"] }],
        tools: ["read"],
      }),
    }),
    /agent tools\[0\] "read": Ambiguous tool owner\. Registered by: Pi base tools, shadow-read/,
  );
});

void test("proposal capability catalog preserves explicit extension selectors", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-capability-catalog-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-capability-agent-"));
  await writeFile(path.join(project, "todo-extension.js"), "export default function todoExtension() {}\n", "utf8");

  const catalog = await createAgentCapabilityCatalogProvider({ cwd: project, agentDir })({
    extensionSelectors: ["./todo-extension.js"],
  });

  assert.equal(catalog.loadErrors.length, 0);
  assert.ok(catalog.availableExtensions.some((extension) => extension.identifiers.includes("./todo-extension.js")));
});

void test("proposal capability validation attributes a real explicit extension factory failure", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-capability-catalog-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-capability-agent-"));
  const extensionPath = path.join(project, "broken-extension.js");
  await writeFile(extensionPath, `export default function brokenExtension() { throw new Error("factory exploded"); }\n`, "utf8");

  await assert.rejects(
    validateWorkflowAgentCapabilities({
      source: `export default async function workflow() {
  return agent("work", { extensions: ["./broken-extension.js"], tools: [] });
}`,
      workflowName: "review",
      defaultExtensions: "all",
      defaultTools: "all",
      catalogProvider: createAgentCapabilityCatalogProvider({ cwd: project, agentDir }),
    }),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /agent extensions\[0\] "\.\/broken-extension\.js": Extension failed to load/);
      assert.ok(message.includes(`${extensionPath}: Failed to load extension: factory exploded`));
      assert.doesNotMatch(message, /Unknown extension/);
      return true;
    },
  );
});

void test("proposal capability validation renders a real missing extension selector", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-capability-catalog-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-capability-agent-"));

  await assert.rejects(
    validateWorkflowAgentCapabilities({
      source: `export default async function workflow() {
  return agent("work", { extensions: ["./missing-extension.js"], tools: [] });
}`,
      workflowName: "review",
      defaultExtensions: "all",
      defaultTools: "all",
      catalogProvider: createAgentCapabilityCatalogProvider({ cwd: project, agentDir }),
    }),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /agent extensions\[0\] "\.\/missing-extension\.js": Unknown extension/);
      assert.match(message, /Available extensions: none/);
      assert.match(message, /No workflow files were saved/);
      return true;
    },
  );
});

void test("proposal capability catalog initializes each selected extension once", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-capability-catalog-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-capability-agent-"));
  const countPath = path.join(project, "factory-count.txt");
  await writeFile(
    path.join(project, "todo-extension.js"),
    `import { appendFileSync } from "node:fs";
export default function todoExtension() { appendFileSync(${JSON.stringify(countPath)}, "loaded\\n"); }
`,
    "utf8",
  );

  await createAgentCapabilityCatalogProvider({ cwd: project, agentDir })({
    extensionSelectors: ["./todo-extension.js", "./todo-extension.js"],
  });

  assert.equal((await readFile(countPath, "utf8")).trim().split("\n").length, 1);
});
