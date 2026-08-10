import { analyzeMaterialContext, type MaterialContextAnalysis } from "@/services/cutoutRepairContext";

/** 蒙版邻域平均梯度能量低于该值视为低纹理背景（平缓渐变、低对比表面）。 */
const LOW_TEXTURE_GRADIENT_MEAN = 8;
const LOW_TEXTURE_MIN_SAMPLES = 64;
const STRONG_TEXTURE_GRADIENT = 18;
/** 大面积挖空无法仅凭局部颜色可靠还原，强制转云端场景修复。 */
const MAX_LOCAL_MASK_COVERAGE = 0.18;
/** 本地整页提取只接受高置信的单一表面，不再把浅色插画当成缓渐变。 */
const LOCAL_NEARBY_COVERAGE = 0.55;
const LOCAL_DOMINANT_COVERAGE = 0.12;
const MAX_LOCAL_STRONG_GRADIENT_RATIO = 0.015;
const TEXTURE_SAMPLE_BAND = 32;
const TEXTURE_MAX_SAMPLES = 16384;

export interface AutoLayerBackgroundAnalysis extends MaterialContextAnalysis {
  /** 蒙版邻域背景纹理能量低。 */
  lowTexture: boolean;
  /** 明显边缘在已知背景采样中的占比，用于识别山体、建筑等插画结构。 */
  strongGradientRatio: number;
  /** 整页中实际需要移除的像素占比。 */
  maskCoverage: number;
}

interface BackgroundTextureMetrics {
  lowTexture: boolean;
  strongGradientRatio: number;
}

/**
 * 自动分层「纯背景提取」决策：判断整页背景在顶层元素蒙版附近是否为
 * 纯色 / 缓渐变等低信息量背景。若是，可在本地用确定性扩散直接提取背景，
 * 完全跳过云端 inpainting 生成，避免生成模型在蒙版区域凭空添加内容。
 *
 * 判定直接复用抠图路径的 analyzeMaterialContext（背景颜色集中度阈值），
 * 与 `repairBackgroundLocally` 的扩散回退行为保持一致，并叠加低纹理能量判据，
 * 覆盖颜色直方图分散但表面平滑的宽幅渐变背景。
 */
export function analyzeBackgroundExtraction(
  rgba: Uint8ClampedArray,
  backgroundMask: Uint8Array,
  width: number,
  height: number
): AutoLayerBackgroundAnalysis {
  const alpha = new Uint8Array(width * height);
  alpha.fill(255);
  const analysis = analyzeMaterialContext(rgba, alpha, backgroundMask, width, height);
  const texture = analyzeBackgroundTextureMetrics(rgba, backgroundMask, width, height);
  let maskedPixels = 0;
  for (const value of backgroundMask) {
    if (value > 0) maskedPixels += 1;
  }
  return {
    ...analysis,
    ...texture,
    maskCoverage: maskedPixels / Math.max(1, width * height)
  };
}

/**
 * 统计蒙版邻域内未遮罩背景像素的平均梯度能量。
 * 采样间隔按区域面积自适应放大，控制在大图上的计算量。
 */
