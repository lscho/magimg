/**
 * 分层抠图的纯计算服务：对同一原图坐标系下的 alpha 遮罩（0..255）做
 * 布尔运算、候选去重与包含关系分析，把候选子遮罩组织成 PSD 风格的图层树。
 *
 * 所有遮罩必须与原图等尺寸（width * height）。像素级二元运算统一采用
 * 软 alpha 语义：交集取 min、并集取 max、减法按剩余覆盖率相乘，
 * 保证精修后的柔和边缘在图层间过渡自然。
 */

export interface CutoutLayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 参与分层的一张遮罩：id 由调用方分配，score 为 decoder 的 IoU 评分。 */
export interface CutoutLayerSource {
  id: string;
  alpha: Uint8Array;
  score?: number;
}

export interface CutoutLayerNode {
  id: string;
  /** 已裁剪到父层范围内的 alpha 遮罩。 */
  alpha: Uint8Array;
  /** 软面积（alpha 总和 / 255），用于排序与过滤。 */
  area: number;
  /** alpha ≥ 阈值像素的外接框；空遮罩为 null。 */
  bounds: CutoutLayerBounds | null;
  score: number;
  children: CutoutLayerNode[];
}

export interface CutoutLayeringOptions {
  /** 候选间 IoU 超过该值视为重复，仅保留评分更高者。 */
  dedupeIouThreshold?: number;
  /** 候选与根遮罩的包含率低于该值时丢弃（不属于该元素）。 */
  minContainment?: number;
  /** 一张遮罩被另一张包含到该比例以上时，嵌套为其子层。 */
  containmentThreshold?: number;
  /** 相对根遮罩面积的下限，低于视为噪声。 */
  minAreaRatio?: number;
  /** 相对根遮罩面积的上限，高于视为根遮罩的重复。 */
  maxAreaRatio?: number;
}

const DEFAULT_OPTIONS: Required<CutoutLayeringOptions> = {
  dedupeIouThreshold: 0.85,
  minContainment: 0.6,
  containmentThreshold: 0.7,
  minAreaRatio: 0.002,
  maxAreaRatio: 0.9
};

/** bounds 计算时视为「有内容」的最低 alpha。 */
const BOUNDS_ALPHA_THRESHOLD = 8;

function assertPlane(alpha: Uint8Array, width: number, height: number) {
  if (alpha.length !== width * height) {
    throw new Error("遮罩尺寸与图片不匹配，无法执行分层计算。");
  }
}

/** 软面积：alpha 总和 / 255。 */
export function maskArea(alpha: Uint8Array): number {
  let sum = 0;
  for (let index = 0; index < alpha.length; index += 1) sum += alpha[index];
  return sum / 255;
}

/** alpha ≥ 阈值像素的外接框；空遮罩返回 null。 */
export function maskBounds(
  alpha: Uint8Array,
  width: number,
  height: number,
  threshold = BOUNDS_ALPHA_THRESHOLD
): CutoutLayerBounds | null {
  assertPlane(alpha, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (alpha[row + x] >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 交集：逐像素取 min。 */
export function intersectMasks(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) {
    throw new Error("遮罩尺寸不一致，无法执行分层计算。");
  }
  const output = new Uint8Array(a.length);
  for (let index = 0; index < a.length; index += 1) {
    output[index] = Math.min(a[index], b[index]);
  }
  return output;
}

/** 并集：逐像素取 max。 */
export function unionMasks(masks: readonly Uint8Array[]): Uint8Array {
  if (!masks.length) {
    throw new Error("没有可合并的遮罩。");
  }
  const output = new Uint8Array(masks[0].length);
  for (const mask of masks) {
    if (mask.length !== output.length) {
      throw new Error("遮罩尺寸不一致，无法执行分层计算。");
    }
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] > output[index]) output[index] = mask[index];
    }
  }
  return output;
}

/** 减法：base 乘以 remove 的剩余覆盖率，保留柔和边缘过渡。 */
export function subtractMask(base: Uint8Array, remove: Uint8Array): Uint8Array {
  if (base.length !== remove.length) {
    throw new Error("遮罩尺寸不一致，无法执行分层计算。");
  }
  const output = new Uint8Array(base.length);
  for (let index = 0; index < base.length; index += 1) {
    output[index] = Math.round((base[index] * (255 - remove[index])) / 255);
  }
  return output;
}

/** 两个外接框的交集区域；不相交返回 null。 */
function boundsIntersection(
  a: CutoutLayerBounds | null,
  b: CutoutLayerBounds | null
): CutoutLayerBounds | null {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** 只在外接框交集内累加 min，避免全图扫描。 */
function softIntersectionArea(
  a: Uint8Array,
  b: Uint8Array,
  region: CutoutLayerBounds | null,
  width: number
): number {
  if (!region) return 0;
  let sum = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    const row = y * width;
    for (let x = region.x; x < region.x + region.width; x += 1) {
      sum += Math.min(a[row + x], b[row + x]);
    }
  }
  return sum / 255;
}

interface MeasuredMask {
  source: CutoutLayerSource;
  alpha: Uint8Array;
  area: number;
  bounds: CutoutLayerBounds | null;
}

