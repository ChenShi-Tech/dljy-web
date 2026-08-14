import { describe, expect, it } from 'vitest'
import { shortSubdivisionName } from './labels'

describe('shortSubdivisionName', () => {
  it('strips plain administrative suffixes', () => {
    expect(shortSubdivisionName('昆明市')).toBe('昆明')
    expect(shortSubdivisionName('曲靖市')).toBe('曲靖')
    expect(shortSubdivisionName('阿拉善盟')).toBe('阿拉善')
    expect(shortSubdivisionName('那曲地区')).toBe('那曲')
  })

  it('strips ethnic names without eating the place name itself', () => {
    // 回归：通配正则 [一-龥]{1,3}族 会把「红河哈尼族」整体吃掉裁出「红」，
    // 把「大理白族」整体吃掉裁成空串。这里逐个钉死真实地名。
    expect(shortSubdivisionName('红河哈尼族彝族自治州')).toBe('红河')
    expect(shortSubdivisionName('大理白族自治州')).toBe('大理')
    expect(shortSubdivisionName('楚雄彝族自治州')).toBe('楚雄')
    expect(shortSubdivisionName('西双版纳傣族自治州')).toBe('西双版纳')
    expect(shortSubdivisionName('德宏傣族景颇族自治州')).toBe('德宏')
    expect(shortSubdivisionName('文山壮族苗族自治州')).toBe('文山')
    expect(shortSubdivisionName('怒江傈僳族自治州')).toBe('怒江')
    expect(shortSubdivisionName('迪庆藏族自治州')).toBe('迪庆')
  })

  it('handles other provinces with ethnic prefectures', () => {
    expect(shortSubdivisionName('临夏回族自治州')).toBe('临夏')
    expect(shortSubdivisionName('凉山彝族自治州')).toBe('凉山')
    expect(shortSubdivisionName('伊犁哈萨克自治州')).toBe('伊犁哈萨克')
    expect(shortSubdivisionName('黔南布依族苗族自治州')).toBe('黔南')
    expect(shortSubdivisionName('湘西土家族苗族自治州')).toBe('湘西')
    expect(shortSubdivisionName('延边朝鲜族自治州')).toBe('延边')
  })

  it('falls back to the full name when stripping would empty it', () => {
    expect(shortSubdivisionName('市')).toBe('市')
    expect(shortSubdivisionName('')).toBe('')
  })
})
