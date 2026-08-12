const SURFACE_FEATURES = 6;
const MAX_SURFACE_SAMPLES = 12_288;
const MAX_COMPATIBLE_COLOR_DELTA = 72;
const STRONG_GRADIENT_THRESHOLD = 18;

export interface RepairSurfaceModel {
  red: number[];
  green: number[];
  blue: number[];
}

export interface RepairSurfaceAnalysis {
  model: RepairSurfaceModel | null;
  sampleCount: number;
  compatibleSampleRatio: number;
  spatialCoverage: number;
  fitError: number;
  meanGradient: number;
  strongGradientRatio: number;
}

export interface RepairBoundaryQuality {
  sampleCount: number;
  meanError: number;
  strongErrorRatio: number;
}

interface SurfaceSample {
  x: number;
  y: number;
  red: number;
  green: number;
  blue: number;
  gradient: number | null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedCoordinate(value: number, size: number) {
  return size <= 1 ? 0 : value / (size - 1) * 2 - 1;
}

function surfaceFeatures(x: number, y: number, width: number, height: number) {
  const normalizedX = normalizedCoordinate(x, width);
  const normalizedY = normalizedCoordinate(y, height);
  return [
    1,
    normalizedX,
    normalizedY,
    normalizedX * normalizedY,
    normalizedX * normalizedX,
    normalizedY * normalizedY
  ];
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < SURFACE_FEATURES; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < SURFACE_FEATURES; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-8) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= SURFACE_FEATURES; index += 1) {
      augmented[column][index] /= divisor;
    }
    for (let row = 0; row < SURFACE_FEATURES; row += 1) {
      if (row === column) continue;
      const multiplier = augmented[row][column];
      if (Math.abs(multiplier) < 1e-12) continue;
      for (let index = column; index <= SURFACE_FEATURES; index += 1) {
        augmented[row][index] -= augmented[column][index] * multiplier;
      }
    }
  }
  return augmented.map((row) => row[SURFACE_FEATURES]);
}

function fitSurfaceChannel(
  samples: readonly SurfaceSample[],
  width: number,
  height: number,
  channel: "red" | "green" | "blue",
  weights?: readonly number[]
) {
  const matrix = Array.from({ length: SURFACE_FEATURES }, () => (
    new Array<number>(SURFACE_FEATURES).fill(0)
  ));
  const vector = new Array<number>(SURFACE_FEATURES).fill(0);
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const features = surfaceFeatures(sample.x, sample.y, width, height);
    const weight = weights?.[sampleIndex] ?? 1;
    for (let row = 0; row < SURFACE_FEATURES; row += 1) {
      vector[row] += features[row] * sample[channel] * weight;
      for (let column = 0; column < SURFACE_FEATURES; column += 1) {
        matrix[row][column] += features[row] * features[column] * weight;
      }
    }
  }
  // A small ridge keeps thin rings and widely separated mask gaps numerically stable.
  for (let index = 0; index < SURFACE_FEATURES; index += 1) {
    matrix[index][index] += index === 0 ? 1e-6 : 1e-4;
  }
  return solveLinearSystem(matrix, vector);
}

function predictSurfaceChannel(
  coefficients: readonly number[],
  x: number,
  y: number,
  width: number,
  height: number
) {
  const features = surfaceFeatures(x, y, width, height);
  let value = 0;
  for (let index = 0; index < SURFACE_FEATURES; index += 1) {
    value += coefficients[index] * features[index];
  }
  return value;
}

function predictSurface(
  model: RepairSurfaceModel,
  x: number,
  y: number,
  width: number,
  height: number
) {
  return [
    predictSurfaceChannel(model.red, x, y, width, height),
    predictSurfaceChannel(model.green, x, y, width, height),
    predictSurfaceChannel(model.blue, x, y, width, height)
  ] as const;
}

function fitSurfaceModel(
  samples: readonly SurfaceSample[],
  width: number,
  height: number,
  weights?: readonly number[]
): RepairSurfaceModel | null {
  if (samples.length < SURFACE_FEATURES * 2) return null;
  const red = fitSurfaceChannel(samples, width, height, "red", weights);
  const green = fitSurfaceChannel(samples, width, height, "green", weights);
  const blue = fitSurfaceChannel(samples, width, height, "blue", weights);
  return red && green && blue ? { red, green, blue } : null;
}

function surfaceResidual(
  sample: SurfaceSample,
  model: RepairSurfaceModel,
  width: number,
  height: number
) {
  const predicted = predictSurface(model, sample.x, sample.y, width, height);
  return Math.sqrt(
    ((sample.red - predicted[0]) ** 2 +
      (sample.green - predicted[1]) ** 2 +
      (sample.blue - predicted[2]) ** 2) / 3
  );
}

function knownPixel(
  pixel: number,
  alpha: Uint8Array,
  repairMask: Uint8Array,
  threshold: number
) {
  return alpha[pixel] >= threshold && repairMask[pixel] <= 0;
}

