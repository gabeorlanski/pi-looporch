export function workflowAgentLogEvent(event: Record<string, unknown>): Record<string, unknown> | undefined {
  if (event.type === "message_update") return undefined;
  if (event.type === "message_start" || event.type === "message_end") {
    return { ...event, message: loggedMessageMetadata(event.message) };
  }
  if (event.type === "agent_end") {
    const { messages, ...metadata } = event;
    return { ...metadata, ...(Array.isArray(messages) ? { messageCount: messages.length } : {}) };
  }
  if (event.type === "turn_end") {
    const { message, toolResults, ...metadata } = event;
    return {
      ...metadata,
      message: loggedMessageMetadata(message),
      ...(Array.isArray(toolResults) ? { toolResultCount: toolResults.length } : {}),
    };
  }
  if (event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end") {
    return loggedToolLifecycleEvent(event);
  }
  return event;
}

function loggedToolLifecycleEvent(event: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = { type: event.type };
  for (const key of ["toolCallId", "toolName", "isError"] as const) {
    if (event[key] !== undefined) metadata[key] = event[key];
  }
  return metadata;
}

function loggedMessageMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const message = value as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  for (const key of ["role", "usage", "api", "provider", "model", "stopReason", "timestamp", "responseId"] as const) {
    if (message[key] !== undefined) metadata[key] = message[key];
  }
  return metadata;
}
