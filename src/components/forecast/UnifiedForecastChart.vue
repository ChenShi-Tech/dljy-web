<script setup lang="ts">
// 统一结果图（Phase 1 / PR-A）。把一个或多个 UnifiedForecastResult 画到同一张图：
//  - 单算法：曲线 + P10/P90 区间带（若有）。
//  - 多算法：各算法曲线叠加（模式 B 同台对比的可视化底座）。
// 时间轴按结果 granularity 自适应 24/96 点。纯展示组件，PR-B 工作台直接复用。
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import type { SeriesOption } from 'echarts'
import { useEChart } from '../../composables/useEChart'
import type { UnifiedForecastResult } from '@/services/forecast/forecastProviders'

const props = defineProps<{
  // untrustedTag：调用方算好的「这条曲线为何不可信」短标签（占位/合成/示意/未过门禁）。
  // 有些不可信情形靠 result 本身看不出来，例如模型返回了 captured 数据但单日质量门禁
  // 判负（metrics.passes_gate=false），若不由调用方告知，图层会把它画成普通实线，
  // 只看曲线的人会当它可信。
  results: { provider: string; result: UnifiedForecastResult; untrustedTag?: string }[]
  height?: number
  /**
   * 真实值替代预测（#2389）：有真值的时段把预测曲线裁掉（置 null 断开），只在没有真值的
   * 时段画预测——横轴仍是目标日**一天**，实线（已出清）与虚线（待出清）在同一天内衔接。
   * 关闭时两条线各画各的，用来看模型在已发生时段贴不贴。
   */
  mergeActual?: boolean
}>()

const PALETTE = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399', '#9b59b6', '#1abc9c', '#3498db']
// 真值与基线不参与 PALETTE 轮转：它们是**参照系**而非又一个算法，配色必须与所有算法都不同，
// 否则多算法同台时用户会把「实际值」当成第 N 个模型（#2371）。
const ACTUAL_COLOR = '#303133'   // 近墨：事实层，视觉上压过所有预测线
const NAIVE_COLOR = '#C0C4CC'    // 浅灰：参照下限，退到背景
const OFFICIAL_COLOR = '#795548' // 棕：外部权威。刻意选 PALETTE 里没有的色系——官方预测是
                                 // 对照基线而非又一个算法，配色撞上任何一个算法色都会被读错

// #764 区间带校准标注（仅单算法且有分位带时）：conformal=true → 标注名义覆盖率+共形校准；
// false → 标注模型分位·未校准；metrics 缺字段（非概率预测）→ 无标注。覆盖率一律由 nominal_coverage
// 计算，禁止硬编码 80%/90% 字样。
// 有真值 = 目标日已发生 = 本次是历史回测（后端 target_date 必须落在已有数据范围内）。
// 不标出来，用户容易把工作台的结果当成对未来的预测（#2371）。
const backtestCaption = computed(() => {
  if (props.results.some((r) => r.result.evaluationMode === 'forecast')) {
    // 无真值日：必须说清「没有实际值可比」，否则空荡荡的图会被当成「模型没算出来」
    return '目标日尚未出清 · 无实际值可比，因此不给出任何精度指标'
  }
  // 部分出清：实线只覆盖已出清的时段，其后是纯预测。不点明的话，一条中途断掉的实际值
  // 曲线看起来像数据丢了，而右半边的指标又会被当成全天精度。
  const partial = props.results.find((r) => r.result.evaluationMode === 'partial')
  if (partial) {
    const n = (partial.result.actual ?? []).filter((v) => v != null).length
    return `目标日仅 ${n}/${partial.result.actual?.length ?? 0} 个时段已出清 · 实线为已发生的真值，`
      + '其后为预测；精度指标只基于已出清的那部分时段'
  }
  return props.results.some((r) => r.result.actual?.length && r.result.evaluationMode === 'backtest')
    ? '实际值为目标日事后真值 · 本次为历史回测（目标日已发生），非对未来的预测'
    : ''
})

