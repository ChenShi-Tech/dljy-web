// 乱码检测与可读降级（缺陷⑤配套）：真实乱码样本（UTF-8 按 GBK 误读产物）、
// U+FFFD 替换字符、正常中文/英文/混合文本三态判别，不误伤正常业务文案。
import { describe, expect, it } from 'vitest'
import { looksLikeMojibake, readableSourceText } from './mojibake'

// 「云电交易」的 UTF-8 字节按 GBK 解读的典型产物（构造自真实编码错配形态）。
const GBK_MISREAD = '浜戠數浜ゆ槗'
// 带替换字符的上游解码失败样本。
const REPLACEMENT = '来源：���日报'

describe('looksLikeMojibake', () => {
  it('UTF-8 按 GBK 误读的产物判为乱码', () => {
    expect(looksLikeMojibake(GBK_MISREAD)).toBe(true)
  })

  it('含 U+FFFD 替换字符判为乱码', () => {
    expect(looksLikeMojibake(REPLACEMENT)).toBe(true)
  })

  it('正常中文不误伤', () => {
    expect(looksLikeMojibake('供应商预测（云南）')).toBe(false)
    expect(looksLikeMojibake('实际发电出力，来源 yn_plant_output')).toBe(false)
  })

  it('纯 ASCII / 编号 / 空串直通', () => {
    expect(looksLikeMojibake('yn_plant_output')).toBe(false)
    expect(looksLikeMojibake('ACTUAL')).toBe(false)
    expect(looksLikeMojibake('')).toBe(false)
  })

  it('单个生僻字不足以判乱码（保守）', () => {
    expect(looksLikeMojibake('计划检修㐀号机组')).toBe(false)
  })
})

describe('readableSourceText', () => {
  it('乱码 → 占位 + 原文留档', () => {
    const r = readableSourceText(GBK_MISREAD)
    expect(r.text).toBe('来源解析失败')
    expect(r.raw).toBe(GBK_MISREAD)
  })

  it('正常文本原样直通', () => {
    const r = readableSourceText('供应商预测（云南）')
    expect(r.text).toBe('供应商预测（云南）')
    expect(r.raw).toBeNull()
  })

  it('空值直通、占位可自定义', () => {
    expect(readableSourceText(null)).toEqual({ text: '', raw: null })
    expect(readableSourceText(undefined)).toEqual({ text: '', raw: null })
    expect(readableSourceText(REPLACEMENT, '解码失败').text).toBe('解码失败')
  })
})
