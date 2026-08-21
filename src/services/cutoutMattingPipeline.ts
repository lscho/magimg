const MIN_PIPELINE_HARDWARE_CONCURRENCY = 8;

interface TwoStagePipelineHandlers<TInput, TPrepared, TResult> {
  first: (input: TInput, index: number) => Promise<TPrepared>;
  second: (prepared: TPrepared, input: TInput, index: number) => Promise<TResult>;
}

export function shouldOverlapCutoutMatting(
  selectionCount: number,
  hardwareConcurrency = typeof navigator === "undefined" ? 1 : navigator.hardwareConcurrency
) {
  return selectionCount > 1 && hardwareConcurrency >= MIN_PIPELINE_HARDWARE_CONCURRENCY;
}

/** Runs at most one task per stage while allowing adjacent stages to overlap. */
export async function runTwoStagePipeline<TInput, TPrepared, TResult>(
  inputs: readonly TInput[],
  handlers: TwoStagePipelineHandlers<TInput, TPrepared, TResult>,
  overlap: boolean
): Promise<TResult[]> {
  if (!overlap) {
    const results: TResult[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      const prepared = await handlers.first(input, index);
      results.push(await handlers.second(prepared, input, index));
    }
    return results;
  }

  let firstTail: Promise<void> = Promise.resolve();
  let secondTail: Promise<void> = Promise.resolve();
  const results = inputs.map((input, index) => {
    const prepared = firstTail.then(() => handlers.first(input, index));
    firstTail = prepared.then(() => undefined);
    const previousSecond = secondTail;
    const result = Promise.all([prepared, previousSecond])
      .then(([value]) => handlers.second(value, input, index));
    secondTail = result.then(() => undefined);
    return result;
  });

  // The returned result promises carry failures to the caller; consume the derived tails too.
  void firstTail.catch(() => undefined);
  void secondTail.catch(() => undefined);
  return Promise.all(results);
}
