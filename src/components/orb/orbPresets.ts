// 液态玻璃球预设与 uniform 种子 —— 移植自「液态玻璃球编辑器」(https://lersent001.github.io/orb/)
// 的导出协议：渲染端只需 WGSL 着色器 + 一颗 120 个 f32 的 uniform 种子，每帧覆写
// [0]=宽 [1]=高 [2]=时间(秒) 后整体 writeBuffer。
//
// 种子布局（float 下标，对应 liquidGlassOrb.wgsl 的 struct Uniforms）：
//   [0,1]   size(vec2)               [2] time（运行时覆写）
//   [3..21] 19 个标量：speed radius zoom warp ridgeAmt sharp shade sheen gloss
//           shellMidAlpha shellEdgeAlpha exposure style edgeSoftness edgeGlow
//           paletteCount glassEnabled glassOpacity contourDeform
//   [22,23] vec4 对齐填充（恒 0）
//   [24..71] 12 个 vec4 颜色：colorA colorB colorC colorD highlightColor shellInner
//           shellMid shellEdge sheenColor specColor canvasColor glowColor
//   [72..119] 12 个 vec4 paletteStop0..11（当前流场未消费 palette，保留原默认值）

export type OrbPresetId =
  | 'siri'
  | 'voiceWave'
  | 'spectrum'
  | 'aurora'
  | 'frost'
  | 'plasma'
  | 'chrome'
  | 'opal'
  | 'blueDrop'
  | 'violetEmber'

export interface OrbPresetParams {
  /** 流场选择（映射为着色器内 u.style 分支值） */
  style: OrbPresetId
  /** 是否叠加玻璃罩（折射 + 双向边缘光） */
  glassEnabled: boolean
  speed: number
  radius: number
  /** 轮廓形变（球面呼吸幅度） */
  contourDeform: number
  zoom: number
  warp: number
  ridgeAmt: number
  sharp: number
  shade: number
  sheen: number
  gloss: number
  glassOpacity: number
  shellMidAlpha: number
  shellEdgeAlpha: number
  exposure: number
  edgeSoftness: number
  edgeGlow: number
  colorA: string
  colorB: string
  colorC: string
  colorD: string
  highlightColor: string
  shellInner: string
  shellMid: string
  shellEdge: string
  sheenColor: string
  specColor: string
  canvasColor: string
  glowColor: string
}

export interface OrbPreset {
  id: OrbPresetId
  label: string
  params: OrbPresetParams
}

/** 各流场在着色器内的分支选择值（wgsl 内 if u.style == N） */
const STYLE_SELECTORS: Record<OrbPresetId, number> = {
  siri: 9,
  voiceWave: 19,
  aurora: 10,
  plasma: 11,
  chrome: 12,
  opal: 13,
  spectrum: 14,
  frost: 15,
  blueDrop: 20,
  violetEmber: 21
}

/** 编辑器「冰霜流体」的基础参数（其余预设在其上覆写差异项） */
const BASE_PARAMS: OrbPresetParams = {
  style: 'frost',
  glassEnabled: true,
  speed: 1,
  radius: 0.72,
  contourDeform: 0,
  zoom: 0.3,
  warp: 3,
  ridgeAmt: 0.5,
  sharp: 2.2,
  shade: 0.3,
  sheen: 0.36,
  gloss: 0.28,
  glassOpacity: 0.42,
  shellMidAlpha: 0.2,
  shellEdgeAlpha: 0.22,
  exposure: 1,
  edgeSoftness: 0.005,
  edgeGlow: 0,
  colorA: '#F7FBFF',
  colorB: '#D6E8F7',
  colorC: '#A8C8F0',
  colorD: '#6F9EE8',
  highlightColor: '#FFFFFF',
  shellInner: '#FFFFFF',
  shellMid: '#D6E8F7',
  shellEdge: '#6F9EE8',
  sheenColor: '#EAF4FF',
  specColor: '#DCEAFF',
  canvasColor: '#000000',
  glowColor: '#6F9EE8'
}

function preset(id: OrbPresetId, label: string, overrides: Partial<OrbPresetParams>): OrbPreset {
  return { id, label, params: { ...BASE_PARAMS, style: id, ...overrides } }
}

