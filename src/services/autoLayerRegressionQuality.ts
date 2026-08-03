import type { AutoLayerDocument, AutoLayerItem, AutoLayerTextItem } from "@/components/auto-layer/types";
import type {
  AutoLayerDiagnostics,
  AutoLayerInferenceResult,
  AutoLayerMaterial
} from "@/composables/useCutoutInference";
import {
  highRecallChildMaskPadding,
  repairMaskRadius
} from "@/services/cutoutRepairMask";
import type { AutoLayerSelectionRecord, CutoutSelection, CutoutSelectionBox } from "@/types";

export interface AutoLayerRegressionCase {
  schemaVersion: 1;
  recordId: string;
  source: { name: string; width: number; height: number };
  selectionCount: number;
  materialCount: number;
  textCount: number;
  minimumMaterialSolidRatio: number;
  minimumMaterialBoundsRatio: number;
  candidateSelections: Array<{ selectionId: string; selectedCandidateIndex: number }>;
  expectedTexts: Array<{
    sourceSelectionId: string;
    text: string;
    fontWeight: number;
    minimumConfidence: number;
  }>;
  repairLayerIds: string[];
  topLevelSelectionIds: string[];
  cloud: {
    minimumMaskedMeanDifference: number;
    minimumForegroundMeanDifference: number;
    minimumForegroundChangedRatio: number;
  };
}

export interface AutoLayerQualityCheck {
  id: string;
  passed: boolean;
  detail: string;
  expected?: unknown;
  actual?: unknown;
}

export interface AutoLayerLocalQualityReport {
  stage: "local";
  passed: boolean;
  checks: AutoLayerQualityCheck[];
  materialAlpha: Array<{
    selectionId: string;
    name: string;
    width: number;
    height: number;
    nonZeroRatio: number;
    solidRatio: number;
    boundsWidthRatio: number;
    boundsHeightRatio: number;
  }>;
}

export interface AutoLayerCloudQualityReport {
  stage: "cloud";
  passed: boolean;
  checks: AutoLayerQualityCheck[];
  targets: Array<{
    id: string;
    maskedPixels: number;
    maskedMeanDifference: number;
    maskedChangedRatio: number;
    unmaskedMismatchPixels: number;
  }>;
  foregroundRemovals: Array<{
    targetId: string;
    foregroundId: string;
    kind: "material" | "text";
    pixels: number;
    meanDifference: number;
    changedRatio: number;
  }>;
}

interface LocalQualityOptions {
  caseValue: AutoLayerRegressionCase;
  record: AutoLayerSelectionRecord;
  output: AutoLayerInferenceResult;
  diagnostics: AutoLayerDiagnostics;
  imageWidth: number;
  imageHeight: number;
}

interface CloudQualityOptions {
  caseValue: AutoLayerRegressionCase;
  localDocument: AutoLayerDocument;
  completeDocument: AutoLayerDocument;
  diagnostics: AutoLayerDiagnostics;
  imageWidth: number;
  imageHeight: number;
}

function finiteNumber(value: unknown, minimum = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0);
}

export function parseAutoLayerRegressionCase(value: unknown): AutoLayerRegressionCase {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("自动分层回归用例格式无效。");
  }
  const input = value as Partial<AutoLayerRegressionCase>;
  const source = input.source;
  const cloud = input.cloud;
  if (input.schemaVersion !== 1 || typeof input.recordId !== "string" || !input.recordId ||
    !source || typeof source.name !== "string" || !source.name ||
    !finiteNumber(source.width, 1) || !finiteNumber(source.height, 1) ||
    !finiteNumber(input.selectionCount, 1) || !finiteNumber(input.materialCount, 1) ||
    !finiteNumber(input.textCount) || !finiteNumber(input.minimumMaterialSolidRatio) ||
    !finiteNumber(input.minimumMaterialBoundsRatio) ||
    !Array.isArray(input.candidateSelections) || !Array.isArray(input.expectedTexts) ||
    !stringArray(input.repairLayerIds) || !stringArray(input.topLevelSelectionIds) ||
    !cloud || !finiteNumber(cloud.minimumMaskedMeanDifference) ||
    !finiteNumber(cloud.minimumForegroundMeanDifference) ||
    !finiteNumber(cloud.minimumForegroundChangedRatio)) {
    throw new Error("自动分层回归用例字段不完整。");
  }
  return input as AutoLayerRegressionCase;
}

