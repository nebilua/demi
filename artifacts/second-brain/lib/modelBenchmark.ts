export type InferenceBenchmarkSample = {
  firstTokenMs: number;
  tokensPerSecond: number;
  durationMs: number;
};

export type InferenceBenchmarkSummary = {
  sampleCount: number;
  medianFirstTokenMs: number;
  medianTokensPerSecond: number;
  medianDurationMs: number;
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export async function runLocalModelBenchmark(
  runSample: () => Promise<InferenceBenchmarkSample>,
  sampleCount = 3,
): Promise<InferenceBenchmarkSummary> {
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 10) {
    throw new Error('Choose between 1 and 10 benchmark samples.');
  }

  // A separate warm-up keeps initial JSI/KV-cache overhead out of the median.
  await runSample();
  const samples: InferenceBenchmarkSample[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = await runSample();
    if (
      !Number.isFinite(sample.firstTokenMs) ||
      !Number.isFinite(sample.tokensPerSecond) ||
      !Number.isFinite(sample.durationMs) ||
      sample.firstTokenMs < 0 ||
      sample.tokensPerSecond < 0 ||
      sample.durationMs < 0
    ) {
      throw new Error('The local model returned incomplete timing data.');
    }
    samples.push(sample);
  }

  return {
    sampleCount: samples.length,
    medianFirstTokenMs: median(samples.map((sample) => sample.firstTokenMs)),
    medianTokensPerSecond: median(
      samples.map((sample) => sample.tokensPerSecond),
    ),
    medianDurationMs: median(samples.map((sample) => sample.durationMs)),
  };
}