function pixelGradient(
  rgba: Uint8ClampedArray,
  alpha: Uint8Array,
  repairMask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  threshold: number
) {
  if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) return null;
  const pixel = y * width + x;
  const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
  if (neighbors.some((neighbor) => !knownPixel(neighbor, alpha, repairMask, threshold))) return null;
  const offset = pixel * 4;
  const leftOffset = offset - 4;
  const rightOffset = offset + 4;
  const upOffset = offset - width * 4;
  const downOffset = offset + width * 4;
  return (
    Math.abs(rgba[rightOffset] - rgba[leftOffset]) +
    Math.abs(rgba[rightOffset + 1] - rgba[leftOffset + 1]) +
    Math.abs(rgba[rightOffset + 2] - rgba[leftOffset + 2]) +
    Math.abs(rgba[downOffset] - rgba[upOffset]) +
    Math.abs(rgba[downOffset + 1] - rgba[upOffset + 1]) +
    Math.abs(rgba[downOffset + 2] - rgba[upOffset + 2])
  ) / 6;
}

function repairSampleBounds(repairMask: Uint8Array, width: number, height: number) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let pixel = 0; pixel < repairMask.length; pixel += 1) {
    if (repairMask[pixel] <= 0) continue;
    const x = pixel % width;
    const y = (pixel - x) / width;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (right < 0) return { left: 0, top: 0, right: width - 1, bottom: height - 1 };
  const band = clamp(Math.round(Math.max(width, height) / 16), 3, 96);
  return {
    left: Math.max(0, left - band),
    top: Math.max(0, top - band),
    right: Math.min(width - 1, right + band),
    bottom: Math.min(height - 1, bottom + band)
  };
}

function sampleSpatialCoverage(
  samples: readonly SurfaceSample[],
  bounds: ReturnType<typeof repairSampleBounds>
) {
  const columns = 4;
  const rows = 4;
  const occupied = new Uint8Array(columns * rows);
  const regionWidth = Math.max(1, bounds.right - bounds.left + 1);
  const regionHeight = Math.max(1, bounds.bottom - bounds.top + 1);
  for (const sample of samples) {
    const column = clamp(
      Math.floor((sample.x - bounds.left) / regionWidth * columns),
      0,
      columns - 1
    );
    const row = clamp(
      Math.floor((sample.y - bounds.top) / regionHeight * rows),
      0,
      rows - 1
    );
    occupied[row * columns + column] = 1;
  }
  return occupied.reduce((count, value) => count + value, 0) / occupied.length;
}

export function analyzeRepairSurface(
  rgba: Uint8ClampedArray,
  alpha: Uint8Array,
  repairMask: Uint8Array,
  width: number,
  height: number,
  fillColor: readonly [number, number, number],
  threshold = 16
): RepairSurfaceAnalysis {
  if (
    rgba.length !== width * height * 4 ||
    alpha.length !== width * height ||
    repairMask.length !== width * height
  ) {
    throw new Error("背景曲面分析尺寸不匹配。");
  }
  const bounds = repairSampleBounds(repairMask, width, height);
  const regionPixels = (bounds.right - bounds.left + 1) * (bounds.bottom - bounds.top + 1);
  const stride = Math.max(1, Math.ceil(Math.sqrt(regionPixels / MAX_SURFACE_SAMPLES)));
  const samples: SurfaceSample[] = [];
  let knownSamples = 0;
  for (let y = bounds.top; y <= bounds.bottom; y += stride) {
    for (let x = bounds.left; x <= bounds.right; x += stride) {
      const pixel = y * width + x;
      if (!knownPixel(pixel, alpha, repairMask, threshold)) continue;
      knownSamples += 1;
      const offset = pixel * 4;
      if (
        Math.abs(rgba[offset] - fillColor[0]) > MAX_COMPATIBLE_COLOR_DELTA ||
        Math.abs(rgba[offset + 1] - fillColor[1]) > MAX_COMPATIBLE_COLOR_DELTA ||
        Math.abs(rgba[offset + 2] - fillColor[2]) > MAX_COMPATIBLE_COLOR_DELTA
      ) continue;
      samples.push({
        x,
        y,
        red: rgba[offset],
        green: rgba[offset + 1],
        blue: rgba[offset + 2],
        gradient: pixelGradient(rgba, alpha, repairMask, width, height, x, y, threshold)
      });
    }
  }
  const empty = {
    model: null,
    sampleCount: samples.length,
    compatibleSampleRatio: samples.length / Math.max(1, knownSamples),
    spatialCoverage: sampleSpatialCoverage(samples, bounds),
    fitError: Number.POSITIVE_INFINITY,
    meanGradient: Number.POSITIVE_INFINITY,
    strongGradientRatio: 1
  } satisfies RepairSurfaceAnalysis;
  const seedSamples = samples.filter((sample) => (
    Math.abs(sample.red - fillColor[0]) <= 36 &&
    Math.abs(sample.green - fillColor[1]) <= 36 &&
    Math.abs(sample.blue - fillColor[2]) <= 36
  ));
  const strictSeedSamples = seedSamples.filter((sample) => (
    Math.abs(sample.red - fillColor[0]) <= 18 &&
    Math.abs(sample.green - fillColor[1]) <= 18 &&
    Math.abs(sample.blue - fillColor[2]) <= 18
  ));
  const strictSeedCoverage = sampleSpatialCoverage(strictSeedSamples, bounds);
  const seedCoverage = sampleSpatialCoverage(seedSamples, bounds);
  const initialSamples = strictSeedSamples.length >= SURFACE_FEATURES * 2 && strictSeedCoverage >= 0.375
    ? strictSeedSamples
    : seedSamples.length >= SURFACE_FEATURES * 2 && seedCoverage >= 0.375
      ? seedSamples
      : samples;
  const initial = fitSurfaceModel(initialSamples, width, height);
  if (!initial) return empty;

  const firstInliers = samples.filter((sample) => (
    surfaceResidual(sample, initial, width, height) <= 12
  ));
  const refined = fitSurfaceModel(firstInliers, width, height) ?? initial;
  const inliers = samples.filter((sample) => (
    surfaceResidual(sample, refined, width, height) <= 12
  ));
  const model = fitSurfaceModel(inliers, width, height) ?? refined;
  if (inliers.length < SURFACE_FEATURES * 2) return empty;
  let squaredError = 0;
  let gradientSum = 0;
  let gradientSamples = 0;
  let strongGradients = 0;
  for (const sample of inliers) {
    const residual = Math.min(32, surfaceResidual(sample, model, width, height));
    squaredError += residual * residual;
    if (sample.gradient === null) continue;
    gradientSum += sample.gradient;
    if (sample.gradient >= STRONG_GRADIENT_THRESHOLD) strongGradients += 1;
    gradientSamples += 1;
  }
  return {
    model,
    sampleCount: inliers.length,
    compatibleSampleRatio: inliers.length / Math.max(1, knownSamples),
    spatialCoverage: sampleSpatialCoverage(inliers, bounds),
    fitError: Math.sqrt(squaredError / Math.max(1, inliers.length)),
    meanGradient: gradientSamples ? gradientSum / gradientSamples : 0,
    strongGradientRatio: gradientSamples ? strongGradients / gradientSamples : 0
  };
}