function sorted(values: readonly string[]) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameMembers(actual: readonly string[], expected: readonly string[]) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
}

function cropMaskToBox(
  mask: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  box: CutoutSelectionBox
) {
  if (mask.length !== imageWidth * imageHeight) throw new Error("云端质量检查蒙版尺寸无效。");
  const left = Math.max(0, Math.round(box.x));
  const top = Math.max(0, Math.round(box.y));
  const width = Math.max(1, Math.min(imageWidth - left, Math.round(box.width)));
  const height = Math.max(1, Math.min(imageHeight - top, Math.round(box.height)));
  const cropped = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (top + y) * imageWidth + left;
    cropped.set(mask.subarray(sourceStart, sourceStart + width), y * width);
  }
  return cropped;
}

function addCheck(
  checks: AutoLayerQualityCheck[],
  id: string,
  passed: boolean,
  detail: string,
  expected?: unknown,
  actual?: unknown
) {
  checks.push({ id, passed, detail, ...(expected === undefined ? {} : { expected }), ...(actual === undefined ? {} : { actual }) });
}

function pixelInsideBox(x: number, y: number, box: CutoutSelectionBox) {
  return x >= Math.floor(box.x) && x < Math.ceil(box.x + box.width) &&
    y >= Math.floor(box.y) && y < Math.ceil(box.y + box.height);
}

function pixelInsidePaddedBox(x: number, y: number, box: CutoutSelectionBox, padding: number) {
  return x >= Math.floor(box.x - padding) && x < Math.ceil(box.x + box.width + padding) &&
    y >= Math.floor(box.y - padding) && y < Math.ceil(box.y + box.height + padding);
}

function maskCoverage(source: Uint8Array, target: Uint8Array, threshold = 32) {
  let expected = 0;
  let covered = 0;
  for (let pixel = 0; pixel < source.length; pixel += 1) {
    if (source[pixel] < threshold) continue;
    expected += 1;
    if (target[pixel] > 0) covered += 1;
  }
  return { expected, covered, ratio: covered / Math.max(1, expected) };
}

function rectangleCoverage(mask: Uint8Array, imageWidth: number, imageHeight: number, box: CutoutSelectionBox) {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(imageWidth, Math.ceil(box.x + box.width));
  const bottom = Math.min(imageHeight, Math.ceil(box.y + box.height));
  let expected = 0;
  let covered = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      expected += 1;
      if (mask[y * imageWidth + x] > 0) covered += 1;
    }
  }
  return { expected, covered, ratio: covered / Math.max(1, expected) };
}

async function materialAlphaStats(material: AutoLayerMaterial) {
  const bitmap = await createImageBitmap(material.blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前设备无法检查自动分层素材透明度。");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonZero = 0;
    let solid = 0;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let pixel = 0; pixel < canvas.width * canvas.height; pixel += 1) {
      const alpha = pixels[pixel * 4 + 3];
      if (alpha > 8) {
        nonZero += 1;
        const x = pixel % canvas.width;
        const y = Math.floor(pixel / canvas.width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (alpha >= 128) solid += 1;
    }
    const pixelsCount = Math.max(1, canvas.width * canvas.height);
    return {
      selectionId: material.sourceSelectionId ?? material.id,
      name: material.name ?? material.id,
      width: canvas.width,
      height: canvas.height,
      nonZeroRatio: nonZero / pixelsCount,
      solidRatio: solid / pixelsCount,
      boundsWidthRatio: maxX < 0 ? 0 : (maxX - minX + 1) / canvas.width,
      boundsHeightRatio: maxY < 0 ? 0 : (maxY - minY + 1) / canvas.height
    };
  } finally {
    bitmap.close();
  }
}

async function decodeBlobRgba(blob: Blob, width: number, height: number) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前设备无法检查云端背景像素。");
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  } finally {
    bitmap.close();
  }
}

function pixelDifference(source: Uint8ClampedArray, target: Uint8ClampedArray, pixel: number) {
  const offset = pixel * 4;
  return (
    Math.abs(source[offset] - target[offset]) +
    Math.abs(source[offset + 1] - target[offset + 1]) +
    Math.abs(source[offset + 2] - target[offset + 2])
  ) / 3;
}

