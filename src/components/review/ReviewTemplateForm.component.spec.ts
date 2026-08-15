// 通用复盘模板渲染器组件测试（Epic #2033 · M1 · #2038 验收：覆盖模板渲染器主路径）
// 红线断言：human 判断栏无 AI 建议入口；金额 caliber 标注；slots24 聚合与峰谷未参数化提示。
import { describe, expect, it } from 'vitest'
import ReviewTemplateForm from './ReviewTemplateForm.vue'
import { mount } from '@/test/mount'
import type { SettlementRuleSpec } from '@/rules/types'

const spec = (timeSegmentFactors: SettlementRuleSpec['timeSegmentFactors']): SettlementRuleSpec =>
  ({
    regionId: 'test', version: 'v0', effectiveness: 'trial', deviationTolerancePct: 3,
    assessmentPriceBasis: 'da', assessmentPriceFloor: 0, timeSegmentFactors,
    recycleSubjects: [], notes: [], references: []
  }) as SettlementRuleSpec

describe('ReviewTemplateForm（模板渲染器）', () => {
  it('未知模板 id → 诚实未知态', () => {
    const wrapper = mount(ReviewTemplateForm, { props: { templateId: 'X99', spec: null } })
    expect(wrapper.text()).toContain('未知模板')
  })

  it('T01 决策复盘单主路径：auto 只读带来源徽章 / human 必填可编辑 / 判断栏红线 / 提交禁用', () => {
    const wrapper = mount(ReviewTemplateForm, {
      props: { templateId: 'T01', spec: null, autofill: { decisionNo: 'JC-20260814-001', quantityMwh: 240 } }
    })
    const text = wrapper.text()
    // 头部元信息
    expect(text).toContain('决策复盘单')
    expect(text).toContain('决策复盘 · 通用')
    expect(text).toContain('B 档：系统预填事实、人补判断')
    // auto 字段值 + 来源徽章
    expect(text).toContain('JC-20260814-001')
    expect(wrapper.find('.rtf-source').text()).toBe('review_pg')
    // 未喂数的 auto 字段诚实显示
    expect(text).toContain('待喂数')
    // human 必填字段：有输入框且带必填标
    const labels = wrapper.findAll('.rtf-label').map((l) => l.text())
    expect(labels.some((l) => l.includes('决策依据—信息') && l.includes('必填'))).toBe(true)
    expect(wrapper.findAll('textarea')).toHaveLength(8) // T01 全部 8 个人工字段
    // 判断栏红线 + 提交锁定说明
    expect(text).toContain('判断栏严禁系统代填')
    expect(text).toContain('提交后锁定，更正走追加记录')
    const submit = wrapper.find('.rtf-submit')
    expect(submit.attributes('disabled')).toBeDefined()
    expect(text).toContain('当前仅本地预览')
  })

  it('T03 金额字段带 caliber 口径标注', () => {
    const wrapper = mount(ReviewTemplateForm, { props: { templateId: 'T03', spec: null } })
    expect(wrapper.text()).toContain('口径 self-computed')
  })

  it('T06 ai_suggest 字段：建议→采纳交互（不点采纳不进草稿）', async () => {
    const wrapper = mount(ReviewTemplateForm, {
      props: { templateId: 'T06', spec: null, aiSuggestions: { drivers: '供需趋紧叠加高温负荷' } }
    })
    expect(wrapper.text()).toContain('建议：供需趋紧叠加高温负荷')
    // 未采纳时无输入框
    expect(wrapper.find('.rtf-ai-row input').exists()).toBe(false)
    await wrapper.find('.rtf-adopt').trigger('click')
    expect(wrapper.find('.rtf-ai-row input').exists()).toBe(true)
    expect(wrapper.text()).toContain('已采纳')
  })

  it('ai_suggest 无建议 → 「未生成」占位（#2044 未上线不装样子）', () => {
    const wrapper = mount(ReviewTemplateForm, { props: { templateId: 'T06', spec: null } })
    expect(wrapper.text()).toContain('AI 建议未生成')
    expect(wrapper.text()).toContain('#2044')
  })

  it('slots24 模板 E1：24 行聚合视图；未参数化省份峰谷显式提示不借用', () => {
    const wrapper = mount(ReviewTemplateForm, { props: { templateId: 'E1', spec: null } })
    const text = wrapper.text()
    expect(text).toContain('24 时段视图')
    expect(text).toContain('底层 96 点')
    expect(text).toContain('峰谷时段未参数化')
    expect(text).toContain('不借用他省')
    // 24 行 + 无曲线诚实「—」
    expect(wrapper.findAll('.rtf-slots tbody tr')).toHaveLength(24)
    expect(text).toContain('时段曲线未喂数')
  })

  it('slots24 峰谷标识读 SettlementRuleSpec；96 点曲线聚合出数', () => {
    const curve96 = Array.from({ length: 96 }, (_, i) => (i % 4 === 0 ? 4 : 0)) // 每小时首点 4 → 每时段 4
    const wrapper = mount(ReviewTemplateForm, {
      props: {
        templateId: 'E1',
        spec: spec([{ segment: '峰', hours: [10, 11], factor: 1.2 }, { segment: '谷', hours: [0, 1], factor: 0.4 }]),
        autofill: { daForecastPrice: curve96 }
      }
    })
    const rows = wrapper.findAll('.rtf-slots tbody tr')
    expect(rows[10].text()).toContain('峰')
    expect(rows[0].text()).toContain('谷')
    expect(rows[15].text()).toContain('平')
    expect(rows[5].text()).toContain('4.00')
  })
})
