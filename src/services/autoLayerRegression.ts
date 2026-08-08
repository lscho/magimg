import type { AutoLayerDocument, AutoLayerItem, AutoLayerTextItem } from "@/components/auto-layer/types";
import type {
  AutoLayerDiagnostics,
  AutoLayerInferenceResult,
  useCutoutInference
} from "@/composables/useCutoutInference";
import type { AutoLayerRepairAtlas } from "@/services/autoLayerRepairAtlas";
import { useAppStore } from "@/stores/app";
import { applyAutoLayerRepairAtlas, autoLayerAtlasFileName } from "@/services/autoLayerRepairAtlas";
import { buildAutoLayerManifest, renderAutoLayerAsset, renderAutoLayerPreview } from "@/services/autoLayerExport";
import { createAutoLayerItems, orderAutoLayersByHierarchy } from "@/services/autoLayerModel";
import {
  evaluateCloudAutoLayerQuality,
  evaluateLocalAutoLayerQuality,
  type AutoLayerCloudQualityReport,
  type AutoLayerLocalQualityReport,
  type AutoLayerRegressionCase
} from "@/services/autoLayerRegressionQuality";
import {
  readAutoLayerSelectionRecords,
  restoreAutoLayerSelectionRecord
} from "@/services/autoLayerSelectionHistory";
import type { CutoutSelectionBox } from "@/types";

type CutoutInference = ReturnType<typeof useCutoutInference>;
type AppStore = ReturnType<typeof useAppStore>;

export interface AutoLayerRegressionOptions {
  collectorUrl: string;
  recordId?: string;
  runId: string;
  qualityCase: AutoLayerRegressionCase;
  cloud: boolean;
  inference: CutoutInference;
  app: AppStore;
  onStatus?: (message: string) => void;
}

interface RegressionSummary {
  runId: string;
  recordId: string;
  source: { name: string; width: number; height: number };
  selectionCount: number;
  materialCount: number;
  textCount: number;
  cloud: boolean;
  cloudTaskId?: string;
  quality: {
    local: AutoLayerLocalQualityReport;
    cloud?: AutoLayerCloudQualityReport;
  };
  outputFiles: string[];
}

function jsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("自动分层回归图片编码失败。")),
    "image/png"
  ));
}

async function syntheticRepairedAtlas(atlas: AutoLayerRepairAtlas) {
  const [image, mask] = await Promise.all([
    createImageBitmap(atlas.imageBlob),
    createImageBitmap(atlas.maskBlob)
  ]);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = atlas.width;
    canvas.height = atlas.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前设备无法执行云图集合成自检。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(mask, 0, 0, canvas.width, canvas.height);
    const maskPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let pixel = 0; pixel < canvas.width * canvas.height; pixel += 1) {
      const strength = maskPixels[pixel * 4] / 255;
      if (strength <= 0) continue;
      const offset = pixel * 4;
      const replacements = [
        (pixels.data[offset] + 96) % 256,
        (pixels.data[offset + 1] + 128) % 256,
        (pixels.data[offset + 2] + 160) % 256
      ];
      for (let channel = 0; channel < 3; channel += 1) {
        pixels.data[offset + channel] = Math.round(
          pixels.data[offset + channel] * (1 - strength) + replacements[channel] * strength
        );
      }
    }
    context.putImageData(pixels, 0, 0);
    return canvasBlob(canvas);
  } finally {
    image.close();
    mask.close();
  }
}

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "") || "item";
}

