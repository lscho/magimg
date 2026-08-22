const TRIMAP_FOREGROUND_THRESHOLD = 128;
const TRIMAP_DETAIL_THRESHOLD = 32;
const BORDER_COLOR_QUANTIZATION_SHIFT = 4;
const BORDER_COLOR_BIN_COUNT = 1 << 12;
const INITIAL_BACKGROUND_TOLERANCE = 12;
const MIN_BACKGROUND_BORDER_COVERAGE = 0.72;
const MIN_BACKGROUND_SIDE_COVERAGE = 0.6;
const MIN_BACKGROUND_SUPPORTED_SIDES = 3;
const MIN_BACKGROUND_ALPHA_SUPPORT = 0.72;
const SOLID_EDGE_MAX_BACKGROUND_DISTANCE = 64;
const SOLID_EDGE_FOREGROUND_SEARCH_RADIUS = 8;
const SOLID_EDGE_ALPHA_ALLOWANCE = 12;
const SOLID_EDGE_MAX_RECONSTRUCTION_ERROR = 16;

export interface SolidBorderBackground {
  red: number;
  green: number;
  blue: number;
  tolerance: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function colorBin(red: number, green: number, blue: number) {
  return (red >> BORDER_COLOR_QUANTIZATION_SHIFT) << 8 |
    (green >> BORDER_COLOR_QUANTIZATION_SHIFT) << 4 |
    blue >> BORDER_COLOR_QUANTIZATION_SHIFT;
}

function colorDistance(
  rgba: Uint8ClampedArray,
  pixel: number,
  background: Pick<SolidBorderBackground, "red" | "green" | "blue">
) {
  const offset = pixel * 4;
  return Math.max(
    Math.abs(rgba[offset] - background.red),
    Math.abs(rgba[offset + 1] - background.green),
    Math.abs(rgba[offset + 2] - background.blue)
  );
}

function visitBorderSide(
  width: number,
  height: number,
  band: number,
  side: "top" | "right" | "bottom" | "left",
  visitor: (pixel: number) => void
) {
  if (side === "top" || side === "bottom") {
    const startY = side === "top" ? 0 : height - band;
    for (let y = startY; y < startY + band; y += 1) {
      for (let x = 0; x < width; x += 1) visitor(y * width + x);
    }
    return;
  }
  const startX = side === "left" ? 0 : width - band;
  for (let y = 0; y < height; y += 1) {
    for (let x = startX; x < startX + band; x += 1) visitor(y * width + x);
  }
}

/** Returns a background color only when the refiner crop has a strongly uniform border. */
export function detectSolidBorderBackground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): SolidBorderBackground | null {
  if (width < 8 || height < 8 || rgba.length !== width * height * 4) return null;
  const band = clamp(Math.round(Math.min(width, height) / 64), 1, 3);
  const bins = new Uint32Array(BORDER_COLOR_BIN_COUNT);
  let opaqueSamples = 0;
  const sides = ["top", "right", "bottom", "left"] as const;

  for (const side of sides) {
    visitBorderSide(width, height, band, side, pixel => {
      const offset = pixel * 4;
      if (rgba[offset + 3] < 248) return;
      bins[colorBin(rgba[offset], rgba[offset + 1], rgba[offset + 2])] += 1;
      opaqueSamples += 1;
    });
  }
  if (!opaqueSamples) return null;

  let dominantBin = 0;
  for (let index = 1; index < bins.length; index += 1) {
    if (bins[index] > bins[dominantBin]) dominantBin = index;
  }
  if (bins[dominantBin] / opaqueSamples < MIN_BACKGROUND_SIDE_COVERAGE) return null;

  let red = 0;
  let green = 0;
  let blue = 0;
  let dominantSamples = 0;
  for (const side of sides) {
    visitBorderSide(width, height, band, side, pixel => {
      const offset = pixel * 4;
      if (rgba[offset + 3] < 248 ||
        colorBin(rgba[offset], rgba[offset + 1], rgba[offset + 2]) !== dominantBin) return;
      red += rgba[offset];
      green += rgba[offset + 1];
      blue += rgba[offset + 2];
      dominantSamples += 1;
    });
  }
  const background = {
    red: red / dominantSamples,
    green: green / dominantSamples,
    blue: blue / dominantSamples
  };

  let matchingSamples = 0;
  let squaredDifference = 0;
  let supportedSides = 0;
  for (const side of sides) {
    let sideOpaque = 0;
    let sideMatching = 0;
    visitBorderSide(width, height, band, side, pixel => {
      const offset = pixel * 4;
      if (rgba[offset + 3] < 248) return;
      sideOpaque += 1;
      const distance = colorDistance(rgba, pixel, background);
      if (distance > INITIAL_BACKGROUND_TOLERANCE) return;
      sideMatching += 1;
      matchingSamples += 1;
      squaredDifference += distance * distance;
    });
    if (sideOpaque && sideMatching / sideOpaque >= MIN_BACKGROUND_SIDE_COVERAGE) {
      supportedSides += 1;
    }
  }
  if (
    matchingSamples / opaqueSamples < MIN_BACKGROUND_BORDER_COVERAGE ||
    supportedSides < MIN_BACKGROUND_SUPPORTED_SIDES
  ) return null;

  const spread = Math.sqrt(squaredDifference / matchingSamples);
  return {
    ...background,
    tolerance: clamp(Math.ceil(spread * 3) + 2, 3, INITIAL_BACKGROUND_TOLERANCE)
  };
}

