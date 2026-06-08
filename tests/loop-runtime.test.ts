import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runLoopFromDirectory, type LoopAgent, type LoopAgentOptions } from "../src/loop-runtime.ts";

interface LoopAgentCall {
  prompt: string;
  options: LoopAgentOptions;
}

async function makeProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "pi-looporch-"));
}

async function writeLoop(project: string, loopName: string, files: Record<string, string>): Promise<void> {
  const loopDir = path.join(project, ".pi", "loops", loopName);
  await mkdir(loopDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(loopDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

void test("loop_js_increment_reaches_target", async () => {
  // A loop.js can launch deterministic agents until an input target is reached.
  const project = await makeProject();
  await writeLoop(project, "count-to-target", {
    "LOOP.md": "# Count to target\n\nAdd one until the value reaches the input target.",
    "loop.js": `export default async function loop(ctx) {
  ctx.phase("counting");
  let value = 0;
  while (value < ctx.input.target) {
    value = await ctx.agent("add 1 to " + value, { label: "increment " + value, reasoning: "low" });
  }
  return { value };
}`,
  });

  const calls: LoopAgentCall[] = [];
  const agent: LoopAgent = async (prompt, options) => {
    calls.push({ prompt, options });
    const value = Number(prompt.match(/add 1 to (\d+)/)?.[1]);
    return value + 1;
  };

  const result = await runLoopFromDirectory({ cwd: project, loopName: "count-to-target", input: { target: 10 }, agent });

  assert.deepEqual(result.result, { value: 10 });
  assert.equal(calls.length, 10);
  assert.deepEqual(calls[0]?.options, { label: "increment 0", reasoning: "low" });
  assert.equal(result.snapshot.doneCount, 10);
  assert.equal(result.snapshot.phases[0], "counting");
});

void test("generated_loop_increment_reaches_target", async () => {
  // Without loop.js, the runtime asks an agent to generate one and then runs it.
  const project = await makeProject();
  await writeLoop(project, "generated-count", {
    "LOOP.md": "# Count to target\n\nAdd one until the value reaches the input target.",
  });

  const calls: LoopAgentCall[] = [];
  const agent: LoopAgent = async (prompt, options) => {
    calls.push({ prompt, options });
    if (options.label === "generate loop.js") {
      return `export default async function loop(ctx) {
  ctx.phase("generated counting");
  let value = 0;
  while (value < ctx.input.target) {
    value = await ctx.agent("add 1 to " + value, { label: "generated increment " + value, reasoning: "medium" });
  }
  return { value };
}`;
    }
    const value = Number(prompt.match(/add 1 to (\d+)/)?.[1]);
    return value + 1;
  };

  const result = await runLoopFromDirectory({ cwd: project, loopName: "generated-count", input: { target: 10 }, agent });

  assert.deepEqual(result.result, { value: 10 });
  assert.equal(calls.filter((call) => call.options.label === "generate loop.js").length, 1);
  assert.equal(calls.filter((call) => call.options.label?.startsWith("generated increment")).length, 10);
  assert.equal(result.snapshot.doneCount, 11);
  assert.equal(result.snapshot.phases.includes("generated counting"), true);

  const savedLoopSource = await readFile(path.join(project, ".pi", "loops", "generated-count", "loop.js"), "utf8");
  assert.match(savedLoopSource, /export default async function loop/);
  assert.match(savedLoopSource, /generated counting/);
});

void test("agent_progress_updates_snapshot", async () => {
  // Agent progress surfaces tool, file, and token activity while the loop is running.
  const project = await makeProject();
  await writeLoop(project, "progress", {
    "LOOP.md": "# Progress",
    "loop.js": `export default async function loop(ctx) {
  return await ctx.agent("inspect src/index.ts", { label: "inspect", taskFile: "src/index.ts" });
}`,
  });

  const snapshots: Array<{ toolUseCount: number; activeToolUseCount: number; tokenCount: number; filesTouched: string[] }> = [];
  const agent: LoopAgent = async (_prompt, _options, reportProgress) => {
    reportProgress({ statusMessage: "using read", toolUseCount: 1, activeToolUseCount: 1, filesTouched: ["src/index.ts"], tokenCount: 12 });
    return "done";
  };

  await runLoopFromDirectory({
    cwd: project,
    loopName: "progress",
    input: {},
    agent,
    onSnapshot(snapshot) {
      const latest = snapshot.agents.at(-1);
      if (latest) {
        snapshots.push({
          toolUseCount: latest.toolUseCount,
          activeToolUseCount: latest.activeToolUseCount,
          tokenCount: latest.tokenCount,
          filesTouched: latest.filesTouched,
        });
      }
    },
  });

  assert.deepEqual(snapshots.at(-2), { toolUseCount: 1, activeToolUseCount: 1, tokenCount: 12, filesTouched: ["src/index.ts"] });
});

void test("branching_loop_uses_loop_files_and_agent_options", async () => {
  // A loop can fan out based on input while passing loop-local file references and options.
  const project = await makeProject();
  await writeLoop(project, "branching", {
    "LOOP.md": "# Branching\n\nRun one agent per requested task file.",
    "tasks/alpha.md": "Analyze alpha using local instructions.",
    "tasks/beta.md": "Analyze beta using local instructions.",
    "tasks/gamma.md": "Analyze gamma using local instructions.",
    "loop.js": `export default async function loop(ctx) {
  ctx.phase("fanout");
  const results = await Promise.all(ctx.input.tasks.map((task) =>
    ctx.agent(ctx.readLoopFile(task.file), {
      label: task.name,
      reasoning: task.reasoning,
      model: task.model,
      taskFile: ctx.resolveLoopPath(task.file)
    })
  ));
  return { results };
}`,
  });

  const calls: LoopAgentCall[] = [];
  const agent: LoopAgent = async (prompt, options) => {
    calls.push({ prompt, options });
    return `${options.label}:${options.reasoning}:${path.basename(String(options.taskFile))}`;
  };

  const result = await runLoopFromDirectory({
    cwd: project,
    loopName: "branching",
    input: {
      tasks: [
        { name: "alpha", file: "tasks/alpha.md", reasoning: "low", model: "fast-model" },
        { name: "beta", file: "tasks/beta.md", reasoning: "high", model: "deep-model" },
        { name: "gamma", file: "tasks/gamma.md", reasoning: "medium", model: "balanced-model" },
      ],
    },
    agent,
  });

  assert.deepEqual(result.result, { results: ["alpha:low:alpha.md", "beta:high:beta.md", "gamma:medium:gamma.md"] });
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.prompt, "Analyze alpha using local instructions.");
  assert.equal(calls[1]?.options.reasoning, "high");
  assert.equal(calls[1]?.options.model, "deep-model");
  assert.equal(String(calls[2]?.options.taskFile).startsWith(path.join(project, ".pi", "loops", "branching")), true);
  assert.equal(result.snapshot.doneCount, 3);
});