function compareMaskedTarget(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  mask: Uint8Array
) {
  if (source.length !== target.length || source.length !== mask.length * 4) {
    throw new Error("云端质量检查图像尺寸不一致。");
  }
  let maskedPixels = 0;
  let maskedDifference = 0;
  let maskedChanged = 0;
  let unmaskedMismatchPixels = 0;
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel] > 0) {
      const difference = pixelDifference(source, target, pixel);
      maskedPixels += 1;
      maskedDifference += difference;
      if (difference >= 12) maskedChanged += 1;
      continue;
    }
    const offset = pixel * 4;
    if (source[offset] !== target[offset] || source[offset + 1] !== target[offset + 1] ||
      source[offset + 2] !== target[offset + 2] || source[offset + 3] !== target[offset + 3]) {
      unmaskedMismatchPixels += 1;
    }
  }
  return {
    maskedPixels,
    maskedMeanDifference: maskedDifference / Math.max(1, maskedPixels),
    maskedChangedRatio: maskedChanged / Math.max(1, maskedPixels),
    unmaskedMismatchPixels
  };
}

function compareGlobalForeground(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  targetBox: CutoutSelectionBox,
  targetWidth: number,
  targetHeight: number,
  foregroundMask: Uint8Array,
  imageWidth: number,
  foregroundBox: CutoutSelectionBox
) {
  const targetLeft = Math.round(targetBox.x);
  const targetTop = Math.round(targetBox.y);
  const left = Math.max(targetLeft, Math.floor(foregroundBox.x));
  const top = Math.max(targetTop, Math.floor(foregroundBox.y));
  const right = Math.min(targetLeft + targetWidth, Math.ceil(foregroundBox.x + foregroundBox.width));
  const bottom = Math.min(targetTop + targetHeight, Math.ceil(foregroundBox.y + foregroundBox.height));
  let pixels = 0;
  let differenceTotal = 0;
  let changed = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (foregroundMask[y * imageWidth + x] < 128) continue;
      const targetPixel = (y - targetTop) * targetWidth + x - targetLeft;
      const difference = pixelDifference(source, target, targetPixel);
      pixels += 1;
      differenceTotal += difference;
      if (difference >= 12) changed += 1;
    }
  }
  return {
    pixels,
    meanDifference: differenceTotal / Math.max(1, pixels),
    changedRatio: changed / Math.max(1, pixels)
  };
}

async function compareTextForeground(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  targetBox: CutoutSelectionBox,
  targetWidth: number,
  targetHeight: number,
  layer: AutoLayerTextItem
) {
  const alpha = await decodeBlobRgba(layer.blob, layer.width, layer.height);
  const targetLeft = Math.round(targetBox.x);
  const targetTop = Math.round(targetBox.y);
  const textLeft = Math.round(layer.sourceBox.x);
  const textTop = Math.round(layer.sourceBox.y);
  let pixels = 0;
  let differenceTotal = 0;
  let changed = 0;
  for (let y = 0; y < layer.height; y += 1) {
    const targetY = textTop + y - targetTop;
    if (targetY < 0 || targetY >= targetHeight) continue;
    for (let x = 0; x < layer.width; x += 1) {
      if (alpha[(y * layer.width + x) * 4 + 3] < 128) continue;
      const targetX = textLeft + x - targetLeft;
      if (targetX < 0 || targetX >= targetWidth) continue;
      const targetPixel = targetY * targetWidth + targetX;
      const difference = pixelDifference(source, target, targetPixel);
      pixels += 1;
      differenceTotal += difference;
      if (difference >= 12) changed += 1;
    }
  }
  return {
    pixels,
    meanDifference: differenceTotal / Math.max(1, pixels),
    changedRatio: changed / Math.max(1, pixels)
  };
}