/** 十种动效预设，与编辑器内置一致 */
export const ORB_PRESETS: Record<OrbPresetId, OrbPreset> = {
  siri: preset('siri', 'Siri 波澜', {
    speed: 0.82,
    zoom: 0.36,
    warp: 3.2,
    ridgeAmt: 0.5,
    sharp: 2.2,
    shade: 0.12,
    sheen: 0.28,
    gloss: 0.24,
    glassOpacity: 0.44,
    shellMidAlpha: 0.18,
    shellEdgeAlpha: 0.18,
    exposure: 2,
    colorA: '#FFD86B',
    colorB: '#82F4FF',
    colorC: '#FF7BD5',
    colorD: '#8E6CFF',
    shellMid: '#9BF4FF',
    shellEdge: '#C5A9FF',
    canvasColor: '#030409',
    glowColor: '#956CFF'
  }),
  voiceWave: preset('voiceWave', '声纹薄膜', {
    speed: 0.95,
    radius: 0.7,
    contourDeform: 0.1,
    zoom: 0.36,
    warp: 2.6,
    ridgeAmt: 0.46,
    shade: 0.08,
    sheen: 0.22,
    gloss: 0.36,
    glassOpacity: 0.48,
    shellMidAlpha: 0.18,
    shellEdgeAlpha: 0.2,
    exposure: 1.35,
    colorA: '#09030E',
    colorB: '#CE2CCB',
    colorC: '#FF5C71',
    colorD: '#7B53FF',
    highlightColor: '#FFD9F0',
    shellMid: '#E48BFF',
    shellEdge: '#FF7890',
    sheenColor: '#FFF1FA',
    specColor: '#E7D9FF',
    canvasColor: '#020105',
    glowColor: '#CE2CCB'
  }),
  spectrum: preset('spectrum', '彩色声场', {
    speed: 1.8,
    contourDeform: 0.03,
    zoom: 0.46,
    warp: 4.4,
    ridgeAmt: 0.72,
    shade: 0.06,
    sheen: 0.26,
    gloss: 0.24,
    glassOpacity: 0.4,
    shellMidAlpha: 0.18,
    shellEdgeAlpha: 0.18,
    exposure: 1.5,
    colorA: '#FFFFFF',
    colorB: '#1677FF',
    colorC: '#F249A0',
    colorD: '#35E6B2',
    shellMid: '#66E8FF',
    shellEdge: '#D26CFF',
    canvasColor: '#03040A',
    glowColor: '#1677FF'
  }),
  aurora: preset('aurora', '极光帷幕', {
    speed: 3,
    contourDeform: 0.08,
    zoom: 0.4,
    warp: 4.2,
    ridgeAmt: 0.62,
    sharp: 2.1,
    shade: 0.18,
    exposure: 1.18,
    colorA: '#030816',
    colorB: '#20F0B6',
    colorC: '#32A8FF',
    colorD: '#A34BFF',
    shellMid: '#32A8FF',
    shellEdge: '#20F0B6',
    canvasColor: '#010207',
    glowColor: '#20F0B6'
  }),
  frost: preset('frost', '冰霜流体', {
    speed: 2.22,
    contourDeform: 0.04,
    zoom: 0.36,
    warp: 3.7,
    ridgeAmt: 0.45,
    sharp: 2.05,
    shade: 0.3,
    sheen: 0.34,
    gloss: 0.28,
    glassOpacity: 0.42,
    shellMidAlpha: 0.2,
    shellEdgeAlpha: 0.22,
    exposure: 1
  }),
  plasma: preset('plasma', '神经电浆', {
    speed: 1.32,
    contourDeform: 0.05,
    zoom: 0.55,
    warp: 5.4,
    ridgeAmt: 0.78,
    sharp: 4.2,
    shade: 0.16,
    exposure: 1.25,
    colorA: '#06020E',
    colorB: '#0099FF',
    colorC: '#258BFF',
    colorD: '#1375FF',
    shellInner: '#FFFFFF',
    shellMid: '#1951C2',
    shellEdge: '#00E9FF',
    sheenColor: '#EAF4FF',
    specColor: '#DCEAFF',
    canvasColor: '#020105',
    glowColor: '#0099FF'
  }),
  chrome: preset('chrome', '液态铬', {
    speed: 2,
    zoom: 0.36,
    warp: 3.8,
    ridgeAmt: 0.44,
    sharp: 5.2,
    shade: 0.58,
    exposure: 1.08,
    colorA: '#FFFFFF',
    colorB: '#B9C0CA',
    colorC: '#343A43',
    colorD: '#030405',
    shellMid: '#B9C0CA',
    shellEdge: '#FFFFFF',
    canvasColor: '#050608',
    glowColor: '#FFFFFF'
  }),
  opal: preset('opal', '虹彩欧泊', {
    speed: 1.5,
    zoom: 0.3,
    warp: 2.8,
    ridgeAmt: 0.36,
    sharp: 2,
    shade: 0.1,
    sheen: 0.3,
    gloss: 0.26,
    glassOpacity: 0.38,
    shellMidAlpha: 0.2,
    shellEdgeAlpha: 0.2,
    exposure: 1.12,
    colorA: '#FFF6E8',
    colorB: '#6EF2CF',
    colorC: '#FF91D8',
    colorD: '#756BFF',
    shellMid: '#CDE5FF',
    shellEdge: '#D9C8FF',
    canvasColor: '#07080D',
    glowColor: '#9E8CFF'
  }),
  blueDrop: preset('blueDrop', '蓝晶液滴', {
    speed: 0.9,
    radius: 0.74,
    contourDeform: 0.08,
    zoom: 0.48,
    warp: 2.65,
    ridgeAmt: 0.42,
    sharp: 2.4,
    shade: 0.16,
    sheen: 0.22,
    gloss: 0.42,
    glassOpacity: 0.66,
    shellMidAlpha: 0.32,
    shellEdgeAlpha: 0.24,
    exposure: 1.24,
    colorA: '#020B1D',
    colorB: '#0756B8',
    colorC: '#1EC8FF',
    colorD: '#DDFBFF',
    highlightColor: '#EAFBFF',
    shellInner: '#F6FDFF',
    shellMid: '#4FD7FF',
    shellEdge: '#466DFF',
    sheenColor: '#DDFBFF',
    specColor: '#A8D9FF',
    canvasColor: '#010207',
    glowColor: '#168DFF'
  }),
  violetEmber: preset('violetEmber', '紫焰流核', {
    speed: 1.12,
    radius: 0.72,
    contourDeform: 0.04,
    zoom: 0.58,
    warp: 4.7,
    ridgeAmt: 0.73,
    sharp: 3.3,
    shade: 0.18,
    sheen: 0.2,
    gloss: 0.34,
    glassOpacity: 0.62,
    shellMidAlpha: 0.28,
    shellEdgeAlpha: 0.24,
    exposure: 1.28,
    colorA: '#100016',
    colorB: '#4A0E8F',
    colorC: '#A52EFF',
    colorD: '#F1A7FF',
    highlightColor: '#FFD6FF',
    shellInner: '#FCF5FF',
    shellMid: '#C257FF',
    shellEdge: '#6C2DFF',
    sheenColor: '#F8E6FF',
    specColor: '#D4B7FF',
    canvasColor: '#030006',
    glowColor: '#A52EFF'
  })
}

