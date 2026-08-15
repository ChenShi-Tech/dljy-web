// 锁死液态玻璃球 uniform 种子的二进制布局。
//
// 种子是与 WGSL struct Uniforms 对齐的 120 个 f32，渲染器每帧只覆写 [0..2]，
// 其余按预设烘焙。这套布局没有类型系统保护（只是一串 float），任何字段错位
// 都会变成「球还能画但完全不对」的静默错误——只能靠测试卡住。
// 下标语义见 orbPresets.ts 头部注释，与 liquidGlassOrb.wgsl 一一对应。
import { describe, expect, it } from 'vitest'

import {
  buildOrbUniformSeed,
  ORB_PRESETS,
  ORB_UNIFORM_FLOAT_COUNT,
  ORB_UNIFORM_INDICES
} from '@/components/orb/orbPresets'

const TOLERANCE = 1e-6

function hexChannel(hex: string, channel: 0 | 1 | 2): number {
  return Number.parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16) / 255
}

describe('buildOrbUniformSeed 布局', () => {
  it('种子恒为 120 个 f32（480 字节，与 struct Uniforms 对齐后等宽）', () => {
    const seed = buildOrbUniformSeed(ORB_PRESETS.siri.params)
    expect(seed).toBeInstanceOf(Float32Array)
    expect(seed.length).toBe(ORB_UNIFORM_FLOAT_COUNT)
    expect(seed.byteLength).toBe(480)
  })

  it('宽/高/时间初始为 1/1/0（与编辑器导出协议一致，运行时逐帧覆写）', () => {
    const seed = buildOrbUniformSeed(ORB_PRESETS.opal.params)
    expect(seed[ORB_UNIFORM_INDICES.width]).toBe(1)
    expect(seed[ORB_UNIFORM_INDICES.height]).toBe(1)
    expect(seed[ORB_UNIFORM_INDICES.time]).toBe(0)
  })

  it('标量区：speed/radius 落在 [3]/[4]，玻璃罩开关编码为 0/1', () => {
    const seed = buildOrbUniformSeed(ORB_PRESETS.blueDrop.params)
    expect(seed[3]).toBeCloseTo(0.9, TOLERANCE)
    expect(seed[4]).toBeCloseTo(0.74, TOLERANCE)
    expect(seed[ORB_UNIFORM_INDICES.glassEnabled]).toBe(1)

    const off = buildOrbUniformSeed({ ...ORB_PRESETS.chrome.params, glassEnabled: false })
    expect(off[ORB_UNIFORM_INDICES.glassEnabled]).toBe(0)
  })

  it('流场选择值 style 落在 [15]，与编辑器的分支映射一致', () => {
    const expected: Record<string, number> = {
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
    for (const [id, selector] of Object.entries(expected)) {
      const seed = buildOrbUniformSeed(ORB_PRESETS[id as keyof typeof ORB_PRESETS].params)
      expect(seed[ORB_UNIFORM_INDICES.style]).toBe(selector)
    }
  })

  it('vec4 对齐填充区 [22,23] 恒 0，颜色区从 [24] 起', () => {
    const seed = buildOrbUniformSeed(ORB_PRESETS.violetEmber.params)
    expect(seed[22]).toBe(0)
    expect(seed[23]).toBe(0)
    // colorB(#4A0E8F) 是第 2 个 vec4 → 24 + 4 = 28
    expect(seed[28]).toBeCloseTo(hexChannel('#4A0E8F', 0), TOLERANCE)
    expect(seed[29]).toBeCloseTo(hexChannel('#4A0E8F', 1), TOLERANCE)
    expect(seed[30]).toBeCloseTo(hexChannel('#4A0E8F', 2), TOLERANCE)
    expect(seed[31]).toBe(1)
  })

  it('canvasColor 是第 11 个 vec4 → [64..67]，paletteStop0 从 [72] 起', () => {
    const seed = buildOrbUniformSeed(ORB_PRESETS.siri.params)
    expect(seed[64]).toBeCloseTo(hexChannel('#030409', 0), TOLERANCE)
    expect(seed[65]).toBeCloseTo(hexChannel('#030409', 1), TOLERANCE)
    expect(seed[66]).toBeCloseTo(hexChannel('#030409', 2), TOLERANCE)
    // paletteStop0 = #F7FBFF
    expect(seed[72]).toBeCloseTo(hexChannel('#F7FBFF', 0), TOLERANCE)
    expect(seed[73]).toBeCloseTo(hexChannel('#F7FBFF', 1), TOLERANCE)
    expect(seed[74]).toBeCloseTo(hexChannel('#F7FBFF', 2), TOLERANCE)
  })

  it('十种预设齐备且中文标签不重名（与编辑器内置一致）', () => {
    const ids = Object.keys(ORB_PRESETS)
    expect(ids).toHaveLength(10)
    const labels = ids.map((id) => ORB_PRESETS[id as keyof typeof ORB_PRESETS].label)
    expect(new Set(labels).size).toBe(10)
  })
})

describe('LiquidOrbRenderer 环境探测', () => {
  it('无 navigator.gpu 的环境（node）直接返回 unsupported，不触碰画布', async () => {
    const { LiquidOrbRenderer } = await import('@/components/orb/orbRenderer')
    // unsupported 分支先于任何画布访问返回；假画布只为满足构造签名
    const canvas = { clientWidth: 0, clientHeight: 0 } as HTMLCanvasElement
    let reported: string | undefined
    const renderer = new LiquidOrbRenderer(canvas, {
      seed: buildOrbUniformSeed(ORB_PRESETS.siri.params),
      onStatus: (status) => {
        reported = status
      }
    })
    const status = await renderer.start()
    expect(status).toBe('unsupported')
    expect(reported).toBe('unsupported')
    renderer.destroy()
  })
})
