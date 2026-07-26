function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export interface InterpolationAxis {
  lower: Uint32Array;
  upper: Uint32Array;
  weight: Float32Array;
}

export function createInterpolationAxis(
  targetSize: number,
  sourceSize: number,
  sourceOffset = 0
): InterpolationAxis {
  const lower = new Uint32Array(targetSize);
  const upper = new Uint32Array(targetSize);
  const weight = new Float32Array(targetSize);
  const scale = sourceSize / targetSize;

  for (let index = 0; index < targetSize; index += 1) {
    const sourceCoordinate = (index + 0.5) * scale - 0.5;
    const sourceLower = Math.floor(sourceCoordinate);
    lower[index] = sourceOffset + clamp(sourceLower, 0, sourceSize - 1);
    upper[index] = sourceOffset + clamp(sourceLower + 1, 0, sourceSize - 1);
    weight[index] = sourceCoordinate - sourceLower;
  }
  return { lower, upper, weight };
}

export function resampleAlphaPlane(
  source: Uint8Array,
  sourceStride: number,
  targetWidth: number,
  targetHeight: number,
  horizontal: InterpolationAxis,
  vertical: InterpolationAxis
): Uint8Array {
  const target = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const topRow = vertical.lower[y] * sourceStride;
    const bottomRow = vertical.upper[y] * sourceStride;
    const verticalWeight = vertical.weight[y];
    const targetRow = y * targetWidth;
    for (let x = 0; x < targetWidth; x += 1) {
      const left = horizontal.lower[x];
      const right = horizontal.upper[x];
      const horizontalWeight = horizontal.weight[x];
      const top =
        source[topRow + left] +
        (source[topRow + right] - source[topRow + left]) * horizontalWeight;
      const bottom =
        source[bottomRow + left] +
        (source[bottomRow + right] - source[bottomRow + left]) * horizontalWeight;
      target[targetRow + x] = Math.round(
        top + (bottom - top) * verticalWeight
      );
    }
  }
  return target;
}

const GUIDED_FILTER_RADIUS = 4;
const GUIDED_FILTER_EPSILON = 1e-4;

function boxSum(
  source: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  const horizontal = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x <= radius && x < width; x += 1) sum += source[row + x];
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum;
      const leaving = x - radius;
      const entering = x + radius + 1;
      if (leaving >= 0) sum -= source[row + leaving];
      if (entering < width) sum += source[row + entering];
    }
  }

  const output = new Float32Array(source.length);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y <= radius && y < height; y += 1) {
      sum += horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum;
      const leaving = y - radius;
      const entering = y + radius + 1;
      if (leaving >= 0) sum -= horizontal[leaving * width + x];
      if (entering < height) sum += horizontal[entering * width + x];
    }
  }
  return output;
}

function inverseWindowArea(width: number, height: number, radius: number): Float32Array {
  const countX = new Float32Array(width);
  for (let x = 0; x < width; x += 1) {
    countX[x] = Math.min(x + radius, width - 1) - Math.max(x - radius, 0) + 1;
  }
  const inverse = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const countY = Math.min(y + radius, height - 1) - Math.max(y - radius, 0) + 1;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      inverse[row + x] = 1 / (countX[x] * countY);
    }
  }
  return inverse;
}

export interface GuidedAlphaUpsampleOptions {
  /** 低分辨率引导图（RGBA），与 lowAlpha 同尺寸、同内容不同分辨率于 highRgba。 */
  lowRgba: Uint8ClampedArray;
  lowAlpha: Uint8Array;
  lowWidth: number;
  lowHeight: number;
  /** 原分辨率引导图（RGBA）。 */
  highRgba: Uint8ClampedArray;
  highWidth: number;
  highHeight: number;
}

/**
 * Fast Guided Filter（He et al. 2015）：在低分辨率上求解线性系数
 * alpha ≈ a·RGB + b，再把系数双线性放大后用原分辨率 RGB 重建 alpha，
 * 使上采样后的遮罩边缘贴合真实图像边缘而不是双线性的模糊过渡。
 */
