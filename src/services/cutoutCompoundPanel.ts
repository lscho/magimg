import { cutoutSelectionBounds } from "@/services/cutoutGeometry";
import type { CutoutSelection } from "@/types";

const EDGE_DIFFERENCE_THRESHOLD = 40;
const SIDE_SEARCH_RATIO = 0.32;
const MIN_BORDER_SUPPORT_RATIO = 0.35;
const MIN_BORDER_PROMINENCE_RATIO = 0.2;
const OUTER_EDGE_PEAK_RATIO = 0.78;
const MIN_PANEL_SPAN_RATIO = 0.55;
const MIN_PANEL_SIZE = 48;
const MIN_CORNER_RADIUS_RATIO = 0.08;
const FALLBACK_CORNER_RADIUS_RATIO = 0.16;
const MAX_CORNER_RADIUS_RATIO = 0.28;

export interface CompoundPanelCornerRadii {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

export interface CompoundPanelDetection {
  alpha: Uint8Array;
  outerAlpha: Uint8Array;
  bounds: { x: number; y: number; width: number; height: number };
  cornerRadii: CompoundPanelCornerRadii;
}

export interface CompoundPanelGuidance {
  interiorAlpha: Uint8Array;
  outerAlpha: Uint8Array;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values: Uint32Array) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pixelDifference(rgba: Uint8ClampedArray, first: number, second: number) {
  const firstOffset = first * 4;
  const secondOffset = second * 4;
  return Math.max(
    Math.abs(rgba[firstOffset] - rgba[secondOffset]),
    Math.abs(rgba[firstOffset + 1] - rgba[secondOffset + 1]),
    Math.abs(rgba[firstOffset + 2] - rgba[secondOffset + 2])
  );
}

function edgeSupport(rgba: Uint8ClampedArray, width: number, height: number) {
  const vertical = new Uint32Array(Math.max(0, width - 1));
  const horizontal = new Uint32Array(Math.max(0, height - 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x + 1 < width; x += 1) {
      if (pixelDifference(rgba, row + x, row + x + 1) >= EDGE_DIFFERENCE_THRESHOLD) {
        vertical[x] += 1;
      }
    }
  }
  for (let y = 0; y + 1 < height; y += 1) {
    const row = y * width;
    const nextRow = row + width;
    for (let x = 0; x < width; x += 1) {
      if (pixelDifference(rgba, row + x, nextRow + x) >= EDGE_DIFFERENCE_THRESHOLD) {
        horizontal[y] += 1;
      }
    }
  }
  return { vertical, horizontal };
}

function outerSupportedEdge(
  support: Uint32Array,
  perpendicularLength: number,
  side: "start" | "end"
) {
  if (!support.length) return null;
  const searchLength = Math.max(1, Math.ceil(support.length * SIDE_SEARCH_RATIO));
  const start = side === "start" ? 0 : support.length - searchLength;
  const end = side === "start" ? searchLength : support.length;
  let peak = 0;
  for (let index = start; index < end; index += 1) peak = Math.max(peak, support[index]);
  const minimum = Math.max(
    perpendicularLength * MIN_BORDER_SUPPORT_RATIO,
    median(support) + perpendicularLength * MIN_BORDER_PROMINENCE_RATIO
  );
  if (peak < minimum) return null;
  const cutoff = Math.max(minimum, peak * OUTER_EDGE_PEAK_RATIO);
  if (side === "start") {
    for (let index = start; index < end; index += 1) {
      if (support[index] >= cutoff) return index;
    }
  } else {
    for (let index = end - 1; index >= start; index -= 1) {
      if (support[index] >= cutoff) return index;
    }
  }
  return null;
}

function outerSupportedHorizontalEdge(
  rgba: Uint8ClampedArray,
  width: number,
  support: Uint32Array,
  leftEdge: number,
  rightEdge: number,
  side: "start" | "end"
) {
  if (!support.length) return null;
  const searchLength = Math.max(1, Math.ceil(support.length * SIDE_SEARCH_RATIO));
  const start = side === "start" ? 0 : support.length - searchLength;
  const end = side === "start" ? searchLength : support.length;
  const insideSpan = rightEdge - leftEdge + 1;
  const outsideSpan = Math.max(0, width - insideSpan);
  const maximumOutsideSupport = Math.max(2, Math.ceil(outsideSpan * 0.5));
  const coherentSupport = new Uint32Array(support.length);
  let peak = 0;

  for (let y = start; y < end; y += 1) {
    let inside = 0;
    for (let x = leftEdge; x <= rightEdge; x += 1) {
      if (pixelDifference(rgba, y * width + x, (y + 1) * width + x) >= EDGE_DIFFERENCE_THRESHOLD) {
        inside += 1;
      }
    }
    const outside = support[y] - inside;
    if (outside > maximumOutsideSupport) continue;
    coherentSupport[y] = inside;
    peak = Math.max(peak, inside);
  }

  const minimum = Math.max(
    insideSpan * MIN_BORDER_SUPPORT_RATIO,
    median(support) + insideSpan * MIN_BORDER_PROMINENCE_RATIO
  );
  if (peak < minimum) return null;
  const cutoff = Math.max(minimum, peak * OUTER_EDGE_PEAK_RATIO);
  if (side === "start") {
    for (let index = start; index < end; index += 1) {
      if (coherentSupport[index] >= cutoff) return index;
    }
  } else {
    for (let index = end - 1; index >= start; index -= 1) {
      if (coherentSupport[index] >= cutoff) return index;
    }
  }
  return null;
}

function numericMedian(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function estimateCornerRadius(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
  verticalSide: "top" | "bottom",
  horizontalSide: "left" | "right"
) {
  const leftEdge = bounds.x - 1;
  const rightEdge = bounds.x + bounds.width - 1;
  const topEdge = bounds.y - 1;
  const bottomEdge = bounds.y + bounds.height - 1;
  const minimumSpan = Math.min(bounds.width, bounds.height);
  const minimumRadius = clamp(
    Math.round(minimumSpan * MIN_CORNER_RADIUS_RATIO),
    4,
    Math.floor(minimumSpan / 2)
  );
  const maximumRadius = Math.max(
    minimumRadius,
    Math.min(
      Math.floor(bounds.width / 3),
      Math.floor(bounds.height / 3),
      Math.round(minimumSpan * MAX_CORNER_RADIUS_RATIO)
    )
  );
  const samples: number[] = [];

  for (let depth = 1; depth <= maximumRadius; depth += 1) {
    const y = verticalSide === "top" ? topEdge + depth : bottomEdge - depth;
    if (y < 0 || y >= height) continue;

    let edge: number | null = null;
    if (horizontalSide === "left") {
      const start = Math.max(0, leftEdge - 2);
      const end = Math.min(width - 2, leftEdge + maximumRadius);
      for (let x = start; x <= end; x += 1) {
        if (pixelDifference(rgba, y * width + x, y * width + x + 1) < EDGE_DIFFERENCE_THRESHOLD) {
          continue;
        }
        edge = x;
        break;
      }
    } else {
      const start = Math.min(width - 2, rightEdge + 2);
      const end = Math.max(0, rightEdge - maximumRadius);
      for (let x = start; x >= end; x -= 1) {
        if (pixelDifference(rgba, y * width + x, y * width + x + 1) < EDGE_DIFFERENCE_THRESHOLD) {
          continue;
        }
        edge = x;
        break;
      }
    }
    if (edge === null) continue;

    const horizontalDepth = horizontalSide === "left"
      ? edge - leftEdge
      : rightEdge - edge;
    if (horizontalDepth < 2 || horizontalDepth > maximumRadius) continue;

    // A rounded corner with radius r satisfies
    // (horizontalDepth - r)^2 + (depth - r)^2 = r^2.
    const radius = horizontalDepth
      + depth
      + Math.sqrt(2 * horizontalDepth * depth);
    if (radius >= minimumRadius * 0.75 && radius <= maximumRadius * 1.2) {
      samples.push(radius);
    }
  }

  const fallback = minimumSpan * FALLBACK_CORNER_RADIUS_RATIO;
  return clamp(
    Math.round(samples.length >= 3 ? numericMedian(samples) : fallback),
    minimumRadius,
    maximumRadius
  );
}

function detectCornerRadii(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number }
): CompoundPanelCornerRadii {
  return {
    topLeft: estimateCornerRadius(rgba, width, height, bounds, "top", "left"),
    topRight: estimateCornerRadius(rgba, width, height, bounds, "top", "right"),
    bottomLeft: estimateCornerRadius(rgba, width, height, bounds, "bottom", "left"),
    bottomRight: estimateCornerRadius(rgba, width, height, bounds, "bottom", "right")
  };
}

function insideRoundedCorner(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  radius: number
) {
  const safeRadius = Math.max(0, radius - 0.75);
  const dx = x + 0.5 - centerX;
  const dy = y + 0.5 - centerY;
  return dx * dx + dy * dy <= safeRadius * safeRadius;
}

function roundedRectangleAlpha(
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
  cornerRadii: CompoundPanelCornerRadii
) {
  const alpha = new Uint8Array(width * height);
  const inset = clamp(Math.round(Math.min(bounds.width, bounds.height) * 0.02), 3, 8);
  const left = bounds.x + inset;
  const top = bounds.y + inset;
  const right = bounds.x + bounds.width - inset;
  const bottom = bounds.y + bounds.height - inset;
  if (right <= left || bottom <= top) return alpha;
  const maximumRadius = Math.floor(Math.min(right - left, bottom - top) / 2);
  const radii = {
    topLeft: clamp(cornerRadii.topLeft - inset, 2, maximumRadius),
    topRight: clamp(cornerRadii.topRight - inset, 2, maximumRadius),
    bottomLeft: clamp(cornerRadii.bottomLeft - inset, 2, maximumRadius),
    bottomRight: clamp(cornerRadii.bottomRight - inset, 2, maximumRadius)
  };

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      let inside = true;
      if (x < left + radii.topLeft && y < top + radii.topLeft) {
        inside = insideRoundedCorner(
          x,
          y,
          left + radii.topLeft,
          top + radii.topLeft,
          radii.topLeft
        );
      } else if (x >= right - radii.topRight && y < top + radii.topRight) {
        inside = insideRoundedCorner(
          x,
          y,
          right - radii.topRight,
          top + radii.topRight,
          radii.topRight
        );
      } else if (x < left + radii.bottomLeft && y >= bottom - radii.bottomLeft) {
        inside = insideRoundedCorner(
          x,
          y,
          left + radii.bottomLeft,
          bottom - radii.bottomLeft,
          radii.bottomLeft
        );
      } else if (x >= right - radii.bottomRight && y >= bottom - radii.bottomRight) {
        inside = insideRoundedCorner(
          x,
          y,
          right - radii.bottomRight,
          bottom - radii.bottomRight,
          radii.bottomRight
        );
      }
      if (inside) alpha[y * width + x] = 255;
    }
  }
  return alpha;
}

