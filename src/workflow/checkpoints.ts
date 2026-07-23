/** Persists successful workflow model calls for deterministic in-session replay. */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isMissingFileError } from "../errors.ts";
import type { Checkpoint, CheckpointCache } from "../runtime/types.ts";
import { writeJsonFileAtomic } from "./files.ts";

const CHECKPOINTS_FILE = "checkpoints.json";

/** Creates a fresh or resumed checkpoint cache in a workflow run directory. */
export async function createCheckpointCache(outputsDir: string, resume: boolean): Promise<CheckpointCache> {
  await mkdir(outputsDir, { recursive: true });
  const checkpoints = resume ? await readCheckpoints(outputsDir) : [];
  if (!resume) await writeJsonFileAtomic(path.join(outputsDir, CHECKPOINTS_FILE), checkpoints);
  return new FileCheckpointCache(outputsDir, checkpoints);
}

class FileCheckpointCache implements CheckpointCache {
  readonly #outputsDir: string;
  readonly #cached: Map<string, Checkpoint>;
  readonly #retained: Checkpoint[] = [];
  #diverged: boolean;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(outputsDir: string, checkpoints: Checkpoint[]) {
    this.#outputsDir = outputsDir;
    this.#cached = new Map(checkpoints.map((checkpoint) => [checkpoint.executionId, checkpoint]));
    this.#diverged = checkpoints.length === 0;
  }

  async get(kind: Checkpoint["kind"], executionId: string, requestHash: string): Promise<Checkpoint | undefined> {
    const candidate = this.#diverged ? undefined : this.#cached.get(executionId);
    if (candidate?.kind === kind && candidate.requestHash === requestHash) {
      this.#retained.push(candidate);
      return candidate;
    }
    if (!this.#diverged) {
      this.#diverged = true;
      this.#enqueue(() => writeJsonFileAtomic(path.join(this.#outputsDir, CHECKPOINTS_FILE), this.#retained));
      await this.#writeQueue;
    }
    return undefined;
  }

  async put(checkpoint: Checkpoint): Promise<void> {
    this.#enqueue(async () => {
      this.#retained.push(checkpoint);
      await writeJsonFileAtomic(path.join(this.#outputsDir, CHECKPOINTS_FILE), this.#retained);
    });
    await this.#writeQueue;
  }

  #enqueue(write: () => Promise<void>): void {
    this.#writeQueue = this.#writeQueue.then(write);
  }
}

async function readCheckpoints(outputsDir: string): Promise<Checkpoint[]> {
  try {
    const value = JSON.parse(await readFile(path.join(outputsDir, CHECKPOINTS_FILE), "utf8")) as unknown;
    if (!Array.isArray(value)) throw new Error("Workflow checkpoint file must contain an array");
    return value as Checkpoint[];
  } catch (error) {
    if (isMissingFileError(error)) throw new Error(`Workflow run has no resume checkpoints: ${outputsDir}`);
    throw error;
  }
}
