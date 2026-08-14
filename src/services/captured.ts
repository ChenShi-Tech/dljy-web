import { ApiError, clearCaptureAccessDenied, fetchRaw, markCaptureAccessDenied, nextRegionHeaderSeq, unwrap } from '@/services/api'
import { currentRegion } from '@/services/region/regionContext'

// regionDataStatus 与 RegionDataStatus 类型由 api.ts 持有（applyRegionHeaders 在
// unwrap 内统一写入，避免 captured↔api 循环依赖）。此处 re-export 保持
// RegionDataBanner 等现有 `from '@/services/captured'` 导入不变。
export { regionDataStatus } from '@/services/api'
export type { RegionDataStatus } from '@/services/api'

// Fetch REAL captured production data through the server replay layer
// (server/index.mjs -> /api/real, reading data/private/capture-raw/ by default).
// `match` is a filename substring; the largest matching file wins (so a
// full-history capture beats a small default-page one). See data-inventory.md.
//
// 地区维度：当前选中地区(currentRegion)随请求带上 region 参数。后端只回放地区第一级
// capture-raw/<region>/<family>/（#346 阶段B 去扁平回退）——非基线地区无自身采集即落
// 种子/mock 合成或空，绝不串读山西真实口径；仅缺自身真实数据走 mock 时响应头标
// x-data-mock。命中信息由 unwrap 内的 applyRegionHeaders 自动写入 regionDataStatus（见
// api.ts），供 RegionDataBanner 显示。

// 返回的是完整信封 body，其上带 `provenance`（sourceType/realDataConnected + 数据时间
// capturedAt/ingestedAt，见 server 新鲜度透出链）。调用方可用 capturedAtFromProvenance(body)
// 取真实数据时间做新鲜度分级（data/freshness.ts）；MOCK 合成源不带时间字段。向后兼容：
// 既有调用方仍可直接取 rows（body.data/body.rows），本函数返回结构不变。
// 可选载荷级过滤（后端 /api/real ?dateFrom/&dateTo/&limit）：整年大族（单 datasetKey
// 可达 21 万行/~30MB）按需切片。dateFrom/dateTo 按族登记 dateField 闭区间比较（ISO
// 字符串），limit 取尾部（≈最近）。命中过滤时信封带 _filter{total,returned,truncated}。
export interface CapturedFilter {
  dateFrom?: string
  dateTo?: string
  limit?: number
  /**
   * 地区覆盖：默认随全局 currentRegion；地区专属数据消费方（如「云南披露对照」——数据只存在于
   * capture-raw/yunnan 且页面本身就标称云南）传定值固定取数地区，避免顶栏切区后打到别的
   * 地区目录拿空/回退数据。仅影响本次取数，不改全局地区上下文。
   */
  region?: string
}

export async function fetchCaptured<T = any>(family: string, match?: string, filter?: CapturedFilter): Promise<T> {
  const region = filter?.region ?? currentRegion.value.id
  // #1350：发请求前取号——用户快速切换数据族/地区时较早的请求若最后返回，
  // unwrap 的 seq 守卫会跳过其过期地区头，不覆盖 RegionDataBanner 状态。
  const seq = nextRegionHeaderSeq()
  const res = await fetchRaw('/real', {
    family, match, region,
    dateFrom: filter?.dateFrom, dateTo: filter?.dateTo, limit: filter?.limit
  })
  // 复用 unwrap：保持原有「非 ok / code>=400 抛 ApiError」行为；地区命中头由
  // unwrap 内 applyRegionHeaders 自动写入 regionDataStatus（无需在此手动读取）。
  try {
    const body = await unwrap<any>(res, '/real', seq)
    // 同 family 此前被拒、本次成功（如管理员授权后重试）→ 出账（账清空横幅自动熄灭）。
    clearCaptureAccessDenied(family)
    return body as unknown as T
  } catch (err) {
    // Sub-2(#518)：company 私有族被回放层公司授权闸门拒绝（401 未登录 / 403 无该公司授权）。
    // 优雅降级为空信封（rows/data 为空 + accessDenied 标记）而非抛错——页面渲染诚实空态，
    // 拒绝状态按 family 记账进 regionDataStatus 供无权限横幅（Sub-4）消费，混合面板中
    // 公共族成功请求不会冲掉私有族的拒绝态（roborev job144/145）。历史上 /api/real 无鉴权，
    // 不存在依赖 401/403 抛错语义的消费方；其余错误（404/500 等）保持抛出不变。
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      const visibility = res.headers.get('x-data-visibility')
      markCaptureAccessDenied(err.status as 401 | 403, visibility === 'company' || visibility === 'public' ? visibility : null, family)
      return {
        code: err.status,
        rows: [],
        data: [],
        accessDenied: true,
        msg: err.message
      } as unknown as T
    }
    throw err
  }
}

/**
 * 取某族「有采集的业务日期」清单（升序去重）。
 *
 * 服务端 `/api/real-list` 对已登记内容日期索引的族（#1531）会给每个文件带 `date`——
 * 那些族的采集文件名是内容 hash 不含日期，调用方光看文件清单无从知道有哪些天。
 * 此前 `DayAheadReportView` 因此在前端硬编码了一张 91 条的 date→hash 表：**第二份事实源**，
 * 采集扩月即过期，而且和服务端的选文件逻辑各写各的。
 *
 * 未建索引的族返回空数组（不猜、不从文件名正则里抠日期）；401/403 同样返回空数组，
 * 由调用方渲染诚实空态（与 fetchCaptured 的降级口径一致）。
 */
export async function fetchCapturedDates(family: string, region?: string): Promise<string[]> {
  const res = await fetchRaw('/real-list', { family, region: region ?? currentRegion.value.id })
  try {
    const body = await unwrap<any>(res, '/real-list')
    const rows: unknown = body?.data ?? body
    if (!Array.isArray(rows)) return []
    const dates = rows
      .map((r) => (r && typeof r === 'object' ? (r as { date?: unknown }).date : null))
      .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    return [...new Set(dates)].sort()
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return []
    throw err
  }
}
