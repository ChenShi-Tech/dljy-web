// ECharts 3D 美学层（基于 echarts-gl）：曲面 / 3D 散点 / 3D 柱阵 的主题化构建器。
// 复用 2D 体系的语义色与发散/顺序色板，grid3D/坐标轴/visualMap 随四档主题取色。
//
// 用法：视图按需 `import { surface3D, scatter3D, grid3DAxes } from '@/services/chart/chartStyle3D'`
// （import 本文件即注册 echarts-gl 的 surface/scatter3D/bar3D 系列类型）。
import 'echarts-gl'
import { chartChrome } from '@/composables/useTheme'
import { seqColors, divergingColors } from '@/services/chart/chartStyle'

/** grid3D + 三轴基底（随主题取色）。name=[x,y,z] 轴名。 */
export function grid3DAxes(names: [string, string, string], opts: { xCat?: unknown[]; yCat?: unknown[] } = {}) {
  const cc = chartChrome()
  const axisCommon = {
    nameTextStyle: { color: cc.axisLabel || '#909399', fontSize: 11 },
    axisLine: { lineStyle: { color: cc.splitLine || '#e5e7eb' } },
    axisLabel: { color: cc.axisLabel || '#909399', fontSize: 10 },
    splitLine: { lineStyle: { color: cc.splitLine || '#f0f2f5' } }
  }
  return {
    grid3D: {
      boxWidth: 100,
      boxDepth: 80,
      viewControl: { autoRotate: false, distance: 200, alpha: 22, beta: 40 },
      light: { main: { intensity: 1.1, shadow: true }, ambient: { intensity: 0.35 } },
      axisPointer: { lineStyle: { color: cc.neutralLine || '#c8cdd6' } }
    },
    xAxis3D: { type: opts.xCat ? ('category' as const) : ('value' as const), name: names[0], ...(opts.xCat ? { data: opts.xCat } : {}), ...axisCommon },
    yAxis3D: { type: opts.yCat ? ('category' as const) : ('value' as const), name: names[1], ...(opts.yCat ? { data: opts.yCat } : {}), ...axisCommon },
    zAxis3D: { type: 'value' as const, name: names[2], ...axisCommon }
  }
}

/**
 * 3D 曲面：data 为 [[xIdx,yIdx,z], ...]（配 category 轴）或 [[x,y,z], ...]。
 * 典型：负荷/电价随「时刻 × 日期」的曲面。diverging 控制是否用红暖蓝冷发散色。
 */
export function surface3D(name: string, data: number[][], opts: { zMin?: number; zMax?: number; diverging?: boolean } = {}) {
  const cc = chartChrome()
  const zs = data.map((d) => d[2]).filter((n) => Number.isFinite(n))
  const min = opts.zMin ?? (zs.length ? Math.min(...zs) : 0)
  const max = opts.zMax ?? (zs.length ? Math.max(...zs) : 1)
  return {
    visualMap: {
      show: true,
      dimension: 2,
      min,
      max,
      calculable: true,
      left: 'left',
      bottom: 0,
      textStyle: { color: cc.axisLabel || '#909399', fontSize: 11 },
      inRange: { color: opts.diverging ? divergingColors() : seqColors() }
    },
    series: [{
      name,
      type: 'surface' as const,
      data,
      shading: 'realistic' as const,
      wireframe: { show: false },
      itemStyle: { opacity: 0.95 }
    }]
  }
}

/** 3D 散点云：data 为 [[x,y,z], ...]，用第三维(或第四维)着色。典型：电价×负荷×新能源 工况云。 */
export function scatter3D(name: string, data: number[][], opts: { colorDim?: number; symbolSize?: number } = {}) {
  const cc = chartChrome()
  const dim = opts.colorDim ?? 2
  const vs = data.map((d) => d[dim]).filter((n) => Number.isFinite(n))
  const min = vs.length ? Math.min(...vs) : 0
  const max = vs.length ? Math.max(...vs) : 1
  return {
    visualMap: {
      show: true,
      dimension: dim,
      min,
      max,
      calculable: true,
      left: 'left',
      bottom: 0,
      textStyle: { color: cc.axisLabel || '#909399', fontSize: 11 },
      inRange: { color: seqColors() }
    },
    series: [{
      name,
      type: 'scatter3D' as const,
      data,
      symbolSize: opts.symbolSize ?? 8,
      itemStyle: { opacity: 0.85 },
      emphasis: { itemStyle: { color: '#fff' } }
    }]
  }
}

/** 3D 柱阵：data 为 [[xIdx,yIdx,value], ...]（配 category 轴）。典型：96点 × 多日 出力/负荷。 */
export function bar3D(name: string, data: number[][], opts: { diverging?: boolean } = {}) {
  const cc = chartChrome()
  const vs = data.map((d) => d[2]).filter((n) => Number.isFinite(n))
  const min = vs.length ? Math.min(...vs) : 0
  const max = vs.length ? Math.max(...vs) : 1
  return {
    visualMap: {
      show: true,
      dimension: 2,
      min,
      max,
      calculable: true,
      left: 'left',
      bottom: 0,
      textStyle: { color: cc.axisLabel || '#909399', fontSize: 11 },
      inRange: { color: opts.diverging ? divergingColors() : seqColors() }
    },
    series: [{
      name,
      type: 'bar3D' as const,
      data,
      shading: 'lambert' as const,
      itemStyle: { opacity: 0.92 },
      emphasis: { itemStyle: { color: '#fff' } }
    }]
  }
}
