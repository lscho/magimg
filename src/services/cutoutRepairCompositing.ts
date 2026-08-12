/** 只替换蒙版覆盖的 RGB，原图 alpha 与所有未覆盖像素保持不变。 */
export function compositeMaskedRgba(
  source: Uint8ClampedArray,
  repaired: Uint8ClampedArray,
  mask: Uint8Array
) {
  if (source.length !== repaired.length || source.length !== mask.length * 4) {
    throw new Error("背景修复合成数据尺寸不匹配。");
  }
  const output = source.slice();
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const alpha = mask[pixel] / 255;
    if (alpha <= 0) continue;
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = Math.round(
        source[offset + channel] * (1 - alpha) + repaired[offset + channel] * alpha
      );
    }
  }
  return output;
}

/**
 * 本地修复使用完整替换核心区，并在外圈采用向修复结果倾斜的缓出羽化。
 * 高召回蒙版已在核心区覆盖阴影和描边，外圈只负责隐藏接缝。
 */
export function compositeLocalRepairRgba(
  source: Uint8ClampedArray,
  repaired: Uint8ClampedArray,
  mask: Uint8Array
) {
  if (source.length !== repaired.length || source.length !== mask.length * 4) {
    throw new Error("背景修复合成数据尺寸不匹配。");
  }
  const output = source.slice();
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel] <= 0) continue;
    const normalized = mask[pixel] / 255;
    const alpha = mask[pixel] >= 254
      ? 1
      : normalized * (2 - normalized);
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = Math.round(
        source[offset + channel] * (1 - alpha) + repaired[offset + channel] * alpha
      );
    }
  }
  return output;
}