function roundedRectangleOuterAlpha(
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
  cornerRadii: CompoundPanelCornerRadii
) {
  const alpha = new Uint8Array(width * height);
  // Keep antialiasing, outline, and a narrow outer glow while rejecting the
  // much larger adjacent-background components selected by SAM.
  const padding = 5;
  const left = Math.max(0, bounds.x - padding);
  const top = Math.max(0, bounds.y - padding);
  const right = Math.min(width, bounds.x + bounds.width + padding);
  const bottom = Math.min(height, bounds.y + bounds.height + padding);
  if (right <= left || bottom <= top) return alpha;
  const maximumRadius = Math.floor(Math.min(right - left, bottom - top) / 2);
  const radii = {
    topLeft: clamp(cornerRadii.topLeft + padding, 2, maximumRadius),
    topRight: clamp(cornerRadii.topRight + padding, 2, maximumRadius),
    bottomLeft: clamp(cornerRadii.bottomLeft + padding, 2, maximumRadius),
    bottomRight: clamp(cornerRadii.bottomRight + padding, 2, maximumRadius)
  };

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      let inside = true;
      if (x < left + radii.topLeft && y < top + radii.topLeft) {
        inside = insideRoundedCorner(x, y, left + radii.topLeft, top + radii.topLeft, radii.topLeft);
      } else if (x >= right - radii.topRight && y < top + radii.topRight) {
        inside = insideRoundedCorner(x, y, right - radii.topRight, top + radii.topRight, radii.topRight);
      } else if (x < left + radii.bottomLeft && y >= bottom - radii.bottomLeft) {
        inside = insideRoundedCorner(x, y, left + radii.bottomLeft, bottom - radii.bottomLeft, radii.bottomLeft);
      } else if (x >= right - radii.bottomRight && y >= bottom - radii.bottomRight) {
        inside = insideRoundedCorner(x, y, right - radii.bottomRight, bottom - radii.bottomRight, radii.bottomRight);
      }
      if (inside) alpha[y * width + x] = 255;
    }
  }
  return alpha;
}

