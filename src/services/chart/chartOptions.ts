// ECharts 公共配置片段：tooltip 单位格式化、dataZoom、toolbox、空数据占位。
// 图表体验优化统一入口——视图侧只拼业务数据，展示规范（单位、缩放、导出）走这里。
import { cssVar } from '@/composables/useTheme'

/** 数值格式化：千分位 + 限定小数位；空值/非数返回 '-'。 */
export function fmtNum(value: unknown, digits = 2): string {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export interface AxisTooltipOptions {
  /** 所有系列的统一单位（如 '元/MWh'、'MW'、'%'）。 */
  unit?: string
  /** 按系列名指定单位（双轴图等系列单位不同时用，优先于 unit）。 */
  units?: Record<string, string>
  /** 小数位数，默认 2。 */
  digits?: number
  /** 十字准星指针，默认开启；分组柱状图可传 'shadow'，不需要指针传 false。 */
  pointer?: 'cross' | 'shadow' | 'line' | false
}

type TooltipParam = {
  seriesName?: string
  marker?: string
  axisValueLabel?: string
  name?: string
  value?: unknown
}

function paramValue(p: TooltipParam): unknown {
  const v = p.value
  if (Array.isArray(v)) return v[v.length - 1]
  return v
}

/**
 * 轴触发 tooltip（带单位格式化）。电力交易场景读数必须带单位，
 * 统一在此格式化避免每个视图手写 formatter。
 */
export function axisTooltip(opts: AxisTooltipOptions = {}) {
  const { unit = '', units = {}, digits = 2, pointer = 'cross' } = opts
  return {
    trigger: 'axis' as const,
    ...(pointer
      ? {
          axisPointer: {
            type: pointer,
            ...(pointer === 'cross' ? { crossStyle: { opacity: 0.4 }, label: { precision: digits } } : {})
          }
        }
      : {}),
    formatter: (params: TooltipParam | TooltipParam[]) => {
      const list = Array.isArray(params) ? params : [params]
      if (!list.length) return ''
      const head = list[0].axisValueLabel ?? list[0].name ?? ''
      const rows = list
        .map((p) => {
          const u = units[p.seriesName ?? ''] ?? unit
          const text = fmtNum(paramValue(p), digits)
          const suffix = text === '-' || !u ? '' : ` ${u}`
          return `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">` +
            `<span>${p.marker ?? ''}${p.seriesName ?? ''}</span><b>${text}${suffix}</b></div>`
        })
        .join('')
      return `<div style="font-weight:600;margin-bottom:2px">${head}</div>${rows}`
    }
  }
}

/** 内置滚轮/双指缩放（不占布局空间）。96 点及以上时间序列图的默认配置。 */
export function insideZoom() {
  return [{ type: 'inside' as const }]
}

/** 滚轮缩放 + 底部滑块（长区间数据：多日 96 点、月度序列等）。注意 grid.bottom 预留 ~30px。 */
export function sliderZoom(start = 0) {
  return [
    { type: 'inside' as const, start, end: 100 },
    { type: 'slider' as const, start, end: 100, height: 16, bottom: 4 }
  ]
}

/** 工具箱：保存图片 + 数据视图 + 还原。分析/报表类图表标配，让用户可导出图表。 */
export function chartToolbox(name = '图表') {
  return {
    show: true,
    right: 8,
    top: 0,
    itemSize: 13,
    itemGap: 8,
    iconStyle: { borderColor: cssVar('--muted') || '#8a94a6' },
    emphasis: { iconStyle: { borderColor: cssVar('--primary') || '#409eff' } },
    feature: {
      saveAsImage: { name, title: '保存图片', backgroundColor: cssVar('--panel') || '#fff' },
      dataView: {
        title: '数据视图',
        readOnly: true,
        lang: ['数据视图', '关闭', '刷新'],
        backgroundColor: cssVar('--panel') || '#fff',
        textareaColor: cssVar('--panel') || '#fff',
        textColor: cssVar('--text') || '#333',
        buttonColor: cssVar('--primary') || '#409eff'
      },
      restore: { title: '还原' }
    }
  }
}

/**
 * 底部工具箱布局：工具栏放容器底部右下角，配套 bottomLayoutLegend() 使用。
 * 显式 top:'auto' 覆盖 chartToolbox 默认 top:0，否则 bottom 不生效。
 */
export function bottomToolbox(name = '图表', right = 8) {
  return { ...chartToolbox(name), top: 'auto' as const, bottom: 0, right }
}

/** 底部布局配套图例：顶部水平居中 + scroll。extra 透传 data/textStyle/itemWidth 等。 */
export function bottomLayoutLegend(extra: Record<string, unknown> = {}) {
  return { top: 0, left: 'center', type: 'scroll' as const, ...extra }
}

/** 空数据占位：数据为空时图表中央显示提示文字（配合 setOption 使用）。 */
export function emptyOverlay(show: boolean, text = '暂无数据') {
  return {
    graphic: show
      ? [{
          type: 'text' as const,
          left: 'center',
          top: 'middle',
          silent: true,
          style: { text, fill: cssVar('--muted') || '#909399', fontSize: 13 }
        }]
      : []
  }
}
