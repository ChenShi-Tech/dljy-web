/**
 * 浮动卡片的拖动钳制
 * ------------------------------------------------------------------
 * 选中卡片默认贴在舞台右下。两个问题要一起解决：
 *
 * 1. 打开右侧的完整信息抽屉后，卡片正好被压在抽屉底下——用户看不到自己刚点的那个电厂。
 * 2. 卡片挡住了地图上想看的区域时，没有办法挪开它。
 *
 * 于是卡片可拖动，并在抽屉打开时整体左移让位。拖出舞台会让卡片再也拖不回来（指针
 * 已经不在卡片上），所以偏移必须钳制在舞台内——这里只做纯计算，事件绑定在组件里。
 */

export interface Rect {
  width: number
  height: number
}

export interface CardOffset {
  x: number
  y: number
}

/** 卡片任何时候都至少留这么多像素在舞台内，保证还能被抓住。 */
export const MIN_VISIBLE_PX = 48

/**
 * 把拖动偏移钳制到「卡片仍有一部分留在舞台内」的范围。
 *
 * @param offset    期望偏移（相对卡片默认位置，右下角锚定，x 向左为正）
 * @param card      卡片尺寸
 * @param stage     舞台尺寸
 * @param baseRight 卡片默认距舞台右边的距离
 * @param baseBottom 卡片默认距舞台底边的距离
 */
export function clampCardOffset(
  offset: CardOffset,
  card: Rect,
  stage: Rect,
  baseRight: number,
  baseBottom: number,
): CardOffset {
  if (!(stage.width > 0) || !(stage.height > 0)) return { x: 0, y: 0 }
  // x 向左为正：最多把卡片推到左边缘（再多就整个滑出左侧）
  const maxLeft = Math.max(0, stage.width - card.width - baseRight)
  // 向右最多让卡片只剩 MIN_VISIBLE_PX 贴在右边缘内
  const maxRight = Math.max(0, baseRight + card.width - MIN_VISIBLE_PX)
  // y 向上为正
  const maxUp = Math.max(0, stage.height - card.height - baseBottom)
  const maxDown = Math.max(0, baseBottom + card.height - MIN_VISIBLE_PX)
  return {
    x: Math.min(maxLeft, Math.max(-maxRight, offset.x)),
    y: Math.min(maxUp, Math.max(-maxDown, offset.y)),
  }
}

/**
 * 抽屉打开时卡片要额外左移多少。
 *
 * 卡片默认已经距右边 `baseRight`，抽屉宽 `drawerWidth`；只有当抽屉会盖住卡片时才让位，
 * 已经在抽屉左边的不动——无条件左移会让卡片在宽屏上莫名其妙跑到中间。
 */
export function drawerAvoidanceShift(
  drawerOpen: boolean,
  drawerWidth: number,
  baseRight: number,
  gap = 16,
): number {
  if (!drawerOpen) return 0
  const overlap = drawerWidth + gap - baseRight
  return overlap > 0 ? overlap : 0
}