async function compareLayerForeground(
  parent: { blob: Blob; width: number; height: number; sourceBox: CutoutSelectionBox },
  foreground: { blob: Blob; width: number; height: number; sourceBox: CutoutSelectionBox }
) {
  const [parentPixels, foregroundPixels] = await Promise.all([
    decodeBlobRgba(parent.blob, parent.width, parent.height),
    decodeBlobRgba(foreground.blob, foreground.width, foreground.height)
  ]);
  const offsetX = Math.round(foreground.sourceBox.x - parent.sourceBox.x);
  const offsetY = Math.round(foreground.sourceBox.y - parent.sourceBox.y);
  let pixels = 0;
  let differenceTotal = 0;
  let changed = 0;
  for (let y = 0; y < foreground.height; y += 1) {
    const parentY = offsetY + y;
    if (parentY < 0 || parentY >= parent.height) continue;
    for (let x = 0; x < foreground.width; x += 1) {
      const foregroundOffset = (y * foreground.width + x) * 4;
      if (foregroundPixels[foregroundOffset + 3] < 128) continue;
      const parentX = offsetX + x;
      if (parentX < 0 || parentX >= parent.width) continue;
      const parentPixel = parentY * parent.width + parentX;
      const difference = (
        Math.abs(foregroundPixels[foregroundOffset] - parentPixels[parentPixel * 4]) +
        Math.abs(foregroundPixels[foregroundOffset + 1] - parentPixels[parentPixel * 4 + 1]) +
        Math.abs(foregroundPixels[foregroundOffset + 2] - parentPixels[parentPixel * 4 + 2])
      ) / 3;
      pixels += 1;
      differenceTotal += difference;
      if (difference >= 12) changed += 1;
    }
  }
  return {
    pixels,
    meanDifference: differenceTotal / Math.max(1, pixels),
    changedRatio: changed / Math.max(1, pixels)
  };
}

async function textAlphaCoverage(
  line: AutoLayerTextItem,
  mask: Uint8Array,
  imageWidth: number,
  imageHeight: number
) {
  const pixels = await decodeBlobRgba(line.blob, line.width, line.height);
  const left = Math.round(line.sourceBox.x);
  const top = Math.round(line.sourceBox.y);
  let expected = 0;
  let covered = 0;
  for (let y = 0; y < line.height; y += 1) {
    const targetY = top + y;
    if (targetY < 0 || targetY >= imageHeight) continue;
    for (let x = 0; x < line.width; x += 1) {
      if (pixels[(y * line.width + x) * 4 + 3] < 32) continue;
      const targetX = left + x;
      if (targetX < 0 || targetX >= imageWidth) continue;
      expected += 1;
      if (mask[targetY * imageWidth + targetX] > 0) covered += 1;
    }
  }
  return { expected, covered, ratio: covered / Math.max(1, expected) };
}

async function validateRepairMasks(options: LocalQualityOptions, checks: AutoLayerQualityCheck[]) {
  const { diagnostics, imageWidth, imageHeight } = options;
  const diagnosticBySelection = new Map(diagnostics.elements.map(item => [item.selection.id, item]));
  for (const region of diagnostics.repairRegions) {
    let outside = 0;
    let feathered = 0;
    for (let pixel = 0; pixel < region.mask.length; pixel += 1) {
      const alpha = region.mask[pixel];
      if (!alpha) continue;
      if (alpha < 255) feathered += 1;
      const x = pixel % imageWidth;
      const y = Math.floor(pixel / imageWidth);
      if (!pixelInsideBox(x, y, region.contentBox)) outside += 1;
    }
    addCheck(
      checks,
      `repair-mask-contained:${region.layerId}`,
      outside === 0,
      outside === 0 ? "父层修复蒙版未越过父选区。" : `父层修复蒙版有 ${outside} 个像素越界。`,
      0,
      outside
    );
    addCheck(
      checks,
      `repair-mask-feathered:${region.layerId}`,
      feathered > 0,
      feathered > 0
        ? `父层修复蒙版保留 ${feathered} 个羽化边缘像素。`
        : "父层修复蒙版被错误固化为硬边。",
      "> 0",
      feathered
    );

    const directChildren = diagnostics.selections.filter(selection => selection.parentId === region.layerId);
    for (const child of directChildren) {
      if (child.layerKind === "text") {
        const lines = options.output.texts.filter(line => line.sourceSelectionId === child.id);
        const coverages = lines.length
          ? await Promise.all(lines.map(line => textAlphaCoverage(line, region.mask, imageWidth, imageHeight)))
          : [rectangleCoverage(region.mask, imageWidth, imageHeight, child)];
        const ratio = Math.min(...coverages.map(item => item.ratio));
        addCheck(
          checks,
          `repair-covers-text:${region.layerId}:${child.id}`,
          ratio >= 0.98,
          `父层文字清除覆盖率 ${(ratio * 100).toFixed(2)}%。`,
          ">= 98%",
          ratio
        );
        continue;
      }
      const diagnostic = diagnosticBySelection.get(child.id);
      if (!diagnostic) continue;
      const coverage = maskCoverage(diagnostic.refinedAlpha, region.mask);
      addCheck(
        checks,
        `repair-covers-element:${region.layerId}:${child.id}`,
        coverage.ratio >= 0.95,
        `父层元素清除覆盖率 ${(coverage.ratio * 100).toFixed(2)}%。`,
        ">= 95%",
        coverage.ratio
      );
    }
  }
}

