// 统一 ECharts 生命周期 composable：init/dispose、容器级 ResizeObserver、
// 暗色主题接入与切换重建、加载态。替代各视图手写的
// echarts.init + window.resize 监听 + dispose 样板代码。
//
// 用法：
//   const chartEl = ref<HTMLElement | null>(null)
//   const priceChart = useEChart(chartEl, { render: renderChart })
//   function renderChart() { priceChart.setOption({ ... }) }
//
// 相比手写样板的改进：
// 1. ResizeObserver 监听容器本身（侧栏收起/面板伸缩时也能自适应，window.resize 做不到）；
// 2. 自动以 activeChartTheme() 初始化，主题切换时 dispose 重建并调用 render 回调；
// 3. resize 帧节流，多图页面拖动窗口不掉帧；
// 4. keep-alive 页面激活时自动补一次 resize（隐藏期间容器尺寸可能已变化）。
import { onActivated, onBeforeUnmount, watch, type Ref } from 'vue'
import * as echarts from 'echarts'
import { activeChartTheme } from '@/services/chart/echartsTheme'
import { themeState } from '@/services/theme'
import { cssVar } from './useTheme'
import { rafThrottle } from '../utils/timing'

type EChartsOption = Parameters<echarts.ECharts['setOption']>[0]
type SetOptionOpts = Parameters<echarts.ECharts['setOption']>[1]

export interface UseEChartOptions {
  /** echarts.connect 分组名：同组图表 tooltip / dataZoom 联动。 */
  group?: string
  /** 渲染回调：主题切换重建实例后自动调用以恢复图表内容。 */
  render?: () => void
  /** 初始化附加参数（如 { renderer: 'svg' }）。 */
  initOpts?: Parameters<typeof echarts.init>[2]
}

export interface EChartHandle {
  /** 应用配置（首次调用时自动初始化实例）；第二参数兼容 notMerge 布尔与对象两种形式。 */
  setOption: (option: EChartsOption, opts?: boolean | SetOptionOpts) => void
  /** 获取底层实例（绑定事件、dispatchAction 等场景；可能为 null）。 */
  instance: () => echarts.ECharts | null
  /** 手动触发 resize（已帧节流）。 */
  resize: () => void
  /** 主题感知的加载态。 */
  showLoading: () => void
  hideLoading: () => void
  /** 销毁实例（组件卸载时自动调用，一般无需手动）。 */
  dispose: () => void
}

export function useEChart(el: Ref<HTMLElement | null>, options: UseEChartOptions = {}): EChartHandle {
  let chart: echarts.ECharts | null = null
  let observer: ResizeObserver | null = null
  let lastOption: EChartsOption | null = null
  let loading = false
  let pendingInitFrame: number | null = null

  const resize = rafThrottle(() => {
    if (chart && !chart.isDisposed()) chart.resize()
  })

  function hasRenderableSize(dom: HTMLElement): boolean {
    return dom.clientWidth > 0 && dom.clientHeight > 0
  }

  function cancelPendingInit() {
    if (pendingInitFrame !== null) {
      window.cancelAnimationFrame(pendingInitFrame)
      pendingInitFrame = null
    }
  }

  function scheduleDeferredInit(dom: HTMLElement) {
    if (pendingInitFrame !== null) return
    pendingInitFrame = window.requestAnimationFrame(() => {
      pendingInitFrame = null
      if (el.value !== dom || !hasRenderableSize(dom)) return
      if (lastOption) setOption(lastOption)
      else if (loading && ensure()) applyLoading()
    })
  }

  function observe(dom: HTMLElement) {
    observer?.disconnect()
    if (typeof ResizeObserver === 'undefined') {
      // 极旧环境兜底：退回 window resize
      window.addEventListener('resize', resize)
      return
    }
    observer = new ResizeObserver(() => {
      if (chart && !chart.isDisposed()) resize()
      else if (hasRenderableSize(dom)) scheduleDeferredInit(dom)
    })
    observer.observe(dom)
  }

  function ensure(): echarts.ECharts | null {
    const dom = el.value
    if (!dom) return null
    if (chart && chart.getDom() !== dom) disposeChart()
    if (!hasRenderableSize(dom)) {
      observe(dom)
      scheduleDeferredInit(dom)
      return null
    }
    if (!chart || chart.isDisposed()) {
      chart = echarts.init(dom, activeChartTheme(), options.initOpts)
      if (options.group) {
        chart.group = options.group
        echarts.connect(options.group)
      }
      observe(dom)
      if (loading) applyLoading()
    }
    return chart
  }

  function setOption(option: EChartsOption, opts?: boolean | SetOptionOpts) {
    lastOption = option
    const c = ensure()
    if (!c) return
    c.setOption(option, typeof opts === 'boolean' ? { notMerge: opts } : opts)
  }

  function applyLoading() {
    chart?.showLoading('default', {
      text: '加载中…',
      color: cssVar('--primary') || '#409eff',
      textColor: cssVar('--muted') || '#909399',
      maskColor: 'rgba(127, 127, 127, 0.04)',
      spinnerRadius: 8,
      lineWidth: 2
    })
  }

  function showLoading() {
    loading = true
    if (ensure()) applyLoading()
  }

  function hideLoading() {
    loading = false
    chart?.hideLoading()
  }

  function disposeChart() {
    cancelPendingInit()
    observer?.disconnect()
    observer = null
    window.removeEventListener('resize', resize)
    chart?.dispose()
    chart = null
  }

  // 主题切换：dispose 后重建（注册主题只能在 init 时指定），并恢复内容。
  watch(
    () => themeState.theme,
    () => {
      if (!chart) return
      disposeChart()
      if (options.render) options.render()
      else if (lastOption) setOption(lastOption)
    }
  )

  // 容器被 v-if 重建（ref 换绑到新元素）：旧 ResizeObserver 绑在已脱离 DOM 的
  // 旧节点上，不主动换绑的话图表永久空白，直到某个动作恰好触发 setOption
  // （申报台「申报单↔历史申报单」页签切换实测症状）。换绑观察，并在新容器
  // 有尺寸时立即恢复内容；无尺寸（还藏着）则走延迟初始化等它出现。
  watch(el, (dom) => {
    if (!dom || dom === chart?.getDom()) return
    observe(dom)
    if (hasRenderableSize(dom)) {
      if (lastOption) setOption(lastOption)
      else if (loading) ensure()
    } else {
      scheduleDeferredInit(dom)
    }
  })

  // keep-alive 页面切回时容器尺寸可能已变化，补一次 resize。
  onActivated(() => resize())

  onBeforeUnmount(() => {
    resize.cancel()
    disposeChart()
  })

  return { setOption, instance: () => chart, resize, showLoading, hideLoading, dispose: disposeChart }
}
