// 套保工作台组件 spec 的共享辅助（ChenShi-Tech/dljy#3420 外壳 + 页签拆分）。
// 外壳与各页签 spec 共用：overview 样例载荷、把单个页签挂在工作台共享状态之下的挂载器。
// 服务层 mock（hedgeApi / regionContext / companyContext）必须写在各 spec 文件里（vi.mock 按文件提升），
// 本文件只放不依赖 mock 形态的辅助。
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import type { Component } from 'vue'
import { useHedgeWorkbench } from '@/views/hedge/useHedgeWorkbench'
import type { HedgeWorkbench } from '@/views/hedge/useHedgeWorkbench'
import type { HedgeOverview } from '@/services/hedge/hedgeApi'

/** /overview 样例载荷：标注为契约类型 HedgeOverview，spec 覆盖字段（如 value 换成字符串）才是类型正确的。 */
export function overviewPayload(): HedgeOverview {
  return {
    asOf: '2026-09-15T02:00:00Z',
    view: 'CURRENT',
    intervals: [
      { start: '2026-09-15T07:00:00+08:00', end: '2026-09-15T08:00:00+08:00', covered: true,
        generation: { value: '50', source: 'ACTUAL', uncoveredReason: null },
        locked: { midlong: '20', mechanism: { value: '10', note: null }, total: '30' },
        exposure: { withMechanism: '20', midlongOnly: '30' } },
      { start: '2026-09-15T10:00:00+08:00', end: '2026-09-15T11:00:00+08:00', covered: false,
        generation: { value: null, source: 'FORECAST', uncoveredReason: 'FORECAST_NOT_ARRIVED' },
        locked: { midlong: '20', mechanism: { value: null, note: null }, total: null },
        exposure: { withMechanism: null, midlongOnly: null } },
    ],
    ratio: {
      coverage: { coveredCount: 1, totalCount: 2 },
      withMechanism: { value: null, status: 'MECHANISM_INCOMPLETE' },
      midlongOnly: { value: '0.6', status: 'OK' },
    },
    standardMetrics: { TODAY2_INTERVAL: { level: 'NOT_ASSESSED', reason: 'MECHANISM_INCOMPLETE', hints: [], tier: null, basis: 'WITH_MECHANISM' } },
    sensitivity: { value: null, incomplete: true, reference: '30', note: '未计机制电量' },
    watchlist: { rows: [], basisUsed: 'WITH_MECHANISM', note: null, disclaimer: '决策支持参考，不构成自动下单或确定性买卖指令' },
    scheme: null,
    legs: {},
    gaps: [{ code: 'FORECAST_NOT_ARRIVED', message: '明日预测未到达', affected: null }],
  }
}

/**
 * 把单个页签挂在一个最小宿主下：宿主调 useHedgeWorkbench() provide 共享状态（与外壳同一条路径），
 * 共享状态的监听随宿主卸载释放。页签不在 KeepAlive 里，激活即挂载。
 */
export function mountHedgeTab(tab: Component) {
  const holder: { workbench?: HedgeWorkbench } = {}
  const Host = defineComponent({
    name: 'HedgeTabTestHost',
    setup() {
      holder.workbench = useHedgeWorkbench()
      return () => h(tab)
    },
  })
  const wrapper = mount(Host)
  if (!holder.workbench) throw new Error('宿主未创建工作台共享状态')
  return { wrapper, workbench: holder.workbench }
}
