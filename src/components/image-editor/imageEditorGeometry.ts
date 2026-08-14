import type { ImageGeometryOperation } from "./types";

export interface GeometryRenderResult {
  canvas: HTMLCanvasElement | null;
  source: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * 从原始位图重放几何操作。操作保存为相对坐标，因此撤销、重做和重新载入
 * 都从同一原图计算，避免连续裁剪或旋转累积插值误差。
 */
export function renderImageGeometry(
  source: ImageBitmap,
  operations: readonly ImageGeometryOperation[]
): GeometryRenderResult {
  if (!operations.length) {
    return {
      canvas: null,
      source,
      width: source.width,
      height: source.height
    };
  }

  let current: CanvasImageSource = source;
  let currentWidth = source.width;
  let currentHeight = source.height;

  for (const operation of operations) {
    const next = document.createElement("canvas");
    const context = next.getContext("2d");
    if (!context) throw new Error("当前设备无法处理该图片。");

    if (operation.type === "rotate") {
      next.width = currentHeight;
      next.height = currentWidth;
      if (operation.direction === "clockwise") {
        context.translate(next.width, 0);
        context.rotate(Math.PI / 2);
      } else {
        context.translate(0, next.height);
        context.rotate(-Math.PI / 2);
      }
      context.drawImage(current, 0, 0);
    } else if (operation.type === "flip") {
      next.width = currentWidth;
      next.height = currentHeight;
      if (operation.axis === "horizontal") {
        context.translate(next.width, 0);
        context.scale(-1, 1);
      } else {
        context.translate(0, next.height);
        context.scale(1, -1);
      }
      context.drawImage(current, 0, 0);
    } else {
      const x = Math.max(0, Math.round(operation.x * currentWidth));
      const y = Math.max(0, Math.round(operation.y * currentHeight));
      const width = Math.max(
        1,
        Math.min(currentWidth - x, Math.round(operation.width * currentWidth))
      );
      const height = Math.max(
        1,
        Math.min(currentHeight - y, Math.round(operation.height * currentHeight))
      );
      next.width = width;
      next.height = height;
      context.drawImage(current, x, y, width, height, 0, 0, width, height);
    }

    current = next;
    currentWidth = next.width;
    currentHeight = next.height;
  }

  return {
    canvas: current as HTMLCanvasElement,
    source: current,
    width: currentWidth,
    height: currentHeight
  };
}
