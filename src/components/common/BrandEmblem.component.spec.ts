// 品牌标识组件：锁住与 public/favicon.svg 同源的几何（六边形顶点 / 折线 / 箭头 / 3 个节点）、
// 线稿走 currentColor（随外层主题取色）、对读屏隐藏，以及 bold 档确实加粗笔画。
import { describe, it, expect } from 'vitest'
import { mount } from '@/test/mount'
import BrandEmblem from './BrandEmblem.vue'

describe('BrandEmblem', () => {
  it('按品牌几何绘制六边形、上扬折线、箭头与 3 个节点，线稿取 currentColor 且对读屏隐藏', () => {
    const w = mount(BrandEmblem, { props: { size: 32 } })
    const svg = w.get('svg')
    expect(svg.attributes('width')).toBe('32')
    expect(svg.attributes('stroke')).toBe('currentColor')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(w.get('polygon').attributes('points')).toBe('0,-1 0.866,-0.5 0.866,0.5 0,1 -0.866,0.5 -0.866,-0.5')
    const lines = w.findAll('polyline').map((p) => p.attributes('points'))
    expect(lines).toEqual(['-0.52,0.5 0.52,0.5', '-0.5,0.3 -0.12,-0.08 0.06,0.12 0.46,-0.34', '0.439,-0.121 0.46,-0.34 0.246,-0.289'])
    expect(w.findAll('circle')).toHaveLength(3)
  })

  it('bold 档笔画比 normal 粗（小尺寸徽标用）', () => {
    const hexWidth = (weight: 'normal' | 'bold') => Number(mount(BrandEmblem, { props: { weight } }).get('polygon').attributes('stroke-width'))
    expect(hexWidth('bold')).toBeGreaterThan(hexWidth('normal'))
  })
})