/**
 * Detects a tightly selected UI panel from four prominent border bands. The returned
 * mask is deliberately inset so only the panel interior becomes certain foreground;
 * the visible outline and any protruding subject keep their model-produced soft alpha.
 */
export function detectCompoundPanelInterior(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): CompoundPanelDetection | null {
  if (
    width < MIN_PANEL_SIZE ||
    height < MIN_PANEL_SIZE ||
    rgba.length !== width * height * 4
  ) return null;

  const { vertical, horizontal } = edgeSupport(rgba, width, height);
  const leftEdge = outerSupportedEdge(vertical, height, "start");
  const rightEdge = outerSupportedEdge(vertical, height, "end");
  if (leftEdge === null || rightEdge === null) {
    return null;
  }
  const topEdge = outerSupportedHorizontalEdge(
    rgba,
    width,
    horizontal,
    leftEdge,
    rightEdge,
    "start"
  );
  const bottomEdge = outerSupportedHorizontalEdge(
    rgba,
    width,
    horizontal,
    leftEdge,
    rightEdge,
    "end"
  );
  if (topEdge === null || bottomEdge === null) return null;

  const bounds = {
    x: leftEdge + 1,
    y: topEdge + 1,
    width: rightEdge - leftEdge,
    height: bottomEdge - topEdge
  };
  if (
    bounds.width < width * MIN_PANEL_SPAN_RATIO ||
    bounds.height < height * MIN_PANEL_SPAN_RATIO
  ) return null;

  const cornerRadii = detectCornerRadii(rgba, width, height, bounds);
  return {
    alpha: roundedRectangleAlpha(width, height, bounds, cornerRadii),
    outerAlpha: roundedRectangleOuterAlpha(width, height, bounds, cornerRadii),
    bounds,
    cornerRadii
  };
}

