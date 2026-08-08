/**
 * 大区域背景修复的分块布局与羽化权重。
 *
 * Big-LaMa 输入固定 512×512：超过输入尺寸的修复区域按等间距瓦片覆盖，
 * 相邻瓦片共享重叠带，输出按轴分离的线性羽化权重合成，保证重叠区权重和为 1。
 * 该模块为纯函数，不依赖 Tauri 或 DOM，便于单元测试。
 */

export const REPAIR_TILE_SIZE = 512;
/** 相邻瓦片的目标重叠宽度；等间距布局下的实际重叠由区域尺寸决定。 */
export const REPAIR_TILE_OVERLAP = 128;
export const REPAIR_TILE_MIN_STEP = REPAIR_TILE_SIZE - REPAIR_TILE_OVERLAP;
/** 单次修复允许的模型调用上限，超出后回退为整框单次修复。 */
export const MAX_REPAIR_TILES = 12;

export interface RepairTileAxis {
  count: number;
  starts: number[];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * 在单个轴上布局瓦片：起点从 0 开始等间距分布，最后一块恰好覆盖到尺寸末端。
 * 区域不超过单块尺寸时只生成一块。
 */
export function buildRepairTileAxis(
  size: number,
  tileSize = REPAIR_TILE_SIZE,
  minStep = REPAIR_TILE_MIN_STEP
): RepairTileAxis {
  if (size <= tileSize) return { count: 1, starts: [0] };
  const count = Math.ceil((size - tileSize) / minStep) + 1;
  const step = (size - tileSize) / (count - 1);
  const starts: number[] = [];
  for (let index = 0; index < count; index += 1) {
    starts.push(Math.round(index * step));
  }
  starts[count - 1] = size - tileSize;
  return { count, starts };
}

/**
 * 单个瓦片在某轴上的羽化权重：与相邻瓦片的重叠带内线性过渡，
 * 区域边缘一侧恒为 1；等间距布局下同位置所有瓦片的权重和为 1。
 */
export function repairTileAxisWeight(
  index: number,
  starts: readonly number[],
  tileSize: number,
  position: number
): number {
  const start = starts[index];
  let weight = 1;
  if (index > 0) {
    const overlap = Math.max(1, starts[index - 1] + tileSize - start);
    weight *= clamp((position - start) / overlap, 0, 1);
  }
  if (index < starts.length - 1) {
    const overlap = Math.max(1, start + tileSize - starts[index + 1]);
    weight *= clamp((start + tileSize - position) / overlap, 0, 1);
  }
  return weight;
}

/**
 * 瓦片内是否包含需要修复的蒙版像素。阈值与模型输入蒙版阈值一致，
 * 完全无蒙版的瓦片直接沿用原图，不调用模型。
 */
export function repairTileHasMask(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  tileWidth: number,
  tileHeight: number,
  threshold = 32
): boolean {
  if (mask.length !== width * height) {
    throw new Error("修复蒙版尺寸不匹配。");
  }
  for (let ty = 0; ty < tileHeight; ty += 1) {
    const row = (y + ty) * width + x;
    for (let tx = 0; tx < tileWidth; tx += 1) {
      if (mask[row + tx] >= threshold) return true;
    }
  }
  return false;
}
