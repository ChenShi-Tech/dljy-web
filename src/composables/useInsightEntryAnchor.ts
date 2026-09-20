// 洞察入口窗口锚定（dljy#3134，design D3/442 与验收 A02 的修订）
// ----------------------------------------------------------------------------
// 背景：交付口径是「真实历史版」——数据止于最后一个采集日，持续供数待 #2845。原设计
// 「默认窗口为北京时间当日、不自动跳到有数据的日子」在数据停止更新后让每次进页都落在
// 满屏空态上，实际不可用。修订后：URL 完全没带 start/end 进入页面时，对公开 capture
// 分析做一次覆盖扫描，把默认业务窗锚定到候选中的最新有数据日（单日窗），并给一次性
// 提示与「切回今天」；除此之外的行为（显式参数、刷新恢复、后退、下钻 hx_ 恢复）不变。
//
//   - 锚定分析固定用 supply.system-series：全部来源为公开 capture（runCoverage 对纯
//     capture 来源不受单分析 maxDays 限制），无需获权，系统曲线的采集末端即「工作区
//     公共面的最新有数据日」；
//   - 扫描窗 [今日-365, 今日]，一次请求覆盖契约允许的 366 天上限以内；
//   - 会话内记忆：同一 SPA 会话同地区只扫一次，页间导航复用结果不再请求；
//   - 诚实边界：锚定只改「默认落点」，不伪装供数——提示原文写明今日无数据与锚定日；
//     最新有数据日就是今天、或扫描失败/无候选时，保持当日默认且不提示不报错；
//   - 竞态：扫描在途时用户已手动改过窗口、或组件已卸载，锚定不再写入（迟到作废）。
import { onScopeDispose, ref, watch, type Ref } from 'vue'

import { beijingToday } from 'shared/midlong/dates.mjs'
import { getInsightAnalysis } from 'shared/insight/analyses.mjs'
import { getInsightSource } from 'shared/insight/sources.mjs'
import { fetchInsightCoverage } from '@/services/insight/insightClient'

/** 锚定用的公开分析（见文件头说明；改这里要同步 dljy#3134 的说明与用例）。 */
const ANCHOR_ANALYSIS_ID = 'supply.system-series'
/** 扫描窗天数：契约上下文窗口上限 366 天，取 365 留出闭区间余量。 */
const ANCHOR_SCAN_DAYS = 365

/** 会话级锚定记忆：regionId → 最新有数据日（SPA 生存期内数据视为不变，刷新重扫）。 */
const sessionAnchor = new Map<string, string>()

export type InsightAnchorNotice = {
  /** 进入页面时请求的默认日（北京时间今日）。 */
  requested: string
  /** 实际锚定到的最新有数据日。 */
  anchoredTo: string
}

export type InsightEntryAnchor = {
  anchorNotice: Ref<InsightAnchorNotice | null>
  dismissAnchorNotice: () => void
  backToToday: () => void
}

type AnchorContext = {
  regionId: Ref<string>
  businessWindow: Ref<{ start: string; end: string }>
  hadWindowParam: boolean
  setBusinessWindow: (start: string, end: string) => void
  toQueryContext: () => {
    regionId: string
    businessWindow: { start: string; end: string }
    [key: string]: unknown
  }
}

/** YYYY-MM-DD 往前推 n 天（UTC 日历运算，与 beijingToday 的口径一致）。 */
function daysBefore(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day - days))
  const pad2 = (value: number) => String(value).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/**
 * 锚定扫描只按云南实际来源求交集（与供需页历史候选同口径，dljy#3134）：
 * 该分析的来源集里还挂着南网背景与多条预测源，它们的覆盖更短更稀，
 * 若一并求交集，任一预测源断档就会把候选拖空或把锚点拖旧——
 * 主公开序列有更新数据时应锚到它。空数组时不下发该键（缺省=按分析全部来源）。
 */
const ANCHOR_REQUIRED_SOURCE_IDS = (getInsightAnalysis(ANCHOR_ANALYSIS_ID)?.sourceIds ?? [])
  .filter((sourceId) => {
    const source = getInsightSource(sourceId)
    return source?.businessScope === 'yunnan' && source.variant === 'actual'
  })

export function useInsightEntryAnchor(ctx: AnchorContext, options?: { ready?: Ref<unknown> }): InsightEntryAnchor {
  const anchorNotice = ref<InsightAnchorNotice | null>(null)

  function dismissAnchorNotice(): void {
    anchorNotice.value = null
  }

  function backToToday(): void {
    const notice = anchorNotice.value
    if (!notice) return
    ctx.setBusinessWindow(notice.requested, notice.requested)
    anchorNotice.value = null
  }

  /** 窗口仍是进入时的默认当日（未被用户或下钻改动）才允许锚定写入。 */
  function windowUntouched(today: string): boolean {
    return ctx.businessWindow.value.start === today && ctx.businessWindow.value.end === today
  }

  function applyAnchor(today: string, latest: string): void {
    if (latest >= today) return
    if (!windowUntouched(today)) return
    ctx.setBusinessWindow(latest, latest)
    anchorNotice.value = { requested: today, anchoredTo: latest }
  }

  // 鉴权门：能力目录未就绪（未登录/公共账号加载失败）前不扫锚定——公共账号保持零请求红线。
  function run(): void {
    if (ctx.hadWindowParam) return
    const today = beijingToday()
    const regionId = ctx.regionId.value
    const cached = sessionAnchor.get(regionId)
    if (cached) {
      applyAnchor(today, cached)
    } else {
      const controller = new AbortController()
      const context = { ...ctx.toQueryContext(), businessWindow: { start: daysBefore(today, ANCHOR_SCAN_DAYS), end: today } }
      fetchInsightCoverage(
        {
          analysisId: ANCHOR_ANALYSIS_ID,
          context,
          filters: { view: 'series' },
          ...(ANCHOR_REQUIRED_SOURCE_IDS.length ? { requiredSourceIds: ANCHOR_REQUIRED_SOURCE_IDS } : {}),
        },
        { signal: controller.signal },
      ).then((result) => {
        const dates = result.candidates.dates ?? []
        const rangeEnds = (result.candidates.ranges ?? []).map((range) => range.end)
        const latest = [...dates, ...rangeEnds].sort().at(-1)
        if (!latest) return
        sessionAnchor.set(regionId, latest)
        applyAnchor(today, latest)
      }).catch(() => {
        // 锚定是锦上添花：失败静默保持当日默认，不引入新的错误态（诚实空态仍由区块表达）。
      })
    // 组件卸载即中止在途扫描；迟到响应即使到达也会因 windowUntouched 守卫而不写入。
    try {
      onScopeDispose(() => controller.abort())
    } catch {
      // 非 setup 上下文（如单测直接调用）：无生命周期可挂，靠 windowUntouched 守卫兜底。
    }
    }
  }

  // 真值门（非 null 门）：页面传入的是布尔 computed——公共账号恒为 false，
  // 若只判 != null 会立即放行扫描，击穿「公共账号零请求」红线。
  if (options?.ready) {
    if (options.ready.value) run()
    else {
      const stop = watch(options.ready, () => {
        if (options.ready?.value) {
          stop()
          run()
        }
      })
    }
  } else {
    run()
  }

  return { anchorNotice, dismissAnchorNotice, backToToday }
}
