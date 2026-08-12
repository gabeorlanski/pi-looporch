import { createAgentSession, type AgentSession, type CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";

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
export function createRealToolProbeSessionFactory(
  toolName: string,
  inspect: (options: CreateAgentSessionOptions) => void,
  recordText: (text: string) => void,
): typeof createAgentSession {
  return createCompletedSessionFactory(async (options) => {
    inspect(options);
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
    agent: { afterToolCall: undefined },
    subscribe: () => () => undefined,
    prompt: () => Promise.resolve(),
    getSessionStats: () => ({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }),
    dispose: () => undefined,
  } as unknown as AgentSession;
}
