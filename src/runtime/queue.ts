/** Provides queue behavior. */
import type { AgentLaunchQueue } from "./context.ts";

/** Provides the normalizeMaxParallelAgents function contract. */
export function normalizeMaxParallelAgents(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("maxParallelAgents must be a positive integer");
  return value;
}

/** Provides the createAgentLaunchQueue function contract. */
export function createAgentLaunchQueue(maxParallelAgents: number): AgentLaunchQueue {
  let activeAgents = 0;
  const waiting: {
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    signal: AbortSignal | undefined;
    abort: () => void;
  }[] = [];

  const releaseNext = (): void => {
    while (activeAgents < maxParallelAgents && waiting.length > 0) {
      const waiter = waiting.shift();
      if (!waiter) return;
      waiter.signal?.removeEventListener("abort", waiter.abort);
      if (waiter.signal?.aborted) {
        waiter.reject(new Error("Workflow aborted"));
        continue;
      }
      activeAgents++;
      waiter.resolve(releaseOnce());
      return;
    }
  };

  const releaseOnce = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeAgents = Math.max(0, activeAgents - 1);
      releaseNext();
    };
  };

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(new Error("Workflow aborted"));
      if (activeAgents < maxParallelAgents) {
        activeAgents++;
        return Promise.resolve(releaseOnce());
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve,
          reject,
          signal,
          abort: () => {
            const index = waiting.indexOf(waiter);
            if (index >= 0) waiting.splice(index, 1);
            reject(new Error("Workflow aborted"));
          },
        };
        waiting.push(waiter);
        signal?.addEventListener("abort", waiter.abort, { once: true });
      });
    },
  };
}