function analyzeBackgroundTextureMetrics(
  rgba: Uint8ClampedArray,
  backgroundMask: Uint8Array,
  width: number,
  height: number
): BackgroundTextureMetrics {
  if (rgba.length !== width * height * 4 || backgroundMask.length !== width * height) {
    throw new Error("背景纹理分析的像素数据尺寸不匹配。");
  }
  let maskLeft = width;
  let maskTop = height;
  let maskRight = -1;
  let maskBottom = -1;
  for (let pixel = 0; pixel < backgroundMask.length; pixel += 1) {
    if (backgroundMask[pixel] <= 0) continue;
    const x = pixel % width;
    const y = (pixel - x) / width;
    maskLeft = Math.min(maskLeft, x);
    maskTop = Math.min(maskTop, y);
    maskRight = Math.max(maskRight, x);
    maskBottom = Math.max(maskBottom, y);
  }
  if (maskRight < 0) return { lowTexture: false, strongGradientRatio: 1 };
  // 留出 1px 用于中心差分；边界处退化为不采样。
  const sampleLeft = Math.max(1, maskLeft - TEXTURE_SAMPLE_BAND);
  const sampleTop = Math.max(1, maskTop - TEXTURE_SAMPLE_BAND);
  const sampleRight = Math.min(width - 2, maskRight + TEXTURE_SAMPLE_BAND);
  const sampleBottom = Math.min(height - 2, maskBottom + TEXTURE_SAMPLE_BAND);
  if (sampleRight <= sampleLeft || sampleBottom <= sampleTop) {
    return { lowTexture: false, strongGradientRatio: 1 };
  }

  const regionWidth = sampleRight - sampleLeft + 1;
  const regionHeight = sampleBottom - sampleTop + 1;
  const stride = Math.max(
    1,
    Math.ceil(Math.sqrt((regionWidth * regionHeight) / TEXTURE_MAX_SAMPLES))
  );
  let total = 0;
  let gradientSum = 0;
  let strongGradients = 0;
  for (let y = sampleTop; y <= sampleBottom; y += stride) {
    for (let x = sampleLeft; x <= sampleRight; x += stride) {
      const pixel = y * width + x;
      if (backgroundMask[pixel] > 0) continue;
      const offset = pixel * 4;
      const leftOffset = offset - 4;
      const rightOffset = offset + 4;
      const upOffset = offset - width * 4;
      const downOffset = offset + width * 4;
      const gradient =
        Math.abs(rgba[rightOffset] - rgba[leftOffset]) +
        Math.abs(rgba[rightOffset + 1] - rgba[leftOffset + 1]) +
        Math.abs(rgba[rightOffset + 2] - rgba[leftOffset + 2]) +
        Math.abs(rgba[downOffset] - rgba[upOffset]) +
        Math.abs(rgba[downOffset + 1] - rgba[upOffset + 1]) +
        Math.abs(rgba[downOffset + 2] - rgba[upOffset + 2]);
      const normalizedGradient = gradient / 6;
      gradientSum += normalizedGradient;
      if (normalizedGradient >= STRONG_TEXTURE_GRADIENT) strongGradients += 1;
      total += 1;
    }
  }
  if (total < LOW_TEXTURE_MIN_SAMPLES) {
    return { lowTexture: false, strongGradientRatio: 1 };
  }
  return {
    lowTexture: gradientSum / total <= LOW_TEXTURE_GRADIENT_MEAN,
    strongGradientRatio: strongGradients / total
  };
}

export function analyzeBackgroundTexture(
  rgba: Uint8ClampedArray,
  backgroundMask: Uint8Array,
  width: number,
  height: number
): boolean {
  return analyzeBackgroundTextureMetrics(rgba, backgroundMask, width, height).lowTexture;
}

/**
 * 综合颜色集中度与纹理能量，决定整页背景是否跳过云端生成直接本地提取。
 */
export function shouldExtractBackgroundLocally(analysis: AutoLayerBackgroundAnalysis | null): boolean {
  if (!analysis) return false;
  if (analysis.maskCoverage <= 0 || analysis.maskCoverage > MAX_LOCAL_MASK_COVERAGE) return false;
  return analysis.useDiffusion &&
    analysis.lowTexture &&
    analysis.strongGradientRatio <= MAX_LOCAL_STRONG_GRADIENT_RATIO &&
    analysis.nearbyCoverage >= LOCAL_NEARBY_COVERAGE &&
    analysis.dominantCoverage >= LOCAL_DOMINANT_COVERAGE;
}

/**
 * 从图源读取整页像素并做背景复杂度分析。
 * 分析失败（如设备不支持读像素）时返回 null，由调用方回退到云端生成。
 */
export async function sampleBackgroundAnalysis(
  source: CanvasImageSource,
  width: number,
  height: number,
  backgroundMask: Uint8Array
): Promise<AutoLayerBackgroundAnalysis | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前设备无法分析分层背景。");
    context.drawImage(source, 0, 0, width, height);
    return analyzeBackgroundExtraction(
      context.getImageData(0, 0, width, height).data,
      backgroundMask,
      width,
      height
    );
  } catch {
    return null;
  }
}
