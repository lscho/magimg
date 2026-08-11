import type { AutoLayerDocument, AutoLayerItem, AutoLayerTextItem } from "@/components/auto-layer/types";
import type {
  AutoLayerDiagnostics,
  AutoLayerInferenceResult,
  useCutoutInference
} from "@/composables/useCutoutInference";
import { useAppStore } from "@/stores/app";
import { buildAutoLayerManifest, renderAutoLayerAsset, renderAutoLayerPreview } from "@/services/autoLayerExport";
import { compositeAutoLayerCloudOutput } from "@/services/autoLayerCloudComposite";
import {
  autoLayerUploadFileName,
  prepareAutoLayerCloudUpload,
  type PreparedAutoLayerCloudUpload
} from "@/services/autoLayerCloudUpload";
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
  forceCloudInput: boolean;
  skipQualityGate?: boolean;
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

async function renderSelectionBoxes(image: Blob, boxes: readonly CutoutSelectionBox[]) {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前设备无法生成云端框选诊断图。");
    context.drawImage(bitmap, 0, 0);
    const lineWidth = Math.max(3, Math.round(Math.max(bitmap.width, bitmap.height) / 500));
    context.lineWidth = lineWidth;
    context.strokeStyle = "#ff3355";
    context.fillStyle = "rgba(255, 51, 85, 0.16)";
    for (const box of boxes) {
      const normalized = clampedBox(box, bitmap.width, bitmap.height);
      context.fillRect(normalized.x, normalized.y, normalized.width, normalized.height);
      context.strokeRect(
        normalized.x + lineWidth / 2,
        normalized.y + lineWidth / 2,
        Math.max(0, normalized.width - lineWidth),
        Math.max(0, normalized.height - lineWidth)
      );
    }
    return canvasBlob(canvas);
  } finally {
    bitmap.close();
  }
}

