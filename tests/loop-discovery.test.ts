import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverLoops, loopRootsForProject } from "../src/loop-discovery.ts";
import { runLoopFromDirectory, type LoopAgent } from "../src/loop-runtime.ts";

async function makeProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "pi-looporch-discovery-"));
}

async function writeLoop(loopDir: string, files: Record<string, string>): Promise<void> {
  await mkdir(loopDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(loopDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

void test("configured_loop_roots_are_discovered", async () => {
  // .pi/settings.json can register loop roots outside the project .pi directory.
  const project = await makeProject();
  const sharedRoot = path.join(project, "..", "shared-loops");
  await writeLoop(path.join(project, ".pi", "loops", "local"), { "LOOP.md": "# Local" });
  await writeLoop(path.join(sharedRoot, "external"), { "LOOP.md": "# External" });
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await writeFile(path.join(project, ".pi", "settings.json"), JSON.stringify({ looporch: { loopDirs: ["../shared-loops"] } }), "utf8");

  const loops = await discoverLoops(project);

  assert.deepEqual(loops.map((loop) => loop.name), ["external", "local"]);
  assert.equal(loops.find((loop) => loop.name === "external")?.dir, path.resolve(project, "../shared-loops/external"));
});

void test("configured_direct_loop_directories_are_discovered", async () => {
  // A config entry may point directly at a single loop directory with LOOP.md.
  const project = await makeProject();
  const directLoop = path.join(project, "..", "one-off-loop");
  await writeLoop(directLoop, { "LOOP.md": "# One Off" });
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await writeFile(path.join(project, ".pi", "settings.json"), JSON.stringify({ looporch: { loopDirs: ["../one-off-loop"] } }), "utf8");

  const loops = await discoverLoops(project);

  assert.deepEqual(loops.map((loop) => loop.name), ["one-off-loop"]);
  assert.equal(loops[0]?.dir, path.resolve(project, "../one-off-loop"));
});

void test("external_loop_runs_from_configured_directory", async () => {
  // Running by name resolves external loops from .pi/settings.json.
  const project = await makeProject();
  const sharedRoot = path.join(project, "..", "shared-run-loops");
  await writeLoop(path.join(sharedRoot, "external-run"), {
    "LOOP.md": "# External Run",
    "loop.js": `export default async function loop(ctx) {
  return { loopDir: ctx.loopDir, output: await ctx.agent("external task", { label: "external" }) };
}`,
  });
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await writeFile(path.join(project, ".pi", "settings.json"), JSON.stringify({ looporch: { loopDirs: ["../shared-run-loops"] } }), "utf8");

  const agent: LoopAgent = async () => "done";
  const result = await runLoopFromDirectory({ cwd: project, loopName: "external-run", input: {}, agent, loopRoots: await loopRootsForProject(project) });

  assert.deepEqual(result.result, { loopDir: path.resolve(project, "../shared-run-loops/external-run"), output: "done" });
});
