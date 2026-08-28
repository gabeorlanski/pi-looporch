import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentLaunchQueue } from "../src/runtime/queue.ts";

void test("agent launch queue holds work until an active slot is released", async () => {
  const queue = createAgentLaunchQueue(1);
  const releaseFirst = await queue.acquire(undefined);
  let secondAcquired = false;
  const second = queue.acquire(undefined).then((release) => {
    secondAcquired = true;
    return release;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondAcquired, false);
  releaseFirst();

  const releaseSecond = await second;
  assert.equal(secondAcquired, true);
  releaseSecond();
});

void test("agent launch queue rejects work aborted while waiting", async () => {
  const queue = createAgentLaunchQueue(1);
  const releaseFirst = await queue.acquire(undefined);
  const controller = new AbortController();
  const waiting = queue.acquire(controller.signal);

  controller.abort();

  await assert.rejects(waiting, /Workflow aborted/);
  releaseFirst();
});