async function assertCloudInputMatchesSource(
  image: Blob,
  source: ImageBitmap
) {
  const cloud = await createImageBitmap(image);
  try {
    if (cloud.width !== source.width || cloud.height !== source.height) {
      throw new Error("云端整页输入尺寸与原图不一致。");
    }
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前设备无法校验云端背景输入。");
    context.drawImage(source, 0, 0);
    const sourcePixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(cloud, 0, 0);
    const cloudPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < sourcePixels.length; index += 1) {
      if (sourcePixels[index] !== cloudPixels[index]) {
        throw new Error("云端整页输入不是原图，检测到本地修复或重采样像素。");
      }
    }
  } finally {
    cloud.close();
  }
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
    backgroundBoxes: diagnostics.backgroundBoxes,
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
      // 传输副本编码与本地模型并行，结果仅在确实需要云端背景时使用。
      const cloudUploadPreparation = prepareAutoLayerCloudUpload(
        restored.selectedFile.file,
        options.app.capabilities.backgroundRepairMaxBytes
      ).then(
        result => ({ result }),
        error => ({ error: error instanceof Error ? error : new Error("整页背景压缩失败。") })
      );
      const output = await options.inference.createAutoLayers(
        bitmap,
        bitmap.width,
        bitmap.height,
        restored.selections,
        {
          collectDiagnostics: true,
          forceCloudBackground: options.forceCloudInput,
          onDiagnosticStage: stage => options.onStatus?.(stage),
          cloudMaxPixels: options.app.capabilities.backgroundRepairMaxPixels,
          cloudMaxBytes: options.app.capabilities.backgroundRepairMaxBytes
        }
      );
      if (!output) throw new Error(options.inference.error.value || "自动分层本地推理没有返回结果。");
      if (!output.diagnostics) throw new Error("自动分层回归未收集到诊断数据。");
      const documentValue = localDocument(output, bitmap.width, bitmap.height);
      let preparedCloudUpload: PreparedAutoLayerCloudUpload | null = null;

      options.onStatus?.("导出本地素材与诊断蒙版");
      await upload("local/background-original.png", output.backgroundBlob);
      await upload("local/layers-only.png", await renderLayersOnly(documentValue));
      await upload("local/preview-with-original-background.png", await renderAutoLayerPreview(documentValue));
      if (output.cloudBackground) {
        options.onStatus?.("校验云端输入逐像素等于原图");
        const preparation = await cloudUploadPreparation;
        if ("error" in preparation) throw preparation.error;
        preparedCloudUpload = preparation.result;
        await assertCloudInputMatchesSource(output.cloudBackground.imageBlob, bitmap);
        await upload("cloud-input/background.png", output.cloudBackground.imageBlob);
        await upload(
          `cloud-input/${autoLayerUploadFileName(preparedCloudUpload.blob)}`,
          preparedCloudUpload.blob
        );
        await upload(
          "cloud-input/selection-overlay.png",
          await renderSelectionBoxes(output.cloudBackground.imageBlob, output.cloudBackground.selectionBoxes)
        );
        await upload("cloud-input/layout.json", jsonBlob({
          strategy: "original-background-with-selection-boxes",
          imageType: output.cloudBackground.imageBlob.type,
          imageBytes: output.cloudBackground.imageBlob.size,
          uploadType: preparedCloudUpload.blob.type,
          uploadBytes: preparedCloudUpload.uploadBytes,
          originalUploadBytes: preparedCloudUpload.originalBytes,
          compressed: preparedCloudUpload.compressed,
          sourcePixelMatch: true,
          selectionBoxes: output.cloudBackground.selectionBoxes,
          compositeBoxes: output.cloudBackground.compositeBoxes
        }));
      } else {
        await upload("cloud-input/layout.json", jsonBlob({
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
      options.onStatus?.(options.skipQualityGate ? "生成本地素材质量报告" : "执行本地素材质量门禁");
      const localQuality = await evaluateLocalAutoLayerQuality({
        caseValue: options.qualityCase,
        record,
        output,
        diagnostics: output.diagnostics,
        imageWidth: bitmap.width,
        imageHeight: bitmap.height
      });
      await upload("quality/local.json", jsonBlob(localQuality));
      if (!localQuality.passed && !options.skipQualityGate) {
        const failed = localQuality.checks.filter(check => !check.passed).map(check => check.id);
        throw new Error(`本地素材质量门禁未通过：${failed.join("、")}`);
      }
      options.onStatus?.(output.cloudBackground
        ? "整页背景使用无蒙版框选云修复"
        : "纯色/渐变背景本地提取，跳过云端修复");

      let cloudTaskId: string | undefined;
      let cloudQuality: AutoLayerCloudQualityReport | undefined;
      if (options.cloud && output.cloudBackground) {
        if (!preparedCloudUpload) throw new Error("云端上传传输副本不存在。");
        options.onStatus?.("提交一次无蒙版整页背景修复（20 积分）");
        const charge = await options.app.chargeMatting("autoLayer");
        let accepted = false;
        try {
          const task = await options.app.createAutoLayerTask({
            image: new File(
              [preparedCloudUpload.blob],
              autoLayerUploadFileName(preparedCloudUpload.blob),
              {
                type: preparedCloudUpload.blob.type || "image/png"
              }
            ),
            selectionBoxes: output.cloudBackground.selectionBoxes,
            mattingId: charge.mattingId,
            idempotencyKey: `auto-layer-test:${record.id.slice(-12)}:${options.runId}`
          });
          accepted = true;
          cloudTaskId = task.id;
          const complete = await options.app.waitForAutoLayerTask(task, new AbortController().signal);
          const serverBackground = await options.app.downloadAutoLayerOutput(complete);
          const repairedBackground = await compositeAutoLayerCloudOutput(
            output.cloudBackground.imageBlob,
            serverBackground,
            bitmap.width,
            bitmap.height,
            output.cloudBackground.compositeBoxes
          );
          const completeDocument: AutoLayerDocument = {
            ...documentValue,
            backgroundBlob: repairedBackground,
            status: "complete",
            cloudInputAssetId: complete.inputAssetId
          };
          await upload("cloud/background-server.png", serverBackground);
          await upload("cloud/background.png", repairedBackground);
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