function measureMask(source: CutoutLayerSource, width: number, height: number): MeasuredMask {
  assertPlane(source.alpha, width, height);
  return {
    source,
    alpha: source.alpha,
    area: maskArea(source.alpha),
    bounds: maskBounds(source.alpha, width, height)
  };
}

/** 软 IoU = |min| / (|a| + |b| - |min|)。 */
function measuredIoU(a: MeasuredMask, b: MeasuredMask, width: number): number {
  const intersection = softIntersectionArea(
    a.alpha,
    b.alpha,
    boundsIntersection(a.bounds, b.bounds),
    width
  );
  const union = a.area + b.area - intersection;
  return union > 0 ? intersection / union : 0;
}

/** child 被 parent 覆盖的比例 = |min| / |child|。 */
function measuredContainment(child: MeasuredMask, parent: MeasuredMask, width: number): number {
  if (child.area <= 0) return 0;
  const intersection = softIntersectionArea(
    child.alpha,
    parent.alpha,
    boundsIntersection(child.bounds, parent.bounds),
    width
  );
  return intersection / child.area;
}

/** 贪心 NMS：按评分降序保留，IoU 超阈值的后来者丢弃。 */
export function dedupeLayerSources(
  candidates: readonly CutoutLayerSource[],
  width: number,
  height: number,
  iouThreshold = DEFAULT_OPTIONS.dedupeIouThreshold
): CutoutLayerSource[] {
  const measured = candidates
    .map((candidate) => measureMask(candidate, width, height))
    .sort((a, b) => (b.source.score ?? 0) - (a.source.score ?? 0));
  const kept: MeasuredMask[] = [];
  for (const candidate of measured) {
    if (candidate.area <= 0) continue;
    const duplicated = kept.some(
      (existing) => measuredIoU(candidate, existing, width) >= iouThreshold
    );
    if (!duplicated) kept.push(candidate);
  }
  return kept.map((mask) => mask.source);
}

/**
 * 把候选子遮罩组织成以 root 为根的图层树：
 * 1. 每个候选先裁剪到根遮罩内，包含率或面积不合格的丢弃；
 * 2. 候选间按 IoU 去重；
 * 3. 按面积降序插入，嵌套到「包含它的最深已有节点」下——
 *    遮罩的包含关系天然构成 PSD 图层树。
 */
export function buildCutoutLayerTree(
  root: CutoutLayerSource,
  candidates: readonly CutoutLayerSource[],
  width: number,
  height: number,
  options?: CutoutLayeringOptions
): CutoutLayerNode {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const measuredRoot = measureMask(root, width, height);
  const rootNode: CutoutLayerNode = {
    id: root.id,
    alpha: measuredRoot.alpha,
    area: measuredRoot.area,
    bounds: measuredRoot.bounds,
    score: root.score ?? 0,
    children: []
  };
  if (measuredRoot.area <= 0) return rootNode;

  const clipped: MeasuredMask[] = [];
  for (const candidate of candidates) {
    const measured = measureMask(candidate, width, height);
    if (measured.area <= 0) continue;
    if (measuredContainment(measured, measuredRoot, width) < resolved.minContainment) {
      continue;
    }
    const clippedMeasured = measureMask(
      { ...candidate, alpha: intersectMasks(measured.alpha, measuredRoot.alpha) },
      width,
      height
    );
    const areaRatio = clippedMeasured.area / measuredRoot.area;
    if (areaRatio < resolved.minAreaRatio || areaRatio > resolved.maxAreaRatio) {
      continue;
    }
    clipped.push(clippedMeasured);
  }

  const deduped: MeasuredMask[] = [];
  for (const candidate of clipped.sort(
    (a, b) => (b.source.score ?? 0) - (a.source.score ?? 0)
  )) {
    const duplicated = deduped.some(
      (existing) => measuredIoU(candidate, existing, width) >= resolved.dedupeIouThreshold
    );
    if (!duplicated) deduped.push(candidate);
  }

  const nodes = new Map<CutoutLayerNode, MeasuredMask>();
  nodes.set(rootNode, measuredRoot);
  for (const candidate of deduped.sort((a, b) => b.area - a.area)) {
    const node: CutoutLayerNode = {
      id: candidate.source.id,
      alpha: candidate.alpha,
      area: candidate.area,
      bounds: candidate.bounds,
      score: candidate.source.score ?? 0,
      children: []
    };
    let parent = rootNode;
    let descended = true;
    while (descended) {
      descended = false;
      for (const child of parent.children) {
        const childMeasured = nodes.get(child);
        if (
          childMeasured &&
          measuredContainment(candidate, childMeasured, width) >=
            resolved.containmentThreshold
        ) {
          parent = child;
          descended = true;
          break;
        }
      }
    }
    parent.children.push(node);
    nodes.set(node, candidate);
  }
  return rootNode;
}

/**
 * 节点的「背景层」遮罩 = 自身减去全部直接子层的并集。
 * 该遮罩区域后续交给修复（inpainting）补全被子层覆盖的底色。
 */
export function layerBackgroundAlpha(node: CutoutLayerNode): Uint8Array {
  if (!node.children.length) return node.alpha.slice();
  return subtractMask(node.alpha, unionMasks(node.children.map((child) => child.alpha)));
}
