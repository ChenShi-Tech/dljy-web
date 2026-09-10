// 官方发布的日前预测，作为模型预测的对照基线（#2371 后续）。
//
// 云南仅新能源有明确targetDate。负荷capture原始日期语义尚有冲突，
// 不能用另一个PG数据层的注释替代证据；全网总发电也不能当云南省内预测。
//
// 电价则是另一回事：云南平台**不发布**官方电价预测（`da_user_price` 是用户侧统一结算价，
// 不是预测），所以电价没有官方基线可叠，只有实际值（已由后端 actual 提供）。
import { fetchCaptured } from '@/services/captured'

const SLOTS_PER_DAY = 96

type OfficialSource = {
  family: string
  match: string
  /** 行内地区标记：'yn'=云南省内，'all'=南网全网。两者量级不同，不过滤会把两条曲线混成一张图 */
  rowRegion: string
  label: string
}

/** 地区 → 预测目标 → 官方数据源。缺项即该地区该目标无官方预测可叠。 */
const OFFICIAL_SOURCES: Record<string, Record<string, OfficialSource>> = {
  yunnan: {
    renewable: {
      family: 'yn_system_forecast',
      match: 'new_energy_forecast_d1',
      rowRegion: 'yn',
      label: '官方日前新能源预测',
    },
  },
}

export function hasOfficialBaseline(regionId: string, target: string): boolean {
  return Boolean(OFFICIAL_SOURCES[regionId]?.[target])
}

/** 已核实来源与日期语义的地区官方目标，总览与单模型对照共用。 */
export function officialTargetsForRegion(regionId: string): string[] {
  return Object.keys(OFFICIAL_SOURCES[regionId] ?? {})
}

/** 'HH:MM' → 0–95 的时段序号；非法值返回 null（丢弃该行，不静默当成 0 点）。 */
function slotOf(timePoint: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timePoint ?? ''))
  if (!m) return null
  if (Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const slot = (Number(m[1]) * 60 + Number(m[2])) / 15
  return Number.isInteger(slot) && slot >= 0 && slot < SLOTS_PER_DAY ? slot : null
}

/** 交易日 D 的前一天（取数用：D-1 发布的预测，targetDate = D）。 */
function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** 回放行的最小形状：字段一律按 unknown 收，取值时再校验——上游多源共存（南网 CSV / 中广核 API），
 *  不同 feed 的字段完整度不同，声明成确定类型等于替上游打包票。 */
type OfficialRow = { region?: unknown; targetDate?: unknown; operateDate?: unknown; timePoint?: unknown; value?: unknown }
type OfficialEnvelope = { rows?: OfficialRow[]; data?: OfficialRow[] }

export type OfficialBaseline = { points: number[]; label: string; targetDate: string }

/**
 * 取某地区某目标在指定交易日的官方日前预测（96 点）。
 *
 * 取数按operateDate做窗口切片，再严格按targetDate挑曲线，不猜测日期。
 *
 * 无数据 / 点数不全 → 返回 null，调用方不画线；绝不补零或插值凑满 96 点。
 */
export async function fetchOfficialBaseline(
  regionId: string,
  target: string,
  date: string | undefined,
): Promise<OfficialBaseline | null> {
  const src = OFFICIAL_SOURCES[regionId]?.[target]
  if (!src || !date) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return null

  const body = await fetchCaptured<OfficialEnvelope>(src.family, src.match, {
    region: regionId,
    dateFrom: prevDay(date),
    dateTo: date,
  }).catch(() => null)
  const rows: OfficialRow[] = body?.rows || body?.data || []
  if (!rows.length) return null

  const points = new Array<number>(SLOTS_PER_DAY).fill(NaN)
  let filled = 0
  for (const r of rows) {
    if (String(r?.region ?? '') !== src.rowRegion) continue
    if (String(r?.targetDate ?? '') !== date) continue
    const slot = slotOf(r?.timePoint)
    const rawValue = r?.value
    const value = typeof rawValue === 'number' ? rawValue
      : typeof rawValue === 'string' && rawValue.trim() ? Number(rawValue) : NaN
    if (slot === null || !Number.isFinite(value)) continue
    // 同日同槽出现矛盾值不能凭返回顺序挑一个，避免混合发布批次冒充确定曲线。
    if (Number.isFinite(points[slot]) && points[slot] !== value) return null
    if (Number.isNaN(points[slot])) filled += 1
    points[slot] = value
  }
  // 点数不全说明该交易日官方预测缺发或只发了一部分：整条丢弃而不是画一条带缺口的线，
  // 否则据它算出的对照 MAE 只覆盖部分时段，却会被当成全日口径读。
  if (filled < SLOTS_PER_DAY) return null
  return { points, label: src.label, targetDate: date }
}

/** 官方预测相对实际值的平均绝对误差；任一缺失返回 null（不以 0 冒充"无误差"）。 */
export function officialMae(
  points: number[] | undefined,
  actual: (number | null)[] | undefined,
): number | null {
  if (!points?.length || !actual?.length || points.length !== actual.length) return null
  // 只在有真值的时段上算，与后端 `_metrics` 同口径（#2389）。部分出清日的 actual 后半段
  // 是 null，直接参与运算会被 JS 当成 0：`Math.abs(p - null)` === `Math.abs(p)`，
  // 算出的 MAE 大得离谱却完全看不出是错的——比报 null 危险得多。
  let sum = 0
  let n = 0
  points.forEach((p, i) => {
    const a = actual[i]
    if (a == null || !Number.isFinite(a) || !Number.isFinite(p)) return
    sum += Math.abs(p - a)
    n += 1
  })
  return n ? sum / n : null
}