function clampedBox(box: CutoutSelectionBox, width: number, height: number) {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const right = Math.min(width, Math.ceil(box.x + box.width));
  const bottom = Math.min(height, Math.ceil(box.y + box.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

async function renderMask(
  mask: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  source: CanvasImageSource,
  box: CutoutSelectionBox,
  overlay: boolean
) {
  if (mask.length !== imageWidth * imageHeight) throw new Error("自动分层诊断蒙版尺寸无效。");
  const crop = clampedBox(box, imageWidth, imageHeight);
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法生成自动分层诊断图片。");
  if (overlay) {
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  }
  const pixels = overlay
    ? context.getImageData(0, 0, crop.width, crop.height)
    : context.createImageData(crop.width, crop.height);
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const value = mask[(crop.y + y) * imageWidth + crop.x + x];
      const offset = (y * crop.width + x) * 4;
      if (overlay) {
        const alpha = value / 255 * 0.62;
        pixels.data[offset] = Math.round(pixels.data[offset] * (1 - alpha) + 255 * alpha);
        pixels.data[offset + 1] = Math.round(pixels.data[offset + 1] * (1 - alpha) + 48 * alpha);
        pixels.data[offset + 2] = Math.round(pixels.data[offset + 2] * (1 - alpha) + 48 * alpha);
      } else {
        pixels.data[offset] = value;
        pixels.data[offset + 1] = value;
        pixels.data[offset + 2] = value;
      }
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvasBlob(canvas);
}

function maskStats(mask: Uint8Array) {
  let nonZero = 0;
  let solid = 0;
  let total = 0;
  for (const value of mask) {
    if (value) nonZero += 1;
    if (value >= 224) solid += 1;
    total += value;
  }
  return {
    nonZero,
    solid,
    mean: Math.round(total / Math.max(1, mask.length) * 1000) / 1000
  };
}

async function renderLayersOnly(documentValue: AutoLayerDocument) {
  const canvas = document.createElement("canvas");
  canvas.width = documentValue.width;
  canvas.height = documentValue.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成自动分层素材预览。");
  for (const layer of documentValue.layers) {
    if (!layer.visible) continue;
    const bitmap = await createImageBitmap(await renderAutoLayerAsset(layer));
    try {
      context.drawImage(bitmap, layer.x, layer.y, layer.width, layer.height);
    } finally {
      bitmap.close();
    }
  }
  return canvasBlob(canvas);
}

function textMetadata(layer: AutoLayerTextItem) {
  return {
    id: layer.id,
    name: layer.name,
    text: layer.text,
    confidence: layer.ocrConfidence,
    color: layer.color,
    fontSize: layer.fontSize,
    fontWeight: layer.fontWeight,
    fontCategory: layer.fontCategory,
    sourceBox: layer.sourceBox,
    parentId: layer.parentId,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height
  };
}

function layerMetadata(layer: AutoLayerItem) {
  if (layer.kind === "text") return { kind: layer.kind, ...textMetadata(layer) };
  return {
    id: layer.id,
    name: layer.name,
    kind: layer.kind,
    sourceSelectionId: layer.sourceSelectionId,
    sourceBox: layer.sourceBox,
    parentId: layer.parentId,
    recognitionConfidence: layer.recognitionConfidence,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    elementType: layer.elementType,
    cleanedChildren: layer.cleanedChildren
  };
}

function diagnosticsMetadata(diagnostics: AutoLayerDiagnostics, layers: readonly AutoLayerItem[]) {
  return {
    selections: diagnostics.selections,
    elements: diagnostics.elements.map(item => ({
      selection: item.selection,
      candidateScores: item.candidateScores,
      candidateMasks: item.candidateAlphas.map(maskStats),
      selectedCandidateIndex: item.selectedCandidateIndex,
      coarseMask: maskStats(item.coarseAlpha),
      refinedMask: maskStats(item.refinedAlpha)
    })),
    repairRegions: diagnostics.repairRegions.map(region => ({
      layerId: region.layerId,
      contextBox: region.contextBox,
      contentBox: region.contentBox,
      mask: maskStats(region.mask)
    })),
    backgroundMask: maskStats(diagnostics.backgroundMask),
    layers: layers.map(layerMetadata)
  };
}

function allImageBox(width: number, height: number): CutoutSelectionBox {
  return { id: "full-image", x: 0, y: 0, width, height };
}

function localDocument(output: AutoLayerInferenceResult, width: number, height: number): AutoLayerDocument {
  return {
    backgroundBlob: output.backgroundBlob,
    width,
    height,
    layers: orderAutoLayersByHierarchy([
      ...createAutoLayerItems(output.materials),
      ...output.texts
    ]),
    status: "draft"
  };
}

async function postCollector(collectorUrl: string, endpoint: "complete" | "error", value: unknown) {
  const response = await fetch(`${collectorUrl}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value)
  });
  if (!response.ok) throw new Error(`回归产物收集器返回 HTTP ${response.status}。`);
}

export async function runAutoLayerRegression(options: AutoLayerRegressionOptions): Promise<RegressionSummary> {
  const outputFiles: string[] = [];
  const upload = async (relativePath: string, body: Blob) => {
    const response = await fetch(`${options.collectorUrl}/files/${encodeURIComponent(relativePath)}`, {
      method: "PUT",
      headers: { "content-type": body.type || "application/octet-stream" },
      body
    });
    if (!response.ok) throw new Error(`回归产物 ${relativePath} 写入失败（HTTP ${response.status}）。`);
    outputFiles.push(relativePath);
  };

  try {
    options.onStatus?.("读取保存的选区记录");
    const history = await readAutoLayerSelectionRecords();
    const record = options.recordId
      ? history.records.find(item => item.id === options.recordId)
      : history.records[0];
    if (!record) throw new Error("没有找到可用于回归测试的自动分层选区记录。");
    const restored = await restoreAutoLayerSelectionRecord(record);
    const bitmap = await createImageBitmap(restored.selectedFile.file);
    try {
      await upload("record.json", jsonBlob(record));
      await upload(`source/${safeName(record.sourceName.replace(/\.[^.]+$/u, ""))}.png`, restored.selectedFile.file);
      options.onStatus?.(`运行本地模型（${record.selections.length} 个选区）`);
      const output = await options.inference.createAutoLayers(
        bitmap,
        bitmap.width,
        bitmap.height,
        restored.selections,
        {
          collectDiagnostics: true,
          onDiagnosticStage: stage => options.onStatus?.(stage),
          cloudMaxPixels: options.app.capabilities.backgroundRepairMaxPixels,
          cloudMaxBytes: options.app.capabilities.backgroundRepairMaxBytes
        }
      );
      if (!output) throw new Error(options.inference.error.value || "自动分层本地推理没有返回结果。");
      if (!output.diagnostics) throw new Error("自动分层回归未收集到诊断数据。");
      const documentValue = localDocument(output, bitmap.width, bitmap.height);

      options.onStatus?.("导出本地素材与诊断蒙版");
      await upload("local/background-original.png", output.backgroundBlob);
      await upload("local/layers-only.png", await renderLayersOnly(documentValue));
      await upload("local/preview-with-original-background.png", await renderAutoLayerPreview(documentValue));
      if (output.cloudAtlas) {
        await upload("atlas/input-image", output.cloudAtlas.imageBlob);
        await upload("atlas/input-mask.png", output.cloudAtlas.maskBlob);
        await upload("atlas/layout.json", jsonBlob({
          width: output.cloudAtlas.width,
          height: output.cloudAtlas.height,
          scale: output.cloudAtlas.scale,
          imageType: output.cloudAtlas.imageBlob.type,
          imageBytes: output.cloudAtlas.imageBlob.size,
          maskBytes: output.cloudAtlas.maskBlob.size,
          tiles: output.cloudAtlas.tiles
        }));
      } else {
        await upload("atlas/layout.json", jsonBlob({
          localExtraction: true,
          backgroundAnalysis: output.diagnostics.backgroundExtraction ?? null
        }));
      }

      for (let index = 0; index < output.materials.length; index += 1) {
        const material = output.materials[index];
        await upload(
          `materials/${String(index + 1).padStart(2, "0")}-${safeName(material.name ?? material.id)}.png`,
          material.blob
        );
      }
      for (let index = 0; index < output.texts.length; index += 1) {
        const layer = output.texts[index];
        await upload(`texts/${String(index + 1).padStart(2, "0")}-${safeName(layer.name)}.png`, layer.blob);
      }
      await upload("texts/texts.json", jsonBlob(output.texts.map(textMetadata)));

      for (let index = 0; index < output.diagnostics.elements.length; index += 1) {
        const item = output.diagnostics.elements[index];
        const stem = `${String(index + 1).padStart(2, "0")}-${safeName(item.selection.id)}`;
        for (let candidateIndex = 0; candidateIndex < item.candidateAlphas.length; candidateIndex += 1) {
          const candidate = item.candidateAlphas[candidateIndex];
          await upload(`masks/elements/${stem}-candidate-${candidateIndex + 1}.png`, await renderMask(
            candidate, bitmap.width, bitmap.height, bitmap, item.selection, false
          ));
          await upload(`masks/elements/${stem}-candidate-${candidateIndex + 1}-overlay.png`, await renderMask(
            candidate, bitmap.width, bitmap.height, bitmap, item.selection, true
          ));
        }
        await upload(`masks/elements/${stem}-coarse.png`, await renderMask(
          item.coarseAlpha, bitmap.width, bitmap.height, bitmap, item.selection, false
        ));
        await upload(`masks/elements/${stem}-coarse-overlay.png`, await renderMask(
          item.coarseAlpha, bitmap.width, bitmap.height, bitmap, item.selection, true
        ));
        await upload(`masks/elements/${stem}-refined.png`, await renderMask(
          item.refinedAlpha, bitmap.width, bitmap.height, bitmap, item.selection, false
        ));
        await upload(`masks/elements/${stem}-refined-overlay.png`, await renderMask(
          item.refinedAlpha, bitmap.width, bitmap.height, bitmap, item.selection, true
        ));
      }
      for (let index = 0; index < output.diagnostics.repairRegions.length; index += 1) {
        const region = output.diagnostics.repairRegions[index];
        const stem = `${String(index + 1).padStart(2, "0")}-${safeName(region.layerId)}`;
        await upload(`masks/parents/${stem}.png`, await renderMask(
          region.mask, bitmap.width, bitmap.height, bitmap, region.contextBox, false
        ));
        await upload(`masks/parents/${stem}-overlay.png`, await renderMask(
          region.mask, bitmap.width, bitmap.height, bitmap, region.contextBox, true
        ));
      }
      await upload("masks/background.png", await renderMask(
        output.diagnostics.backgroundMask,
        bitmap.width,
        bitmap.height,
        bitmap,
        allImageBox(bitmap.width, bitmap.height),
        false
      ));
      await upload("masks/background-overlay.png", await renderMask(
        output.diagnostics.backgroundMask,
        bitmap.width,
        bitmap.height,
        bitmap,
        allImageBox(bitmap.width, bitmap.height),
        true
      ));
      await upload("local/diagnostics.json", jsonBlob(diagnosticsMetadata(
        output.diagnostics,
        documentValue.layers
      )));
      options.onStatus?.("执行本地素材质量门禁");
      const localQuality = await evaluateLocalAutoLayerQuality({
        caseValue: options.qualityCase,
        record,
        output,
        diagnostics: output.diagnostics,
        imageWidth: bitmap.width,
        imageHeight: bitmap.height
      });
      await upload("quality/local.json", jsonBlob(localQuality));
      if (!localQuality.passed) {
        const failed = localQuality.checks.filter(check => !check.passed).map(check => check.id);
        throw new Error(`本地素材质量门禁未通过：${failed.join("、")}`);
      }
      if (output.cloudAtlas) {
        options.onStatus?.("执行原分辨率蒙版合成自检");
        const syntheticAtlas = await syntheticRepairedAtlas(output.cloudAtlas);
        const syntheticRepair = await applyAutoLayerRepairAtlas(syntheticAtlas, output.cloudAtlas, {
          backgroundBlob: documentValue.backgroundBlob,
          layers: documentValue.layers
        });
        const syntheticDocument: AutoLayerDocument = {
          ...documentValue,
          backgroundBlob: syntheticRepair.backgroundBlob,
          layers: syntheticRepair.layers,
          status: "complete"
        };
        const compositingQuality = await evaluateCloudAutoLayerQuality({
          caseValue: options.qualityCase,
          localDocument: documentValue,
          completeDocument: syntheticDocument,
          diagnostics: output.diagnostics,
          imageWidth: bitmap.width,
          imageHeight: bitmap.height
        });
        await upload("quality/compositing.json", jsonBlob(compositingQuality));
        if (!compositingQuality.passed) {
          const failed = compositingQuality.checks.filter(check => !check.passed).map(check => check.id);
          throw new Error(`原分辨率蒙版合成自检未通过：${failed.join("、")}`);
        }
      } else {
        options.onStatus?.("纯色/渐变背景本地提取，跳过云端合成自检");
      }

      let cloudTaskId: string | undefined;
      let cloudQuality: AutoLayerCloudQualityReport | undefined;
      if (options.cloud && output.cloudAtlas) {
        options.onStatus?.("提交一次云端图集修复（20 积分）");
        const charge = await options.app.chargeMatting("autoLayer");
        let accepted = false;
        try {
          const task = await options.app.createAutoLayerTask({
            image: new File([output.cloudAtlas.imageBlob], autoLayerAtlasFileName(output.cloudAtlas.imageBlob), {
              type: output.cloudAtlas.imageBlob.type || "image/png"
            }),
            mask: output.cloudAtlas.maskBlob,
            mattingId: charge.mattingId,
            idempotencyKey: `auto-layer-test:${record.id.slice(-12)}:${options.runId}`
          });
          accepted = true;
          cloudTaskId = task.id;
          const complete = await options.app.waitForAutoLayerTask(task, new AbortController().signal);
          const repairedAtlas = await options.app.downloadAutoLayerOutput(complete);
          await upload("cloud/repaired-atlas.png", repairedAtlas);
          const repaired = await applyAutoLayerRepairAtlas(repairedAtlas, output.cloudAtlas, {
            backgroundBlob: documentValue.backgroundBlob,
            layers: documentValue.layers
          });
          const completeDocument: AutoLayerDocument = {
            ...documentValue,
            backgroundBlob: repaired.backgroundBlob,
            layers: repaired.layers,
            status: "complete",
            cloudInputAssetId: complete.inputAssetId
          };
          await upload("cloud/background.png", repaired.backgroundBlob);
          await upload("cloud/preview.png", await renderAutoLayerPreview(completeDocument));
          await upload("cloud/layers-only.png", await renderLayersOnly(completeDocument));
          const assetNames = new Map(completeDocument.layers.map((layer, index) => [
            layer.id,
            `${String(index + 1).padStart(2, "0")}-${safeName(layer.name)}`
          ]));
          await upload("cloud/manifest.json", jsonBlob(buildAutoLayerManifest(completeDocument, assetNames)));
          await upload("cloud/texts.json", jsonBlob(completeDocument.layers
            .filter((layer): layer is AutoLayerTextItem => layer.kind === "text")
            .map(textMetadata)));
          for (const layer of completeDocument.layers) {
            if (layer.kind !== "material" || !layer.cleanedChildren) continue;
            await upload(`cloud/repaired-materials/${safeName(layer.name)}.png`, layer.blob);
          }
          options.onStatus?.("执行云端背景质量门禁");
          cloudQuality = await evaluateCloudAutoLayerQuality({
            caseValue: options.qualityCase,
            localDocument: documentValue,
            completeDocument,
            diagnostics: output.diagnostics,
            imageWidth: bitmap.width,
            imageHeight: bitmap.height
          });
          await upload("quality/cloud.json", jsonBlob(cloudQuality));
          if (!cloudQuality.passed) {
            const failed = cloudQuality.checks.filter(check => !check.passed).map(check => check.id);
            throw new Error(`云端背景质量门禁未通过：${failed.join("、")}`);
          }
        } catch (error) {
          if (!accepted) await options.app.refundMatting(charge.mattingId).catch(() => undefined);
          throw error;
        }
      }

      const summary: RegressionSummary = {
        runId: options.runId,
        recordId: record.id,
        source: { name: record.sourceName, width: bitmap.width, height: bitmap.height },
        selectionCount: record.selections.length,
        materialCount: output.materials.length,
        textCount: output.texts.length,
        cloud: options.cloud,
        cloudTaskId,
        quality: { local: localQuality, ...(cloudQuality ? { cloud: cloudQuality } : {}) },
        outputFiles
      };
      await postCollector(options.collectorUrl, "complete", summary);
      options.onStatus?.("回归产物已导出");
      return summary;
    } finally {
      bitmap.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await postCollector(options.collectorUrl, "error", { message, outputFiles }).catch(() => undefined);
    throw error;
  }
}
