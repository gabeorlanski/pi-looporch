/** Provides agent session logs behavior. */
import { appendFileSync } from "node:fs";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { WorkflowAgentSessionLog } from "../runtime/types.ts";
import { workflowAgentSessionLogDirectory } from "./logs.ts";
import { workflowAgentLogEvent } from "./events.ts";
import { writeJsonFileAtomic, writeTextFileAtomic } from "../workflow/files.ts";

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
  const sessionId = `workflow-agent-${String(sessionLog.agentId)}`;
  const sessionManager = SessionManager.create(agentCwd, sessionDir, { id: sessionId });
  const sessionFile = sessionManager.getSessionFile() ?? path.join(sessionDir, `${sessionId}.jsonl`);
  await Promise.all([
    writeJsonFileAtomic(path.join(sessionDir, "metadata.json"), {
      ...sessionLog,
      cwd: path.resolve(agentCwd),
      projectCwd: path.resolve(projectCwd),
      sessionDir,
      sessionFile,
      eventsFile,
      startedAt: new Date().toISOString(),
    }),
    writeTextFileAtomic(eventsFile, ""),
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
