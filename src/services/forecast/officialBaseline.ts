// 官方发布的日前预测，作为模型预测的对照基线（#2371 后续）。
//
// 为什么只有新能源：云南平台发布的几条曲线里，只有 `new_energy_forecast_d1` 带**显式
// `targetDate`**（= `operateDate + 1`，真·D-1 日前预测），口径不用猜。`load_forecast` 的
// `targetDate` 恒为 null，只能靠「与实际值误差最小」反推日期对齐，而实测两段数据结论互相矛盾：
// 早期南网 CSV 段指向 D-1（56%），#2373 补入的中广核 API 段指向 D+0（46%），都不干净。
// 口径不明的基线比没有基线更危险——用户会据此判断模型赢了还是输了，实际却是错位比较。
// 因此负荷暂不接，待向数据方确认 `load_forecast` 的 targetDate 语义后再开。
//
// 电价则是另一回事：云南平台**不发布**官方电价预测（`da_user_price` 是日前用户侧结算价，
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
      label: '官方日前预测',
    },
  },
}

export function hasOfficialBaseline(regionId: string, target: string): boolean {
  return Boolean(OFFICIAL_SOURCES[regionId]?.[target])
}

/** 'HH:MM' → 0–95 的时段序号；非法值返回 null（丢弃该行，不静默当成 0 点）。 */
function slotOf(timePoint: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timePoint ?? ''))
  if (!m) return null
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
type OfficialRow = { region?: unknown; targetDate?: unknown; timePoint?: unknown; value?: unknown }
type OfficialEnvelope = { rows?: OfficialRow[]; data?: OfficialRow[] }

export type OfficialBaseline = { points: number[]; label: string; targetDate: string }

/**
 * 取某地区某目标在指定交易日的官方日前预测（96 点）。
 *
 * 取数按 `operateDate`（回放层唯一支持切片的字段）拉 D-1..D 两天，再按 `targetDate === date`
 * 精确挑出那条曲线——**不能只按 operateDate 认**，`operateDate` 是发布日、比交易日早一天，
 * 直接拿会整体错一天（本仓 `drrq` 已有同款教训）。
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
    const value = Number(r?.value)
    if (slot === null || !Number.isFinite(value)) continue
    if (Number.isNaN(points[slot])) filled += 1
    points[slot] = value
  }
  // 点数不全说明该交易日官方预测缺发或只发了一部分：整条丢弃而不是画一条带缺口的线，
  // 否则据它算出的对照 MAE 只覆盖部分时段，却会被当成全日口径读。
  if (filled < SLOTS_PER_DAY) return null
  return { points, label: src.label, targetDate: date }
}

/** 官方预测相对实际值的平均绝对误差；任一缺失返回 null（不以 0 冒充"无误差"）。 */
export function officialMae(points: number[] | undefined, actual: number[] | undefined): number | null {
  if (!points?.length || !actual?.length || points.length !== actual.length) return null
  const sum = points.reduce((acc, p, i) => acc + Math.abs(p - actual[i]), 0)
  return sum / points.length
}