async function validateLocalParentRepairs(options: LocalQualityOptions, checks: AutoLayerQualityCheck[]) {
  const materialBySelection = new Map(options.output.materials.map(material => [
    material.sourceSelectionId ?? material.id,
    material
  ]));
  for (const region of options.diagnostics.repairRegions) {
    const parent = materialBySelection.get(region.layerId);
    if (!parent) {
      addCheck(checks, `local-parent:${region.layerId}`, false, "本地结果缺少父素材。", "material", null);
      continue;
    }
    const directChildren = options.diagnostics.selections.filter(selection => selection.parentId === region.layerId);
    const foregrounds = directChildren.flatMap(child => child.layerKind === "text"
      ? options.output.texts.filter(line => line.sourceSelectionId === child.id)
      : [materialBySelection.get(child.id)].filter((item): item is NonNullable<typeof item> => Boolean(item))
    );
    for (const foreground of foregrounds) {
      const metrics = await compareLayerForeground(parent, foreground);
      const passed = metrics.pixels > 0 &&
        metrics.meanDifference >= options.caseValue.cloud.minimumForegroundMeanDifference &&
        metrics.changedRatio >= options.caseValue.cloud.minimumForegroundChangedRatio;
      addCheck(
        checks,
        `local-child-removed:${region.layerId}:${foreground.id}`,
        passed,
        `父素材内的直接子层平均变化 ${metrics.meanDifference.toFixed(2)}，变化像素占比 ` +
          `${(metrics.changedRatio * 100).toFixed(2)}%。`,
        {
          pixels: "> 0",
          meanDifference: `>= ${options.caseValue.cloud.minimumForegroundMeanDifference}`,
          changedRatio: `>= ${options.caseValue.cloud.minimumForegroundChangedRatio}`
        },
        metrics
      );
    }
  }
}

function validateBackgroundMask(options: LocalQualityOptions, checks: AutoLayerQualityCheck[]) {
  const { diagnostics, caseValue, imageWidth } = options;
  const topLevel = diagnostics.selections.filter(selection => !selection.parentId);
  let outside = 0;
  for (let pixel = 0; pixel < diagnostics.backgroundMask.length; pixel += 1) {
    if (!diagnostics.backgroundMask[pixel]) continue;
    const x = pixel % imageWidth;
    const y = Math.floor(pixel / imageWidth);
    if (!topLevel.some(selection => pixelInsidePaddedBox(
      x,
      y,
      selection,
      selection.layerKind === "text"
        ? repairMaskRadius(options.imageWidth, options.imageHeight) + 10
        : highRecallChildMaskPadding(selection) + repairMaskRadius(options.imageWidth, options.imageHeight)
    ))) outside += 1;
  }
  addCheck(
    checks,
    "background-mask-contained",
    outside === 0,
    outside === 0 ? "整页修复蒙版只覆盖顶层选区及其阴影扩张范围。" :
      `整页修复蒙版有 ${outside} 个像素越过允许的阴影扩张范围。`,
    0,
    outside
  );
  addCheck(
    checks,
    "top-level-selection-ids",
    sameMembers(topLevel.map(item => item.id), caseValue.topLevelSelectionIds),
    "顶层选区与用例一致。",
    sorted(caseValue.topLevelSelectionIds),
    sorted(topLevel.map(item => item.id))
  );
  const diagnosticBySelection = new Map(diagnostics.elements.map(item => [item.selection.id, item]));
  for (const selection of topLevel) {
    if (selection.layerKind === "text") {
      const coverage = rectangleCoverage(diagnostics.backgroundMask, options.imageWidth, options.imageHeight, selection);
      addCheck(checks, `background-covers:${selection.id}`, coverage.ratio >= 0.98,
        `顶层文字覆盖率 ${(coverage.ratio * 100).toFixed(2)}%。`, ">= 98%", coverage.ratio);
      continue;
    }
    const diagnostic = diagnosticBySelection.get(selection.id);
    if (!diagnostic) continue;
    const coverage = maskCoverage(diagnostic.refinedAlpha, diagnostics.backgroundMask);
    addCheck(checks, `background-covers:${selection.id}`, coverage.ratio >= 0.95,
      `顶层元素覆盖率 ${(coverage.ratio * 100).toFixed(2)}%。`, ">= 95%", coverage.ratio);
  }
}

