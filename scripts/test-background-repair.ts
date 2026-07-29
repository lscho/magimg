import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  analyzeMaterialContext,
  diffuseRepairRgba
} from "@/services/cutoutRepairContext";
import { compositeMaskedRgba } from "@/services/cutoutRepairCompositing";
import { prepareRepairMask } from "@/services/cutoutRepairMask";

type Region = {
  type: "ellipse" | "rect" | "roundedRect";
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
};

type RepairTestCase = {
  image: string;
  outputDirectory?: string;
  selection: { x: number; y: number; width: number; height: number };
  parentAlpha?: Region[];
  removalMask: Region[];
};

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configArgument = process.argv[2] ?? "tests/background-repair.case.json";
const configPath = path.resolve(repositoryRoot, configArgument);
const configDirectory = path.dirname(configPath);
const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as RepairTestCase;
const inputPath = path.resolve(configDirectory, config.image);
const outputDirectory = path.resolve(
  configDirectory,
  config.outputDirectory ?? "output/background-repair"
);

const input = PNG.sync.read(fs.readFileSync(inputPath));
const selection = normalizeSelection(config.selection, input.width, input.height);
const source = cropRgba(input.data, input.width, selection);
const width = selection.width;
const height = selection.height;
const parentAlpha = config.parentAlpha?.length
  ? rasterizeRegions(config.parentAlpha, width, height)
  : new Uint8Array(width * height).fill(255);
const rawRemovalMask = rasterizeRegions(config.removalMask, width, height);
for (let pixel = 0; pixel < rawRemovalMask.length; pixel += 1) {
  rawRemovalMask[pixel] = Math.min(rawRemovalMask[pixel], parentAlpha[pixel]);
}
const fullRemovalMask = new Uint8Array(input.width * input.height);
placePlane(fullRemovalMask, input.width, rawRemovalMask, selection);
const preparedFullMask = prepareRepairMask(fullRemovalMask, input.width, input.height, {
  id: "manual-repair-test",
  ...selection
});
const repairMask = cropPlane(preparedFullMask, input.width, selection);
const analysis = analyzeMaterialContext(source, parentAlpha, repairMask, width, height);
const repaired = diffuseRepairRgba(
  source,
  parentAlpha,
  repairMask,
  width,
  height,
  analysis.fillColor
);
const composited = compositeMaskedRgba(source, repaired, repairMask);

fs.mkdirSync(outputDirectory, { recursive: true });
writePng(path.join(outputDirectory, "01-source.png"), source, width, height);
writeMaskPng(path.join(outputDirectory, "02-mask.png"), repairMask, width, height);
writePng(
  path.join(outputDirectory, "03-mask-overlay.png"),
  maskOverlay(source, repairMask),
  width,
  height
);
writePng(
  path.join(outputDirectory, "04-diffusion-result.png"),
  applyOutputAlpha(composited, parentAlpha),
  width,
  height
);

const diagnostics = {
  input: path.relative(repositoryRoot, inputPath),
  selection,
  outputSize: { width, height },
  suggestedMode: analysis.useDiffusion ? "diffusion" : "lama",
  executedMode: "diffusion",
  fillColor: analysis.fillColor,
  dominantCoverage: round(analysis.dominantCoverage),
  nearbyCoverage: round(analysis.nearbyCoverage),
  repairedPixels: repairMask.reduce((count, value) => count + Number(value > 0), 0),
  note: analysis.useDiffusion
    ? "当前生产逻辑会使用二维扩散。"
    : "当前生产逻辑会回退到 LaMa；脚本仍输出扩散结果，便于调试分类阈值。"
};
fs.writeFileSync(
  path.join(outputDirectory, "diagnostics.json"),
  `${JSON.stringify(diagnostics, null, 2)}\n`
);

console.log(`背景修复测试完成：${path.relative(repositoryRoot, outputDirectory)}`);
console.log(`建议路径：${diagnostics.suggestedMode}`);
console.log(`主背景色：rgb(${analysis.fillColor.join(", ")})`);
console.log(`近似色覆盖率：${(analysis.nearbyCoverage * 100).toFixed(1)}%`);