function morphBinaryMask(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  operation: "dilate" | "erode"
): Uint8Array {
  const diameter = radius * 2 + 1;
  const horizontal = new Uint8Array(source.length);
  const output = new Uint8Array(source.length);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x <= radius && x < width; x += 1) count += source[row + x];
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = operation === "dilate"
        ? Number(count > 0)
        : Number(count === diameter);
      const leaving = x - radius;
      const entering = x + radius + 1;
      if (leaving >= 0) count -= source[row + leaving];
      if (entering < width) count += source[row + entering];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y <= radius && y < height; y += 1) {
      count += horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = operation === "dilate"
        ? Number(count > 0)
        : Number(count === diameter);
      const leaving = y - radius;
      const entering = y + radius + 1;
      if (leaving >= 0) count -= horizontal[leaving * width + x];
      if (entering < height) count += horizontal[entering * width + x];
    }
  }
  return output;
}

function markExteriorBackground(
  dilatedForeground: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const exterior = new Uint8Array(dilatedForeground.length);
  const queue = new Uint32Array(dilatedForeground.length);
  let head = 0;
  let tail = 0;

  const enqueue = (index: number) => {
    if (dilatedForeground[index] || exterior[index]) return;
    exterior[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  return exterior;
}

function coarseAlphaSupportsBackground(
  alpha: Uint8Array,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  background: SolidBorderBackground
) {
  const band = clamp(Math.round(Math.min(width, height) / 64), 1, 3);
  let matchingPixels = 0;
  let backgroundPixels = 0;
  const sides = ["top", "right", "bottom", "left"] as const;
  for (const side of sides) {
    visitBorderSide(width, height, band, side, pixel => {
      if (rgba[pixel * 4 + 3] < 248 ||
        colorDistance(rgba, pixel, background) > background.tolerance) return;
      matchingPixels += 1;
      if (alpha[pixel] < TRIMAP_DETAIL_THRESHOLD) backgroundPixels += 1;
    });
  }
  return matchingPixels > 0 &&
    backgroundPixels / matchingPixels >= MIN_BACKGROUND_ALPHA_SUPPORT;
}

export function detectConfirmedSolidBackground(
  alpha: Uint8Array,
  rgba: Uint8ClampedArray,
  width: number,
  height: number
) {
  const detected = detectSolidBorderBackground(rgba, width, height);
  return detected && coarseAlphaSupportsBackground(
    alpha,
    rgba,
    width,
    height,
    detected
  ) ? detected : null;
}

function nearestDefiniteForeground(
  rgba: Uint8ClampedArray,
  trimap: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  background: SolidBorderBackground
) {
  for (let radius = 1; radius <= SOLID_EDGE_FOREGROUND_SEARCH_RADIUS; radius += 1) {
    const left = Math.max(0, x - radius);
    const right = Math.min(width - 1, x + radius);
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    let bestPixel = -1;
    let bestDistance = -1;
    for (let sampleY = top; sampleY <= bottom; sampleY += 1) {
      for (let sampleX = left; sampleX <= right; sampleX += 1) {
        if (
          sampleX !== left && sampleX !== right &&
          sampleY !== top && sampleY !== bottom
        ) continue;
        const pixel = sampleY * width + sampleX;
        if (trimap[pixel] !== 255) continue;
        const distance = colorDistance(rgba, pixel, background);
        if (distance > bestDistance) {
          bestPixel = pixel;
          bestDistance = distance;
        }
      }
    }
    if (bestPixel >= 0 && bestDistance > background.tolerance) return bestPixel;
  }
  return -1;
}

/** Conservatively caps unknown-band alpha using local foreground/background color mixing. */
export function refineSolidBackgroundEdgeAlpha(
  alpha: Uint8Array,
  alphaStride: number,
  rgba: Uint8ClampedArray,
  trimap: Uint8Array,
  width: number,
  height: number,
  background: SolidBorderBackground | null
) {
  if (!background) return;
  if (
    alpha.length < alphaStride * height ||
    alphaStride < width ||
    rgba.length !== width * height * 4 ||
    trimap.length !== width * height
  ) throw new Error("无法使用尺寸不匹配的数据清理纯色背景边缘。");

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const alphaIndex = y * alphaStride + x;
      if (
        trimap[pixel] !== 128 ||
        alpha[alphaIndex] <= 8 ||
        colorDistance(rgba, pixel, background) > SOLID_EDGE_MAX_BACKGROUND_DISTANCE
      ) continue;
      const foregroundPixel = nearestDefiniteForeground(
        rgba,
        trimap,
        width,
        height,
        x,
        y,
        background
      );
      if (foregroundPixel < 0) continue;

      const sourceOffset = pixel * 4;
      const foregroundOffset = foregroundPixel * 4;
      let numerator = 0;
      let denominator = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const foregroundDelta = rgba[foregroundOffset + channel] - background[
          channel === 0 ? "red" : channel === 1 ? "green" : "blue"
        ];
        const sourceDelta = rgba[sourceOffset + channel] - background[
          channel === 0 ? "red" : channel === 1 ? "green" : "blue"
        ];
        numerator += sourceDelta * foregroundDelta;
        denominator += foregroundDelta * foregroundDelta;
      }
      if (denominator < 64) continue;
      const estimatedAlpha = clamp(numerator / denominator, 0, 1);
      let reconstructionError = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const backgroundChannel = background[
          channel === 0 ? "red" : channel === 1 ? "green" : "blue"
        ];
        const reconstructed = backgroundChannel + estimatedAlpha *
          (rgba[foregroundOffset + channel] - backgroundChannel);
        reconstructionError = Math.max(
          reconstructionError,
          Math.abs(rgba[sourceOffset + channel] - reconstructed)
        );
      }
      if (reconstructionError > SOLID_EDGE_MAX_RECONSTRUCTION_ERROR) continue;
      const alphaLimit = Math.min(
        255,
        Math.round(estimatedAlpha * 255) + SOLID_EDGE_ALPHA_ALLOWANCE
      );
      alpha[alphaIndex] = Math.min(alpha[alphaIndex], alphaLimit);
    }
  }
}

