/** Provides agent session logs behavior. */
import { appendFileSync } from "node:fs";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { WorkflowAgentSessionLog } from "./runtime/types.ts";
import { workflowAgentSessionLogDirectory } from "./session-logs.ts";
import { workflowAgentLogEvent } from "./session-events.ts";

export interface LoggedWorkflowAgentSession {
  sessionManager: SessionManager;
  sessionDir: string;
  sessionFile: string;
  eventsFile: string;
  recordEvent: (event: unknown) => void;
}

/** Provides the createLoggedWorkflowAgentSession function contract. */
export async function createLoggedWorkflowAgentSession(
  projectCwd: string,
  agentCwd: string,
  sessionLog: WorkflowAgentSessionLog,
): Promise<LoggedWorkflowAgentSession> {
  const sessionDir = workflowAgentSessionLogDirectory(projectCwd, sessionLog.parentId, sessionLog.agentKey);
  const eventsFile = path.join(sessionDir, "events.jsonl");
  await mkdir(sessionDir, { recursive: true });
  const sessionId = `workflow-agent-${String(sessionLog.agentId)}`;
  const sessionManager = SessionManager.create(agentCwd, sessionDir, { id: sessionId });
  const sessionFile = sessionManager.getSessionFile() ?? path.join(sessionDir, `${sessionId}.jsonl`);
  await Promise.all([
    writeFile(
      path.join(sessionDir, "metadata.json"),
      `${JSON.stringify(
        {
          ...sessionLog,
          cwd: path.resolve(agentCwd),
          projectCwd: path.resolve(projectCwd),
          sessionDir,
          sessionFile,
          eventsFile,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(eventsFile, "", "utf8"),
  ]);
  let seq = 0;
  return {
    sessionManager,
    sessionDir,
    sessionFile,
    eventsFile,
    recordEvent(event) {
      if (!isEventObject(event)) return;
      const loggedEvent = workflowAgentLogEvent(event);
      if (loggedEvent === undefined) return;
      appendFileSync(eventsFile, `${JSON.stringify({ seq: ++seq, time: new Date().toISOString(), event: loggedEvent })}\n`, "utf8");
    },
  };
}

function isEventObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}