export async function evaluateLocalAutoLayerQuality(
  options: LocalQualityOptions
): Promise<AutoLayerLocalQualityReport> {
  const { caseValue, record, output, diagnostics, imageWidth, imageHeight } = options;
  const checks: AutoLayerQualityCheck[] = [];
  addCheck(checks, "record-id", record.id === caseValue.recordId, "选区记录 ID 与用例一致。", caseValue.recordId, record.id);
  addCheck(checks, "source", record.sourceName === caseValue.source.name && imageWidth === caseValue.source.width &&
    imageHeight === caseValue.source.height, "原图名称和尺寸与用例一致。", caseValue.source,
  { name: record.sourceName, width: imageWidth, height: imageHeight });
  addCheck(checks, "selection-count", record.selections.length === caseValue.selectionCount,
    `识别到 ${record.selections.length} 个选区。`, caseValue.selectionCount, record.selections.length);
  addCheck(checks, "material-count", output.materials.length === caseValue.materialCount,
    `生成 ${output.materials.length} 个素材层。`, caseValue.materialCount, output.materials.length);
  addCheck(checks, "text-count", output.texts.length === caseValue.textCount,
    `生成 ${output.texts.length} 个文字层。`, caseValue.textCount, output.texts.length);

  const elementSelectionIds = diagnostics.selections
    .filter(selection => selection.layerKind !== "text")
    .map(selection => selection.id);
  addCheck(checks, "material-selection-coverage", sameMembers(
    output.materials.map(material => material.sourceSelectionId ?? material.id),
    elementSelectionIds
  ), "每个元素选区恰好生成一个素材。", sorted(elementSelectionIds),
  sorted(output.materials.map(material => material.sourceSelectionId ?? material.id)));

  const materialAlpha = await Promise.all(output.materials.map(materialAlphaStats));
  for (const stats of materialAlpha) {
    addCheck(checks, `material-solid:${stats.selectionId}`,
      stats.solidRatio >= caseValue.minimumMaterialSolidRatio,
      `${stats.name} 实心 Alpha 占比 ${(stats.solidRatio * 100).toFixed(2)}%。`,
      `>= ${caseValue.minimumMaterialSolidRatio}`, stats.solidRatio);
    addCheck(checks, `material-bounds:${stats.selectionId}`,
      stats.boundsWidthRatio >= caseValue.minimumMaterialBoundsRatio &&
      stats.boundsHeightRatio >= caseValue.minimumMaterialBoundsRatio,
      `${stats.name} 的有效边界为 ${(stats.boundsWidthRatio * 100).toFixed(1)}% x ${(stats.boundsHeightRatio * 100).toFixed(1)}%。`,
      `>= ${caseValue.minimumMaterialBoundsRatio}`, {
        width: stats.boundsWidthRatio,
        height: stats.boundsHeightRatio
      });
  }

  const elementDiagnostics = new Map(diagnostics.elements.map(item => [item.selection.id, item]));
  for (const assertion of caseValue.candidateSelections) {
    const actual = elementDiagnostics.get(assertion.selectionId)?.selectedCandidateIndex;
    addCheck(checks, `candidate:${assertion.selectionId}`,
      actual === assertion.selectedCandidateIndex,
      `关键素材使用候选 ${actual ?? "缺失"}。`, assertion.selectedCandidateIndex, actual);
  }

  for (const expected of caseValue.expectedTexts) {
    const matches = output.texts.filter(line => line.sourceSelectionId === expected.sourceSelectionId);
    const actual = matches[0];
    addCheck(checks, `text-count:${expected.sourceSelectionId}`, matches.length === 1,
      `文字选区生成 ${matches.length} 行。`, 1, matches.length);
    addCheck(checks, `text-content:${expected.sourceSelectionId}`, actual?.text === expected.text,
      `文字识别结果为“${actual?.text ?? ""}”。`, expected.text, actual?.text);
    addCheck(checks, `text-weight:${expected.sourceSelectionId}`, actual?.fontWeight === expected.fontWeight,
      `文字字重为 ${actual?.fontWeight ?? "缺失"}。`, expected.fontWeight, actual?.fontWeight);
    addCheck(checks, `text-confidence:${expected.sourceSelectionId}`,
      Boolean(actual && actual.ocrConfidence >= expected.minimumConfidence),
      `文字置信度 ${actual?.ocrConfidence.toFixed(4) ?? "缺失"}。`,
      `>= ${expected.minimumConfidence}`, actual?.ocrConfidence);
  }

  const allNames = [...output.materials.map(item => item.name ?? ""), ...output.texts.map(item => item.name)];
  addCheck(checks, "layer-names", allNames.every(name => /^[a-z]+(?:-[a-z0-9]+)*$/u.test(name)) &&
    new Set(allNames).size === allNames.length, "图层名称均为唯一英文 kebab-case。", "unique kebab-case", allNames);
  addCheck(checks, "repair-layer-ids", sameMembers(
    diagnostics.repairRegions.map(region => region.layerId),
    caseValue.repairLayerIds
  ), "父层修复区域与用例一致。", sorted(caseValue.repairLayerIds),
  sorted(diagnostics.repairRegions.map(region => region.layerId)));
  const atlasMaterialIds = output.cloudAtlas.tiles
    .filter(tile => tile.kind === "material" && tile.layerId)
    .map(tile => tile.layerId!);
  const sourceMaskMaterialIds = output.cloudAtlas.sourceMasks
    .filter(mask => mask.kind === "material" && mask.layerId)
    .map(mask => mask.layerId!);
  addCheck(checks, "atlas-tiles", output.cloudAtlas.tiles.filter(tile => tile.kind === "background").length === 1 &&
    sameMembers(atlasMaterialIds, caseValue.repairLayerIds),
  "单张云图集包含整页背景与全部父素材修复区。",
  ["background", ...sorted(caseValue.repairLayerIds)],
  output.cloudAtlas.tiles.map(tile => tile.kind === "background" ? "background" : tile.layerId));
  addCheck(checks, "atlas-source-masks",
    output.cloudAtlas.sourceMasks.filter(mask => mask.kind === "background").length === 1 &&
    sameMembers(sourceMaskMaterialIds, caseValue.repairLayerIds),
  "云图集保留整页与全部父素材的原始分辨率蒙版。",
  ["background", ...sorted(caseValue.repairLayerIds)],
  output.cloudAtlas.sourceMasks.map(mask => mask.kind === "background" ? "background" : mask.layerId));

  await validateRepairMasks(options, checks);
  await validateLocalParentRepairs(options, checks);
  validateBackgroundMask(options, checks);
  return { stage: "local", passed: checks.every(check => check.passed), checks, materialAlpha };
}