export interface CutoutTrimapDetails {
  trimap: Uint8Array;
  solidBackground: SolidBorderBackground | null;
}

export function createCutoutTrimapDetails(
  alpha: Uint8Array,
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): CutoutTrimapDetails {
  if (alpha.length !== width * height || rgba.length !== width * height * 4) {
    throw new Error("无法从尺寸不匹配的图像和 Alpha 生成 trimap。");
  }
  const solidForeground = new Uint8Array(alpha.length);
  const faintForeground = new Uint8Array(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    solidForeground[index] = Number(alpha[index] >= TRIMAP_FOREGROUND_THRESHOLD);
    faintForeground[index] = Number(alpha[index] >= TRIMAP_DETAIL_THRESHOLD);
  }
  const longEdge = Math.max(width, height);
  const erodeRadius = clamp(Math.round(longEdge / 128), 4, 8);
  const dilateRadius = clamp(Math.round(longEdge / 32), 12, 32);
  const eroded = morphBinaryMask(solidForeground, width, height, erodeRadius, "erode");
  const dilated = morphBinaryMask(faintForeground, width, height, dilateRadius, "dilate");
  const exteriorBackground = markExteriorBackground(dilated, width, height);
  const borderBackground = detectConfirmedSolidBackground(alpha, rgba, width, height);
  const trimap = new Uint8Array(alpha.length);
  for (let index = 0; index < trimap.length; index += 1) {
    const sourceTransparent = rgba[index * 4 + 3] <= 8;
    const matchesSolidBackground = borderBackground !== null &&
      colorDistance(rgba, index, borderBackground) <= borderBackground.tolerance;
    trimap[index] = sourceTransparent || matchesSolidBackground
      ? 0
      : eroded[index]
        ? 255
        : exteriorBackground[index]
          ? 0
          : 128;
  }
  return { trimap, solidBackground: borderBackground };
}

export function createCutoutTrimap(
  alpha: Uint8Array,
  rgba: Uint8ClampedArray,
  width: number,
  height: number
) {
  return createCutoutTrimapDetails(alpha, rgba, width, height).trimap;
}