export function reconstructRepairSurface(
  rgba: Uint8ClampedArray,
  alpha: Uint8Array,
  repairMask: Uint8Array,
  width: number,
  height: number,
  model: RepairSurfaceModel,
  threshold = 16
) {
  if (
    rgba.length !== width * height * 4 ||
    alpha.length !== width * height ||
    repairMask.length !== width * height
  ) {
    throw new Error("背景曲面重建尺寸不匹配。");
  }
  const output = rgba.slice();
  for (let pixel = 0; pixel < repairMask.length; pixel += 1) {
    if (alpha[pixel] < threshold) continue;
    const x = pixel % width;
    const y = (pixel - x) / width;
    const predicted = predictSurface(model, x, y, width, height);
    const offset = pixel * 4;
    output[offset] = Math.round(clamp(predicted[0], 0, 255));
    output[offset + 1] = Math.round(clamp(predicted[1], 0, 255));
    output[offset + 2] = Math.round(clamp(predicted[2], 0, 255));
  }
  return output;
}

export function analyzeRepairBoundaryQuality(
  source: Uint8ClampedArray,
  repaired: Uint8ClampedArray,
  alpha: Uint8Array,
  repairMask: Uint8Array,
  width: number,
  height: number,
  threshold = 16
): RepairBoundaryQuality {
  if (
    source.length !== width * height * 4 ||
    repaired.length !== source.length ||
    alpha.length !== width * height ||
    repairMask.length !== width * height
  ) {
    throw new Error("背景修复接缝分析尺寸不匹配。");
  }
  let samples = 0;
  let errorSum = 0;
  let strongErrors = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      if (alpha[pixel] < threshold || repairMask[pixel] <= 0) continue;
      const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
      for (const neighbor of neighbors) {
        if (alpha[neighbor] < threshold || repairMask[neighbor] > 0) continue;
        const repairedOffset = pixel * 4;
        const sourceOffset = neighbor * 4;
        const normalizedMask = repairMask[pixel] / 255;
        const blendAlpha = repairMask[pixel] >= 254
          ? 1
          : normalizedMask * (2 - normalizedMask);
        const error = (
          Math.abs(
            source[repairedOffset] * (1 - blendAlpha) +
            repaired[repairedOffset] * blendAlpha -
            source[sourceOffset]
          ) +
          Math.abs(
            source[repairedOffset + 1] * (1 - blendAlpha) +
            repaired[repairedOffset + 1] * blendAlpha -
            source[sourceOffset + 1]
          ) +
          Math.abs(
            source[repairedOffset + 2] * (1 - blendAlpha) +
            repaired[repairedOffset + 2] * blendAlpha -
            source[sourceOffset + 2]
          )
        ) / 3;
        errorSum += error;
        if (error >= 18) strongErrors += 1;
        samples += 1;
      }
    }
  }
  return {
    sampleCount: samples,
    meanError: samples ? errorSum / samples : Number.POSITIVE_INFINITY,
    strongErrorRatio: samples ? strongErrors / samples : 1
  };
}