export async function evaluateCloudAutoLayerQuality(
  options: CloudQualityOptions
): Promise<AutoLayerCloudQualityReport> {
  const { caseValue, localDocument, completeDocument, diagnostics, imageWidth, imageHeight } = options;
  const checks: AutoLayerQualityCheck[] = [];
  const targets: AutoLayerCloudQualityReport["targets"] = [];
  const foregroundRemovals: AutoLayerCloudQualityReport["foregroundRemovals"] = [];
  const elementDiagnostics = new Map(diagnostics.elements.map(item => [item.selection.id, item]));
  const localTexts = textLayers(localDocument);
  const completeLayers = new Map(completeDocument.layers.map(layer => [layer.id, layer]));
  const repairLayerIds = new Set(diagnostics.repairRegions.map(region => region.layerId));
  const layersScoped = localDocument.layers.length === completeDocument.layers.length &&
    localDocument.layers.every(layer => {
      const complete = completeLayers.get(layer.id);
      return Boolean(complete && complete.kind === layer.kind &&
        complete.x === layer.x && complete.y === layer.y &&
        complete.width === layer.width && complete.height === layer.height &&
        (repairLayerIds.has(layer.id) ? complete.blob !== layer.blob : complete.blob === layer.blob));
    });
  addCheck(checks, "cloud-layer-scope", layersScoped,
    "云端任务只替换整页背景和包含直接子层的父素材。", true, layersScoped);

  const targetInputs: Array<{
    id: string;
    box: CutoutSelectionBox;
    sourceBlob: Blob;
    targetBlob: Blob;
    mask: Uint8Array;
    foregrounds: CutoutSelection[];
  }> = [{
    id: "background",
    box: { id: "background", x: 0, y: 0, width: imageWidth, height: imageHeight },
    sourceBlob: localDocument.backgroundBlob,
    targetBlob: completeDocument.backgroundBlob,
    mask: diagnostics.backgroundMask,
    foregrounds: diagnostics.selections.filter(selection => !selection.parentId)
  }];

  for (const region of diagnostics.repairRegions) {
    const sourceLayer = localDocument.layers.find(layer => layer.id === region.layerId);
    const targetLayer = completeDocument.layers.find(layer => layer.id === region.layerId);
    if (!sourceLayer || sourceLayer.kind !== "material" || !targetLayer || targetLayer.kind !== "material") continue;
    targetInputs.push({
      id: `material:${region.layerId}`,
      box: region.contentBox,
      sourceBlob: sourceLayer.blob,
      targetBlob: targetLayer.blob,
      mask: cropMaskToBox(region.mask, imageWidth, imageHeight, region.contentBox),
      foregrounds: diagnostics.selections.filter(selection => selection.parentId === region.layerId)
    });
  }

  for (const targetInput of targetInputs) {
    const width = Math.round(targetInput.box.width);
    const height = Math.round(targetInput.box.height);
    const [sourcePixels, targetPixels] = await Promise.all([
      decodeBlobRgba(targetInput.sourceBlob, width, height),
      decodeBlobRgba(targetInput.targetBlob, width, height)
    ]);
    const targetMetrics = compareMaskedTarget(sourcePixels, targetPixels, targetInput.mask);
    targets.push({ id: targetInput.id, ...targetMetrics });
    addCheck(checks, `cloud-unmasked-exact:${targetInput.id}`,
      targetMetrics.unmaskedMismatchPixels === 0,
      targetMetrics.unmaskedMismatchPixels === 0
        ? "蒙版外像素与原始素材完全一致。"
        : `蒙版外有 ${targetMetrics.unmaskedMismatchPixels} 个像素被改变。`,
      0, targetMetrics.unmaskedMismatchPixels);
    addCheck(checks, `cloud-mask-changed:${targetInput.id}`,
      targetMetrics.maskedMeanDifference >= caseValue.cloud.minimumMaskedMeanDifference,
      `蒙版内平均 RGB 变化 ${targetMetrics.maskedMeanDifference.toFixed(2)}。`,
      `>= ${caseValue.cloud.minimumMaskedMeanDifference}`, targetMetrics.maskedMeanDifference);

    for (const foreground of targetInput.foregrounds) {
      if (foreground.layerKind === "text") {
        for (const line of localTexts.filter(layer => layer.sourceSelectionId === foreground.id)) {
          const metrics = await compareTextForeground(
            sourcePixels,
            targetPixels,
            targetInput.box,
            width,
            height,
            line
          );
          foregroundRemovals.push({
            targetId: targetInput.id,
            foregroundId: line.id,
            kind: "text",
            ...metrics
          });
        }
        continue;
      }
      const diagnostic = elementDiagnostics.get(foreground.id);
      if (!diagnostic) continue;
      const metrics = compareGlobalForeground(
        sourcePixels,
        targetPixels,
        targetInput.box,
        width,
        height,
        diagnostic.refinedAlpha,
        imageWidth,
        foreground
      );
      foregroundRemovals.push({
        targetId: targetInput.id,
        foregroundId: foreground.id,
        kind: "material",
        ...metrics
      });
    }
  }

  for (const removal of foregroundRemovals) {
    const passed = removal.pixels > 0 &&
      removal.meanDifference >= caseValue.cloud.minimumForegroundMeanDifference &&
      removal.changedRatio >= caseValue.cloud.minimumForegroundChangedRatio;
    addCheck(checks, `cloud-foreground-removed:${removal.targetId}:${removal.foregroundId}`, passed,
      `${removal.kind === "text" ? "文字" : "素材"}前景区域平均变化 ${removal.meanDifference.toFixed(2)}，` +
      `变化像素占比 ${(removal.changedRatio * 100).toFixed(2)}%。`, {
        pixels: "> 0",
        meanDifference: `>= ${caseValue.cloud.minimumForegroundMeanDifference}`,
        changedRatio: `>= ${caseValue.cloud.minimumForegroundChangedRatio}`
      }, removal);
  }

  return {
    stage: "cloud",
    passed: checks.every(check => check.passed),
    checks,
    targets,
    foregroundRemovals
  };
}

export function textLayers(documentValue: AutoLayerDocument): AutoLayerTextItem[] {
  return documentValue.layers.filter((layer): layer is AutoLayerTextItem => layer.kind === "text");
}

export function layerById(layers: readonly AutoLayerItem[], id: string) {
  return layers.find(layer => layer.id === id);
}