export function createCompoundPanelGuidance(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  selection: CutoutSelection
) {
  if (selection.polygon?.length) return null;
  const bounds = cutoutSelectionBounds(imageWidth, imageHeight, selection);
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(
    image,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );
  const detection = detectCompoundPanelInterior(
    context.getImageData(0, 0, bounds.width, bounds.height).data,
    bounds.width,
    bounds.height
  );
  if (!detection) return null;

  const interiorAlpha = new Uint8Array(imageWidth * imageHeight);
  const outerAlpha = new Uint8Array(imageWidth * imageHeight);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceRow = y * bounds.width;
    const targetRow = (bounds.y + y) * imageWidth + bounds.x;
    interiorAlpha.set(detection.alpha.subarray(sourceRow, sourceRow + bounds.width), targetRow);
    outerAlpha.set(detection.outerAlpha.subarray(sourceRow, sourceRow + bounds.width), targetRow);
  }
  return { interiorAlpha, outerAlpha };
}

export function createCompoundPanelPrior(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  selection: CutoutSelection
) {
  return createCompoundPanelGuidance(image, imageWidth, imageHeight, selection)?.interiorAlpha ?? null;
}

export function applyOpaquePanelPrior(alpha: Uint8Array, prior: Uint8Array | null) {
  if (!prior) return alpha;
  if (alpha.length !== prior.length) {
    throw new Error("面板先验尺寸与抠图 Alpha 不匹配。");
  }
  const merged = alpha.slice();
  for (let index = 0; index < merged.length; index += 1) {
    if (prior[index]) merged[index] = 255;
  }
  return merged;
}

/** 智能分层的闭合 UI 卡片不得把外轮廓之外的相邻场景带入素材。 */
export function constrainAlphaToPanelOuter(alpha: Uint8Array, outerAlpha: Uint8Array | null) {
  if (!outerAlpha) return alpha;
  if (alpha.length !== outerAlpha.length) {
    throw new Error("面板外轮廓尺寸与抠图 Alpha 不匹配。");
  }
  const constrained = alpha.slice();
  for (let index = 0; index < constrained.length; index += 1) {
    if (!outerAlpha[index]) constrained[index] = 0;
  }
  return constrained;
}
