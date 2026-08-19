// 电网节点名结构化解析 L0（Epic #1431 S4 · #1439 第①项）
// ----------------------------------------------------------------------------
// 从南网节点电价的 `nodeName` 字符串里提取电压等级与变电站/电厂名两个结构化字段，
// 供节点管理补录（`voltageLevelKv`）与后续站级聚合使用。
//
// 红线：只做纯文本结构化，把名称里已经写明的信息拆出来，不推断任何未写明的东西。
// 不从名称推测节点之间的连接关系（「禁推测拓扑」红线），不按地名猜行政区划，
// 名称里没有电压就诚实返回 null，绝不用同站其它节点的值回填。
//
// 运行时零依赖（无 import、无 alias）：审计脚本可用 `node --experimental-strip-types`
// 直接加载，与 spotPriceCore 同一约束。
//
// 真实数据形态（南网五省 6,599 个唯一节点名全量统计，2026-08-06）
// 全部含 `.` 分隔，形如 `<站段>.<节点段>`：
// A 型（631 个）站段自带电压前缀：`110kV上洪站.110kV#1母`
// B 型（5,968 个）站段是纯站名：   `卧龙变.500kV#2M`、`双水B厂.220_KV#2`
// 电压书写变体：`500kV` / `220_KV` / `220kV_`（下划线位置不定、KV 大小写不定）。
//
// 两段电压不一致是常态而非脏数据（实测 145 例）：`220kV三都站.110kV#1母` 表示
// 「220kV 变电站里的 110kV 母线节点」，站段是站的电压等级，节点段是该节点自身的
// 电压等级。`voltageLevelKv` 描述节点，故以节点段为准，站段电压另出 `stationVoltageKv`
// 字段，两者都保留、不合并。
//
// 覆盖率：6,175 / 6,599 = 93.6% 可解出电压；余下 424 个（如
// `云峰村光伏电站.云峰村光伏电站云家线`）名称里确实不含电压，返回 unresolved。

/** 电压书写变体：数字 + 可选空白/下划线 + kV（大小写不限）。 */
const VOLTAGE_PATTERN = /(\d+)\s*_?\s*[kK][vV]/
/** 站段前缀形态的电压（用于剥离站名前缀），必须锚定行首。 */
const LEADING_VOLTAGE_PATTERN = /^\s*\d+\s*_?\s*[kK][vV]\s*/
/** 合理电压区间（kV）：与 grid-geo API 的 voltageLevelKv 校验一致，越界视为不可信。 */
const MIN_VOLTAGE_KV = 1
const MAX_VOLTAGE_KV = 1000

/** 电压等级的判定来源，UI 需要据此说明「这个值是怎么来的」，未解析时说明原因。 */
export type NodeVoltageBasis =
  /** 取自节点段（该节点自身的电压等级，权威口径） */
  | 'node-segment'
  /** 节点段无电压，回退站段前缀（站级电压，可能高于节点实际电压） */
  | 'station-prefix'
  /** 名称中不含可识别的电压书写，诚实留空 */
  | 'unresolved'

export type ParsedNodeName = {
  /** 节点自身电压等级（kV）。无法从名称判定时为 null，不猜、不用同站其它节点回填。 */
  voltageLevelKv: number | null
  /** 变电站 / 电厂名（站段去掉电压前缀后的剩余）。无法判定时为 null。 */
  stationName: string | null
  /**
   * 站段前缀声明的电压等级（kV）。与 `voltageLevelKv` **可以不同且不是错误**：
   * `220kV三都站.110kV#1母` → station 220 / node 110。仅在站段自带前缀时非 null。
   */
  stationVoltageKv: number | null
  /** `voltageLevelKv` 的判定来源，供 UI 标注与审计追溯。 */
  basis: NodeVoltageBasis
}

const EMPTY: ParsedNodeName = {
  voltageLevelKv: null,
  stationName: null,
  stationVoltageKv: null,
  basis: 'unresolved'
}

/** 从片段中取第一个合理电压值；无匹配或越界返回 null。 */
function extractVoltage(segment: string): number | null {
  const matched = VOLTAGE_PATTERN.exec(segment)
  if (!matched) return null
  const value = Number(matched[1])
  if (!Number.isFinite(value) || value < MIN_VOLTAGE_KV || value > MAX_VOLTAGE_KV) return null
  return value
}

/**
 * 解析节点名为结构化字段。纯函数、无副作用、不访问网络或存储。
 *
 * @param nodeName 原始节点名，如 `220kV三都站.110kV#1母`
 * @returns 解析结果；任一字段无法从名称判定时为 null（诚实空态，不推断）
 */
export function parseGridNodeName(nodeName: string): ParsedNodeName {
  const raw = typeof nodeName === 'string' ? nodeName.trim() : ''
  if (!raw) return { ...EMPTY }

  // 按第一个点分段：节点段自身可能含点（线路描述），只切一刀。
  const dotIndex = raw.indexOf('.')
  const stationSegment = dotIndex === -1 ? raw : raw.slice(0, dotIndex)
  const nodeSegment = dotIndex === -1 ? '' : raw.slice(dotIndex + 1)

  const stationVoltageKv = LEADING_VOLTAGE_PATTERN.test(stationSegment)
    ? extractVoltage(stationSegment)
    : null
  const nodeVoltageKv = extractVoltage(nodeSegment)

  // 优先节点段（节点自身电压），其次站段前缀（站级，可能偏高），都无则诚实留空。
  let voltageLevelKv: number | null = null
  let basis: NodeVoltageBasis = 'unresolved'
  if (nodeVoltageKv !== null) {
    voltageLevelKv = nodeVoltageKv
    basis = 'node-segment'
  } else if (stationVoltageKv !== null) {
    voltageLevelKv = stationVoltageKv
    basis = 'station-prefix'
  }

  const stationName = stationSegment.replace(LEADING_VOLTAGE_PATTERN, '').trim() || null

  return { voltageLevelKv, stationName, stationVoltageKv, basis }
}
