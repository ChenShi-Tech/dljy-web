// 宽表口径码前端出口测试（#1529）
// 守的不变量：src/data/declarationCodes 出口与主仓事实源逐项一致——视图消费的唯一通道，
// 事实源经 sync:web 携带；本 spec 在 sync 脱节（文件缺失/内容漂移）或有人绕出口硬编码时变红。
// 坏掉的症状：图例/曲线名显示错误口径（#1498：申报量取到「中长期电量」而非「日前电量」，
// 量级同为 4.4 万 MWh 肉眼不可辨），或 import 断链导致本页 CI 编译失败。
// 关联：dljy#1529 / dljy#1498；主仓 PR ChenShi-Tech/dljy#2485（事实源+门禁）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DECLARATION_CODES_SCHEMA_VERSION,
  DECLARATION_QTY_TYPE_CODES,
  DECLARATION_PRICE_TYPE_CODES
} from './declarationCodes'

describe('declarationCodes 出口与事实源逐项一致（#1529）', () => {
  it('电量口径 12 项逐项等于旧组件硬编码（迁移零行为变化）', () => {
    expect(DECLARATION_QTY_TYPE_CODES).toEqual({
      '0': '中长期电量',
      '1': '日前电量',
      '2': '实时电量',
      '3': '实时电量加权',
      '4': '预估电量',
      '8': '主策略',
      '9': '小策略',
      '14': 'AI策略1',
      '15': '日前电量AI1',
      '16': 'AI策略2',
      '17': '日前电量AI2',
      '72': '执行策略',
    })
  })

  it('价格口径 10 项逐项等于旧组件硬编码', () => {
    expect(DECLARATION_PRICE_TYPE_CODES).toEqual({
      '0': '日前价出清',
      '1': '实时价出清',
      '8': '日前价回归',
      '30': '日前价电厂预测',
      '40': '日前价公司预测',
      '41': '日前价国能日新预测',
      '45': '日前价AI预测2',
      '61': '日前价AI预测1',
      '62': '实时价AI预测1',
      '11': '实时价公司预测',
    })
  })

  it('口径红线锚点：申报量口径 type=1 必须是「日前电量」（#1498 事故位）', () => {
    expect(DECLARATION_QTY_TYPE_CODES['1']).toBe('日前电量')
    expect(DECLARATION_PRICE_TYPE_CODES['0']).toBe('日前价出清')
    expect(DECLARATION_CODES_SCHEMA_VERSION).toBe('declaration-codes/v1')
  })

  it('视图不再持有字典字面量（病灶复发即红）', () => {
    const view = readFileSync(new URL('../views/DayAheadReportView.vue', import.meta.url), 'utf8')
    expect(view).not.toMatch(/const ZPTQX[^=]*=\s*\{/)
    expect(view).not.toMatch(/const ZPTJG[^=]*=\s*\{/)
    expect(view).toContain("@/data/declarationCodes")
  })
})