export function guidedUpsampleAlpha(options: GuidedAlphaUpsampleOptions): Uint8Array {
  const { lowRgba, lowAlpha, lowWidth, lowHeight, highRgba, highWidth, highHeight } = options;
  const planeSize = lowWidth * lowHeight;
  if (lowRgba.length !== planeSize * 4 || lowAlpha.length !== planeSize) {
    throw new Error("导向滤波的低分辨率输入尺寸不匹配。");
  }
  if (highRgba.length !== highWidth * highHeight * 4) {
    throw new Error("导向滤波的引导图尺寸不匹配。");
  }

  const guideRed = new Float32Array(planeSize);
  const guideGreen = new Float32Array(planeSize);
  const guideBlue = new Float32Array(planeSize);
  const alpha = new Float32Array(planeSize);
  for (let index = 0; index < planeSize; index += 1) {
    const offset = index * 4;
    guideRed[index] = lowRgba[offset] / 255;
    guideGreen[index] = lowRgba[offset + 1] / 255;
    guideBlue[index] = lowRgba[offset + 2] / 255;
    alpha[index] = lowAlpha[index] / 255;
  }

  const radius = GUIDED_FILTER_RADIUS;
  const epsilon = GUIDED_FILTER_EPSILON;
  const inverseArea = inverseWindowArea(lowWidth, lowHeight, radius);
  const boxMean = (plane: Float32Array) => {
    const sums = boxSum(plane, lowWidth, lowHeight, radius);
    for (let index = 0; index < sums.length; index += 1) {
      sums[index] *= inverseArea[index];
    }
    return sums;
  };
  const multiply = (left: Float32Array, right: Float32Array) => {
    const product = new Float32Array(planeSize);
    for (let index = 0; index < planeSize; index += 1) {
      product[index] = left[index] * right[index];
    }
    return product;
  };

  const meanRed = boxMean(guideRed);
  const meanGreen = boxMean(guideGreen);
  const meanBlue = boxMean(guideBlue);
  const meanAlpha = boxMean(alpha);
  const meanRedAlpha = boxMean(multiply(guideRed, alpha));
  const meanGreenAlpha = boxMean(multiply(guideGreen, alpha));
  const meanBlueAlpha = boxMean(multiply(guideBlue, alpha));
  const meanRedRed = boxMean(multiply(guideRed, guideRed));
  const meanRedGreen = boxMean(multiply(guideRed, guideGreen));
  const meanRedBlue = boxMean(multiply(guideRed, guideBlue));
  const meanGreenGreen = boxMean(multiply(guideGreen, guideGreen));
  const meanGreenBlue = boxMean(multiply(guideGreen, guideBlue));
  const meanBlueBlue = boxMean(multiply(guideBlue, guideBlue));

  const coefficientRed = new Float32Array(planeSize);
  const coefficientGreen = new Float32Array(planeSize);
  const coefficientBlue = new Float32Array(planeSize);
  const coefficientBias = new Float32Array(planeSize);
  for (let index = 0; index < planeSize; index += 1) {
    const varRedRed = meanRedRed[index] - meanRed[index] * meanRed[index] + epsilon;
    const varRedGreen = meanRedGreen[index] - meanRed[index] * meanGreen[index];
    const varRedBlue = meanRedBlue[index] - meanRed[index] * meanBlue[index];
    const varGreenGreen =
      meanGreenGreen[index] - meanGreen[index] * meanGreen[index] + epsilon;
    const varGreenBlue = meanGreenBlue[index] - meanGreen[index] * meanBlue[index];
    const varBlueBlue = meanBlueBlue[index] - meanBlue[index] * meanBlue[index] + epsilon;
    const covRed = meanRedAlpha[index] - meanRed[index] * meanAlpha[index];
    const covGreen = meanGreenAlpha[index] - meanGreen[index] * meanAlpha[index];
    const covBlue = meanBlueAlpha[index] - meanBlue[index] * meanAlpha[index];

    const adjRedRed = varGreenGreen * varBlueBlue - varGreenBlue * varGreenBlue;
    const adjRedGreen = varRedBlue * varGreenBlue - varRedGreen * varBlueBlue;
    const adjRedBlue = varRedGreen * varGreenBlue - varRedBlue * varGreenGreen;
    const adjGreenGreen = varRedRed * varBlueBlue - varRedBlue * varRedBlue;
    const adjGreenBlue = varRedGreen * varRedBlue - varRedRed * varGreenBlue;
    const adjBlueBlue = varRedRed * varGreenGreen - varRedGreen * varRedGreen;
    const determinant =
      varRedRed * adjRedRed + varRedGreen * adjRedGreen + varRedBlue * adjRedBlue;

    if (Math.abs(determinant) < 1e-12) {
      coefficientBias[index] = meanAlpha[index];
      continue;
    }
    const red =
      (adjRedRed * covRed + adjRedGreen * covGreen + adjRedBlue * covBlue) / determinant;
    const green =
      (adjRedGreen * covRed + adjGreenGreen * covGreen + adjGreenBlue * covBlue) /
      determinant;
    const blue =
      (adjRedBlue * covRed + adjGreenBlue * covGreen + adjBlueBlue * covBlue) /
      determinant;
    coefficientRed[index] = red;
    coefficientGreen[index] = green;
    coefficientBlue[index] = blue;
    coefficientBias[index] =
      meanAlpha[index] -
      red * meanRed[index] -
      green * meanGreen[index] -
      blue * meanBlue[index];
  }

  const smoothRed = boxMean(coefficientRed);
  const smoothGreen = boxMean(coefficientGreen);
  const smoothBlue = boxMean(coefficientBlue);
  const smoothBias = boxMean(coefficientBias);

  const horizontal = createInterpolationAxis(highWidth, lowWidth);
  const vertical = createInterpolationAxis(highHeight, lowHeight);
  const output = new Uint8Array(highWidth * highHeight);
  for (let y = 0; y < highHeight; y += 1) {
    const topRow = vertical.lower[y] * lowWidth;
    const bottomRow = vertical.upper[y] * lowWidth;
    const verticalWeight = vertical.weight[y];
    const outputRow = y * highWidth;
    for (let x = 0; x < highWidth; x += 1) {
      const left = horizontal.lower[x];
      const right = horizontal.upper[x];
      const horizontalWeight = horizontal.weight[x];
      const sample = (plane: Float32Array) => {
        const top =
          plane[topRow + left] +
          (plane[topRow + right] - plane[topRow + left]) * horizontalWeight;
        const bottom =
          plane[bottomRow + left] +
          (plane[bottomRow + right] - plane[bottomRow + left]) * horizontalWeight;
        return top + (bottom - top) * verticalWeight;
      };
      const guideOffset = (outputRow + x) * 4;
      const value =
        sample(smoothRed) * (highRgba[guideOffset] / 255) +
        sample(smoothGreen) * (highRgba[guideOffset + 1] / 255) +
        sample(smoothBlue) * (highRgba[guideOffset + 2] / 255) +
        sample(smoothBias);
      output[outputRow + x] = Math.round(clamp(value, 0, 1) * 255);
    }
  }
  return output;
}
