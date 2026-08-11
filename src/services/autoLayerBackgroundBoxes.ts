import type { CutoutSelectionBox } from "@/types";

const MAX_BACKGROUND_BOXES = 32;
const BACKGROUND_BOX_PADDING_RATIO = 0.05;
const MIN_BACKGROUND_BOX_PADDING = 8;
const MAX_BACKGROUND_BOX_PADDING = 48;
const CONNECTED_BOX_PRIMARY_AXIS_COVERAGE = 0.5;
const MAX_MERGED_BACKGROUND_AREA_RATIO = 0.22;

function boxArea(box: CutoutSelectionBox) {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function smallerBoxCoverage(left: CutoutSelectionBox, right: CutoutSelectionBox) {
  const intersectionWidth = Math.max(0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const intersectionHeight = Math.max(0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const smallerArea = Math.min(boxArea(left), boxArea(right));
  return smallerArea > 0 ? intersectionWidth * intersectionHeight / smallerArea : 0;
}

function axisOverlap(leftStart: number, leftSize: number, rightStart: number, rightSize: number) {
  return Math.max(0, Math.min(leftStart + leftSize, rightStart + rightSize) - Math.max(leftStart, rightStart));
}

function shouldMergeConnectedBoxes(left: CutoutSelectionBox, right: CutoutSelectionBox) {
  const overlapX = axisOverlap(left.x, left.width, right.x, right.width);
  const overlapY = axisOverlap(left.y, left.height, right.y, right.height);
  if (overlapX <= 0 || overlapY <= 0) return false;
  const xCoverage = overlapX / Math.min(left.width, right.width);
  const yCoverage = overlapY / Math.min(left.height, right.height);
  return xCoverage >= CONNECTED_BOX_PRIMARY_AXIS_COVERAGE
    || yCoverage >= CONNECTED_BOX_PRIMARY_AXIS_COVERAGE;
}

function unionBoxes(left: CutoutSelectionBox, right: CutoutSelectionBox): CutoutSelectionBox {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return {
    id: boxArea(left) >= boxArea(right) ? left.id : right.id,
    x,
    y,
    width: rightEdge - x,
    height: bottomEdge - y
  };
}

function clampBackgroundBox(
  box: CutoutSelectionBox,
  imageWidth: number,
  imageHeight: number
): CutoutSelectionBox | null {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const right = Math.min(imageWidth, Math.ceil(box.x + box.width));
  const bottom = Math.min(imageHeight, Math.ceil(box.y + box.height));
  if (right <= x || bottom <= y) return null;
  return { ...box, x, y, width: right - x, height: bottom - y };
}

/** 实质叠加的选框只保留面积最大的一个；轻微贴边的独立目标必须保留。 */
export function keepLargestOverlappingBoxes(boxes: readonly CutoutSelectionBox[]) {
  return [...boxes]
    .sort((left, right) => boxArea(right) - boxArea(left))
    .reduce<CutoutSelectionBox[]>((kept, box) => {
      if (!kept.some(existing => smallerBoxCoverage(existing, box) >= 0.65)) kept.push({ ...box });
      return kept;
    }, [])
    .slice(0, MAX_BACKGROUND_BOXES);
}

/**
 * 阴影外扩后沿一个主轴连续相交的 UI 组使用同一个云修复框，避免相邻裁片
 * 分别生成天空、山脊或水流后形成拼图接缝。角部轻微擦边的独立目标不合并。
 */
export function mergeConnectedBackgroundBoxes(
  boxes: readonly CutoutSelectionBox[],
  maximumMergedArea = Number.POSITIVE_INFINITY
) {
  const clusters: CutoutSelectionBox[] = [];
  for (const source of boxes) {
    let merged = { ...source };
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = clusters.length - 1; index >= 0; index -= 1) {
        if (!shouldMergeConnectedBoxes(merged, clusters[index])) continue;
        const candidate = unionBoxes(merged, clusters[index]);
        // A row or column may touch another group at one corner. Do not let
        // that transitive connection turn most of the page into one edit tile.
        if (boxArea(candidate) > maximumMergedArea) continue;
        merged = candidate;
        clusters.splice(index, 1);
        changed = true;
      }
    }
    clusters.push(merged);
  }
  return clusters.sort((left, right) => boxArea(right) - boxArea(left));
}

/** 给整页删除框预留阴影和描边上下文，但不改变素材自身的导出边界。 */
export function expandAutoLayerBackgroundBox(
  box: CutoutSelectionBox,
  imageWidth: number,
  imageHeight: number
) {
  const padding = Math.min(
    MAX_BACKGROUND_BOX_PADDING,
    Math.max(MIN_BACKGROUND_BOX_PADDING, Math.round(Math.max(box.width, box.height) * BACKGROUND_BOX_PADDING_RATIO))
  );
  const left = Math.max(0, Math.floor(box.x - padding));
  const top = Math.max(0, Math.floor(box.y - padding));
  const right = Math.min(imageWidth, Math.ceil(box.x + box.width + padding));
  const bottom = Math.min(imageHeight, Math.ceil(box.y + box.height + padding));
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

export function createAutoLayerBackgroundBoxes(
  boxes: readonly CutoutSelectionBox[],
  imageWidth: number,
  imageHeight: number
) {
  return createAutoLayerBackgroundRegions(boxes, imageWidth, imageHeight).selectionBoxes;
}

/**
 * 云端生成使用外扩、合并框保证上下文连续；最终合成只采用用户原始框选，
 * 避免合并框之间没有被选中的内容被生成结果覆盖。
 */
export function createAutoLayerBackgroundRegions(
  boxes: readonly CutoutSelectionBox[],
  imageWidth: number,
  imageHeight: number
) {
  const compositeBoxes = keepLargestOverlappingBoxes(boxes)
    .map(box => clampBackgroundBox(box, imageWidth, imageHeight))
    .filter((box): box is CutoutSelectionBox => box !== null);
  const selectionBoxes = mergeConnectedBackgroundBoxes(
    compositeBoxes.map(box => ({
      ...expandAutoLayerBackgroundBox(box, imageWidth, imageHeight),
      id: box.id
    })),
    imageWidth * imageHeight * MAX_MERGED_BACKGROUND_AREA_RATIO
  );
  return { selectionBoxes, compositeBoxes };
}