function normalizeSelection(
  value: RepairTestCase["selection"],
  imageWidth: number,
  imageHeight: number
) {
  const x = Math.max(0, Math.min(imageWidth - 1, Math.round(value.x)));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.round(value.y)));
  const width = Math.max(1, Math.min(imageWidth - x, Math.round(value.width)));
  const height = Math.max(1, Math.min(imageHeight - y, Math.round(value.height)));
  return { x, y, width, height };
}

function cropRgba(
  rgba: Buffer,
  imageWidth: number,
  bounds: { x: number; y: number; width: number; height: number }
) {
  const output = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = ((bounds.y + y) * imageWidth + bounds.x) * 4;
    const targetStart = y * bounds.width * 4;
    output.set(
      rgba.subarray(sourceStart, sourceStart + bounds.width * 4),
      targetStart
    );
  }
  return output;
}

function cropPlane(
  values: Uint8Array,
  imageWidth: number,
  bounds: { x: number; y: number; width: number; height: number }
) {
  const output = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = (bounds.y + y) * imageWidth + bounds.x;
    output.set(values.subarray(sourceStart, sourceStart + bounds.width), y * bounds.width);
  }
  return output;
}

function placePlane(
  target: Uint8Array,
  targetWidth: number,
  source: Uint8Array,
  bounds: { x: number; y: number; width: number; height: number }
) {
  for (let y = 0; y < bounds.height; y += 1) {
    const targetStart = (bounds.y + y) * targetWidth + bounds.x;
    target.set(source.subarray(y * bounds.width, (y + 1) * bounds.width), targetStart);
  }
}

function rasterizeRegions(regions: readonly Region[], width: number, height: number) {
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (regions.some((region) => regionContains(region, x + 0.5, y + 0.5))) {
        output[y * width + x] = 255;
      }
    }
  }
  return output;
}

function regionContains(region: Region, x: number, y: number) {
  if (region.width <= 0 || region.height <= 0) return false;
  if (region.type === "ellipse") {
    const centerX = region.x + region.width / 2;
    const centerY = region.y + region.height / 2;
    const normalizedX = (x - centerX) / (region.width / 2);
    const normalizedY = (y - centerY) / (region.height / 2);
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  }
  if (region.type === "rect") {
    return x >= region.x && x <= region.x + region.width &&
      y >= region.y && y <= region.y + region.height;
  }
  const radius = Math.max(
    0,
    Math.min(region.radius ?? 0, region.width / 2, region.height / 2)
  );
  const centerX = Math.min(region.x + region.width - radius, Math.max(region.x + radius, x));
  const centerY = Math.min(region.y + region.height - radius, Math.max(region.y + radius, y));
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}

function maskOverlay(source: Uint8ClampedArray, mask: Uint8Array) {
  const output = source.slice();
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const strength = mask[pixel] / 255 * 0.55;
    if (strength <= 0) continue;
    const offset = pixel * 4;
    output[offset] = Math.round(output[offset] * (1 - strength) + 239 * strength);
    output[offset + 1] = Math.round(output[offset + 1] * (1 - strength) + 68 * strength);
    output[offset + 2] = Math.round(output[offset + 2] * (1 - strength) + 68 * strength);
  }
  return output;
}

function applyOutputAlpha(rgba: Uint8ClampedArray, alpha: Uint8Array) {
  const output = rgba.slice();
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    output[pixel * 4 + 3] = alpha[pixel];
  }
  return output;
}

function writeMaskPng(filePath: string, mask: Uint8Array, width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    rgba[offset] = mask[pixel];
    rgba[offset + 1] = mask[pixel];
    rgba[offset + 2] = mask[pixel];
    rgba[offset + 3] = 255;
  }
  writePng(filePath, rgba, width, height);
}

function writePng(filePath: string, rgba: Uint8ClampedArray, width: number, height: number) {
  const png = new PNG({ width, height });
  png.data.set(rgba);
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