const bandCaption = computed(() => {
  const single = props.results.length === 1 ? props.results[0].result : null
  if (!single?.lower?.length || !single?.upper?.length) return ''
  const m = single.metrics
  if (!m) return ''
  if (m.conformal === true) {
    const cov = m.nominal_coverage != null ? ` · ${Math.round(m.nominal_coverage * 100)}% 覆盖` : ''
    return `P10–P90 区间${cov} · 共形校准`
  }
  if (m.conformal === false) {
    return 'P10–P90 区间（模型分位·未校准）'
  }
  return ''
})

function labelsFor(granularity: 24 | 96): string[] {
  const n = granularity
  const step = granularity === 96 ? 15 : 60
  return Array.from({ length: n }, (_, i) => {
    const m = i * step
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  })
}

const el = ref<HTMLDivElement | null>(null)

function render() {
  if (!el.value) return
  const items = props.results
  const granularity = (items[0]?.result.granularity ?? 96) as 24 | 96
  // 横轴恒为目标日**一天**：真值与预测的边界在同一天内按时段划分，不再把前一天铺进来。
  // 铺两天时前半屏是已经翻篇的昨天，真正要看的目标日被挤到右半边。
  const labels = labelsFor(granularity)
  const unit = items[0]?.result.unit ?? ''
  const series: SeriesOption[] = []

  // 单算法且有区间 → 画区间带
  if (items.length === 1 && items[0].result.lower?.length && items[0].result.upper?.length) {
    const { lower, upper } = items[0].result
    series.push(
      { name: '下界', type: 'line', data: lower, lineStyle: { opacity: 0 }, stack: 'band', symbol: 'none', silent: true },
      {
        name: 'P10–P90 区间', type: 'line', data: upper!.map((u, i) => u - lower![i]),
        lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(64,158,255,0.15)' }, stack: 'band', symbol: 'none', silent: true,
      },
    )
  }
  // 电价类预测(单位含"元")按时段恒定→阶梯线；负荷/出力连续量→直线
  // labelsFor 为时段起点标签(i*step，首点 00:00)，须用 step:'end' 让横段保持当前点值，'start' 会整体错位一格(#335)
  const isPrice = /元/.test(String(unit))
  // 占位/示意结果必须一眼可辨：虚线 + 图例后缀「（占位）」。多算法同台时，若占位曲线与真实
  // 曲线长得一模一样，用户只能靠记住自己勾了哪个来分辨，同台对比正是最容易看混的场景。
  // 判据取「result.mock 或 basis 为 illustrative/synthetic」：真实模型在数据缺失时也会落到
  // 合成兜底（basis=synthetic 而 mock 仍为 false），那条线同样不可按真实精度读。
  // 目标日事后真值（#2371）：先 push 保证图例排第一，z 抬高保证压在所有预测线之上。
  // 只画一次——多算法同台时各算法的 actual 是同一条（同地区/目标/日期），画 N 次是重复墨迹。
  const withActual = items.find((it) => it.result.actual?.length)
  if (withActual) {
    series.push({
      name: '实际值', type: 'line', ...(isPrice ? { step: 'end' as const } : {}), showSymbol: false,
      // 含 null 的时段（尚未出清）由 ECharts 自然断开——实线只覆盖已发生的部分
      data: withActual.result.actual as (number | null)[],
      lineStyle: { width: 2.6, color: ACTUAL_COLOR }, itemStyle: { color: ACTUAL_COLOR }, z: 3,
    })
    // 官方日前预测：单算法与多算法同台都画。它是**所有**算法共同的标尺——跑赢「昨日同时段」
    // 说明不了什么，跑赢官方才是结论，所以它不该因为线多而被隐藏。
    const official = withActual.result.baselines?.official
    if (official?.length) {
      series.push({
        name: '官方日前预测', type: 'line', ...(isPrice ? { step: 'end' as const } : {}), showSymbol: false,
        data: official as number[],
        // 虚线：它同样是「预测」而非事实，线型上必须与实际值区分开
        lineStyle: { width: 2, type: 'dashed' as const, color: OFFICIAL_COLOR }, itemStyle: { color: OFFICIAL_COLOR }, z: 2,
      })
    }
    // 单算法时附「昨日同时段」基线：模型有没有赢过「什么都不做」，这是最直观的一眼判据。
    // 多算法同台不画——线已经够多，再加参照线会让主对比失焦。
    const naive = items.length === 1 ? items[0].result.baselines?.naive : undefined
    if (naive?.length) {
      series.push({
        name: '昨日同时段（基线）', type: 'line', ...(isPrice ? { step: 'end' as const } : {}), showSymbol: false,
        data: naive as number[],
        lineStyle: { width: 1.5, type: 'dotted' as const, color: NAIVE_COLOR }, itemStyle: { color: NAIVE_COLOR }, z: 1,
      })
    }
  }

  items.forEach(({ provider, result, untrustedTag }, i) => {
    // 逐类精确标注，不一律写「占位」：mock=这个模型本身是假的；synthetic=模型真、但这次
    // 拿合成数据算的；illustrative=示意。混成一个词会让用户对不同性质的问题做同样的误判。
    // 调用方给的 untrustedTag 优先，它能表达 result 本身看不出的情形（如门禁判负）。
    const tag = untrustedTag || (result.mock === true ? '占位'
      : result.basis === 'synthetic' ? '合成'
        : result.basis === 'illustrative' ? '示意'
          : '')
    const illustrative = !!tag
    series.push({
      name: illustrative ? `${provider}（${tag}）` : provider,
      type: 'line', ...(isPrice ? { step: 'end' as const } : {}), showSymbol: false,
      // mergeActual：有真值的时段把预测裁掉（置 null 断开），形成「实线接虚线」的 AEMO 观感。
      // 判据是「该时段有没有真值」（!= null），不是数组长度——部分出清日的 actual 长度
      // 与 points 相同，只是后半段为 null，按长度判会把整天都当成有真值而抹掉全部预测。
      // 不做插值衔接——两条线本就是不同性质的量，硬连会让人以为预测延续了实测。
      data: props.mergeActual && result.actual?.length
        ? result.points.map((v, idx) => (result.actual![idx] != null ? null : v))
        : result.points,
      // 未来日（无真值）的预测一律虚线：它不是事实，线型上必须与实际值区分开。
      lineStyle: illustrative || result.evaluationMode === 'forecast'
        ? { width: 2, type: 'dashed' as const, opacity: illustrative ? 0.75 : 1 }
        : { width: 2 },
      color: PALETTE[i % PALETTE.length],
    })
  })

  chart.setOption(
    {
      tooltip: { trigger: 'axis', confine: true },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 56, right: 24, top: 32, bottom: 40 },
      xAxis: { type: 'category', data: labels, axisLabel: { interval: granularity === 96 ? 11 : 1 } },
      yAxis: { type: 'value', name: unit, scale: true },
      series,
    },
    true,
  )
}

const chart = useEChart(el, { render })

onMounted(() => {
  render()
})
// mergeActual 也必须进 watch：它只影响 series 数据的组装，不触发 results 变化——
// 漏掉它的症状是勾选框点了没反应（图纹丝不动），而组件测试每次都新 mount，
// 恰好绕过了这条路径，一直是绿的。
watch(() => [props.results, props.mergeActual], () => nextTick(render), { deep: true })

defineExpose({ resize: chart.resize })
</script>

<template>
  <div v-if="backtestCaption" class="band-caption">{{ backtestCaption }}</div>
  <div v-if="bandCaption" class="band-caption">{{ bandCaption }}</div>
  <div ref="el" class="unified-chart" :style="{ height: (height ?? 360) + 'px' }"></div>
</template>

<style scoped>
.unified-chart { width: 100%; }
.band-caption { font-size: var(--font-sm); color: #909399; margin-bottom: 4px; }
</style>
