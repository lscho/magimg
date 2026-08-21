import { describe, expect, it } from "vitest";
import {
  runTwoStagePipeline,
  shouldOverlapCutoutMatting
} from "@/services/cutoutMattingPipeline";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

async function flushTasks() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("cutout matting pipeline", () => {
  it("only overlaps adjacent stages and preserves input order", async () => {
    const first = [deferred<string>(), deferred<string>()];
    const second = [deferred<string>(), deferred<string>()];
    const events: string[] = [];
    const running = runTwoStagePipeline(
      ["a", "b"],
      {
        first: async (_input, index) => {
          events.push(`first:${index}`);
          return first[index].promise;
        },
        second: async (prepared, _input, index) => {
          events.push(`second:${index}:${prepared}`);
          return second[index].promise;
        }
      },
      true
    );

    await flushTasks();
    expect(events).toEqual(["first:0"]);

    first[0].resolve("prepared-a");
    await flushTasks();
    expect(events).toContain("first:1");
    expect(events).toContain("second:0:prepared-a");

    first[1].resolve("prepared-b");
    await flushTasks();
    expect(events).not.toContain("second:1:prepared-b");

    second[0].resolve("result-a");
    await flushTasks();
    expect(events).toContain("second:1:prepared-b");
    second[1].resolve("result-b");

    await expect(running).resolves.toEqual(["result-a", "result-b"]);
  });

  it("keeps both stages serial on lower-core devices", async () => {
    const events: string[] = [];
    const results = await runTwoStagePipeline(
      [1, 2],
      {
        first: async input => {
          events.push(`first:${input}`);
          return input;
        },
        second: async input => {
          events.push(`second:${input}`);
          return input * 2;
        }
      },
      false
    );

    expect(events).toEqual(["first:1", "second:1", "first:2", "second:2"]);
    expect(results).toEqual([2, 4]);
  });

  it("requires multiple selections and at least eight logical cores", () => {
    expect(shouldOverlapCutoutMatting(1, 12)).toBe(false);
    expect(shouldOverlapCutoutMatting(2, 4)).toBe(false);
    expect(shouldOverlapCutoutMatting(2, 8)).toBe(true);
  });
});
