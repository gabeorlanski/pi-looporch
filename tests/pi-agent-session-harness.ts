import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";

export interface CapabilityExtensionLoader {
  loader: DefaultResourceLoader;
  alphaPath: string;
  betaPath: string;
}

/** Creates two real Pi extensions loaded through one isolated resource loader. */
export async function createCapabilityExtensionLoader(project: string): Promise<CapabilityExtensionLoader> {
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-agent-dir-"));
  const alphaPath = path.join(project, "alpha-extension.js");
  const betaPath = path.join(project, "beta-extension.js");
  for (const [extensionPath, name] of [
    [alphaPath, "alpha"],
    [betaPath, "beta"],
  ]) {
    await writeFile(
      extensionPath,
      `export default function capabilityExtension(pi) {
  pi.registerTool({
    name: "${name}_tool",
    label: "${name}_tool",
    description: "${name}_tool",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: pi.getActiveTools().join(",") }], details: {} }),
  });
  pi.registerProvider("${name}_provider", {
    baseUrl: "https://example.com",
    apiKey: "test",
    api: "openai-completions",
    models: [],
  });
}
`,
      "utf8",
    );
  }
  const loader = new DefaultResourceLoader({
    cwd: project,
    agentDir,
    noExtensions: true,
    additionalExtensionPaths: [alphaPath, betaPath],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  return { loader, alphaPath, betaPath };
}

/** Returns a typed SDK session factory that records options and completes without calling a model. */
export function createCompletedSessionFactory(
  inspect: (options: CreateAgentSessionOptions) => void | Promise<void>,
): typeof createAgentSession {
  return async (options) => {
    if (!options?.resourceLoader) throw new Error("Expected a child resource loader");
    await inspect(options);
    return { session: completedSession(), extensionsResult: options.resourceLoader.getExtensions() };
  };
}

/** Creates a real SDK session, invokes one extension tool action, then returns a no-model completed session. */
export function createRealToolProbeSessionFactory(toolName: string, recordText: (text: string) => void): typeof createAgentSession {
  return createCompletedSessionFactory(async (options) => {
    const { session } = await createAgentSession(options);
    try {
      const tool = session.getToolDefinition(toolName);
      if (!tool) throw new Error(`Expected ${toolName}`);
      const result = await tool.execute("runtime-probe", {}, undefined, undefined, undefined as never);
      recordText(result.content.map((content) => (content.type === "text" ? content.text : "")).join(""));
    } finally {
      session.dispose();
    }
  });
}

function completedSession(): AgentSession {
  return {
    model: undefined,
    messages: [],
    subscribe: () => () => undefined,
    prompt: () => Promise.resolve(),
    dispose: () => undefined,
  } as unknown as AgentSession;
}