/** paletteStop 默认色带（当前流场不消费，保留导出协议原值） */
const PALETTE_STOPS = [
  '#F7FBFF',
  '#EFF6FD',
  '#E0EEF9',
  '#D4E6F7',
  '#BBD5F3',
  '#A6C7F0',
  '#87B0EB',
  '#6F9EE8',
  '#6F9EE8',
  '#6F9EE8',
  '#6F9EE8',
  '#6F9EE8'
]

export const ORB_UNIFORM_FLOAT_COUNT = 120

/** #RRGGBB → [r,g,b,1]（0..1） */
function hexToVec4(hex: string): [number, number, number, number] {
  const t = hex.slice(1)
  return [
    Number.parseInt(t.slice(0, 2), 16) / 255,
    Number.parseInt(t.slice(2, 4), 16) / 255,
    Number.parseInt(t.slice(4, 6), 16) / 255,
    1
  ]
}

/** uniform 种子内的标量/颜色下标（供渲染器逐帧覆写与单测对齐用） */
export const ORB_UNIFORM_INDICES = {
  width: 0,
  height: 1,
  time: 2,
  speed: 3,
  style: 15,
  glassEnabled: 19,
  colorBase: 24
} as const

/**
 * 构建一颗 uniform 种子（对应编辑器导出的 uniformSeed）。
 * 宽/高/时间由渲染器逐帧覆写，这里分别置 1/1/0 与导出协议一致。
 */
export function buildOrbUniformSeed(params: OrbPresetParams): Float32Array {
  const seed = new Float32Array(ORB_UNIFORM_FLOAT_COUNT)
  seed[0] = 1
  seed[1] = 1
  seed[2] = 0
  const scalars = [
    params.speed,
    params.radius,
    params.zoom,
    params.warp,
    params.ridgeAmt,
    params.sharp,
    params.shade,
    params.sheen,
    params.gloss,
    params.shellMidAlpha,
    params.shellEdgeAlpha,
    params.exposure,
    STYLE_SELECTORS[params.style] ?? 0,
    params.edgeSoftness,
    params.edgeGlow,
    0, // paletteCount：当前流场不走 palette 路径
    params.glassEnabled ? 1 : 0,
    params.glassOpacity,
    params.contourDeform
  ]
  seed.set(scalars, 3)
  const colors = [
    params.colorA,
    params.colorB,
    params.colorC,
    params.colorD,
    params.highlightColor,
    params.shellInner,
    params.shellMid,
    params.shellEdge,
    params.sheenColor,
    params.specColor,
    params.canvasColor,
    params.glowColor,
    ...PALETTE_STOPS
  ]
  colors.forEach((hex, i) => seed.set(hexToVec4(hex), ORB_UNIFORM_INDICES.colorBase + i * 4))
  return seed
}
