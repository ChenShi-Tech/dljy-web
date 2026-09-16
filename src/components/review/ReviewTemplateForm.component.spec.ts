// 通用复盘模板渲染器组件测试（Epic #2033 · M1 · #2038 验收：覆盖模板渲染器主路径）
// 红线断言：human 判断栏无 AI 建议入口；金额 caliber 标注；slots24 聚合与峰谷未参数化提示。
// #2037 前端切换：传 instance 时草稿/提交直连服务端（PATCH 传输层 mock 掉，只测组件逻辑）。
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/services/review/templateInstanceClient', () => ({
  patchTemplateInstance: vi.fn()
}))

import { patchTemplateInstance } from '@/services/review/templateInstanceClient'
import ReviewTemplateForm from './ReviewTemplateForm.vue'
import { mount } from '@/test/mount'
import type { SettlementRuleSpec } from '@/rules/types'
import type { TemplateInstanceSummary } from '@/services/review/templateInstanceApi'

const spec = (timeSegmentFactors: SettlementRuleSpec['timeSegmentFactors']): SettlementRuleSpec =>
  ({
    regionId: 'test', version: 'v0', effectiveness: 'trial', deviationTolerancePct: 3,
    assessmentPriceBasis: 'da', assessmentPriceFloor: 0, timeSegmentFactors,
    recycleSubjects: [], notes: [], references: []
  }) as SettlementRuleSpec

const instance = (over: Partial<TemplateInstanceSummary> = {}): TemplateInstanceSummary => ({
  id: '42',
  templateId: 'T01',
  periodKey: '2026-08-18',
  status: 'pending',
  dueAt: null,
  updatedAt: null,
  ...over
})

beforeEach(() => {
  vi.mocked(patchTemplateInstance).mockReset()
})

/** PATCH 是异步链：点击后多轮 nextTick 等 promise 落定 + 重渲染。 */
async function settle(): Promise<void> {
  const { nextTick } = await import('vue')
  await nextTick(); await nextTick(); await nextTick()
}

describe('ReviewTemplateForm（模板渲染器）', () => {
  it('未知模板 id → 诚实未知态', () => {
    const wrapper = mount(ReviewTemplateForm, { props: { templateId: 'X99', spec: null } })
    expect(wrapper.text()).toContain('已下线或链接已过期')
    expect(wrapper.text()).not.toContain('注册表')
  })

  it('T01 决策复盘单主路径：auto 只读带来源徽章 / human 必填可编辑 / 判断栏红线 / 提交禁用', () => {
    const wrapper = mount(ReviewTemplateForm, {
      props: { templateId: 'T01', spec: null, autofill: { decisionNo: 'JC-20260814-001', quantityMwh: 240 } }
    })
    const text = wrapper.text()
    // 头部元信息
    expect(text).toContain('决策复盘单')
    expect(text).toContain('决策复盘 · 通用')
    expect(text).toContain('系统预填事实、人工补充判断')
    expect(text).not.toMatch(/[ABC] 档|TRADE_LEAD|TRADER|STORAGE_OPERATOR|\bdaily\b|\bmonthly\b/)
    // auto 字段值 + 来源徽章
    expect(text).toContain('JC-20260814-001')
    expect(wrapper.find('.rtf-source').text()).toBe('复盘台账')
    // 缺数据的 auto 字段诚实显示
    expect(text).toContain('暂无数据')
    // 页面不得出现数据源代号或模板编号
    expect(text).not.toMatch(/review_pg|quant_[a-z_]+|declaration_record|manual_entry|\bT\d{2}\b/)
    // human 必填字段：有输入框且带必填标
    const labels = wrapper.findAll('.rtf-label').map((l) => l.text())
    expect(labels.some((l) => l.includes('决策依据—信息') && l.includes('必填'))).toBe(true)
    expect(wrapper.findAll('textarea')).toHaveLength(8) // T01 全部 8 个人工字段
    // 判断栏红线 + 提交锁定说明
    expect(text).toContain('判断栏严禁系统代填')
    expect(text).toContain('提交后锁定，如需更正请追加记录')
    const submit = wrapper.find('.rtf-submit')
    expect(submit.attributes('disabled')).toBeDefined()
    expect(text).toContain('当前是预览，内容不会保存')
  })

  it('T03 金额字段带 caliber 口径标注', () => {
    const wrapper = mount(ReviewTemplateForm, { props: { templateId: 'T03', spec: null } })
    expect(wrapper.text()).toContain('系统自算，非正式结算')
    expect(wrapper.text()).not.toContain('self-computed')
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
    // 采纳即建议入框：输入框初始值是建议文本（可人工修改），不是空框
    expect((wrapper.find('.rtf-ai-row input').element as HTMLInputElement).value).toBe('供需趋紧叠加高温负荷')
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
    expect(text).toContain('峰谷时段尚未配置')
    expect(text).toContain('不借用其他省份')
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

describe('ReviewTemplateForm（#2037 实例提交：草稿/提交直连服务端）', () => {
  it('无实例（chip 直开纯预览）：提交禁用 + 指引从待办箱填报（回归）', () => {
    const wrapper = mount(ReviewTemplateForm, { props: { templateId: 'T01', spec: null } })
    expect(wrapper.find('.rtf-submit').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('当前是预览，内容不会保存')
  })

  it('pending 实例：必填未齐提交禁用；填齐后存草稿/提交各发 PATCH 并 emit saved', async () => {
    vi.mocked(patchTemplateInstance).mockResolvedValue()
    const wrapper = mount(ReviewTemplateForm, {
      props: { templateId: 'T01', spec: null, instance: instance() }
    })
    // 实例状态行 + 必填未齐 → 两个按钮都禁用
    expect(wrapper.text()).not.toContain('#42')
    expect(wrapper.text()).toContain('待填报')
    expect(wrapper.find('.rtf-submit.live').attributes('disabled')).toBeDefined()
    // 填齐全部人工字段（T01 8 个，其中 5 个必填）
    for (const ta of wrapper.findAll('textarea')) await ta.setValue('人工判断内容')
    expect(wrapper.find('.rtf-submit.live').attributes('disabled')).toBeUndefined()
    // 存草稿：只发 payload（pending→draft 由服务端状态机迁移）
    await wrapper.find('.rtf-save').trigger('click')
    await settle()
    expect(patchTemplateInstance).toHaveBeenCalledWith('42', { payload: expect.objectContaining({ basisInfo: '人工判断内容' }) })
    expect(wrapper.emitted('saved')?.[0]).toEqual(['draft'])
    // 提交：payload + status
    await wrapper.find('.rtf-submit.live').trigger('click')
    await settle()
    expect(patchTemplateInstance).toHaveBeenLastCalledWith(
      '42',
      { payload: expect.objectContaining({ conclusionInfo: '人工判断内容' }), status: 'submitted' }
    )
    expect(wrapper.emitted('saved')?.[1]).toEqual(['submitted'])
    expect(wrapper.text()).toContain('已提交并锁定')
  })

  it('draft 实例带 payload：重开回填已填内容（不丢草稿）', () => {
    const wrapper = mount(ReviewTemplateForm, {
      props: {
        templateId: 'T01',
        spec: null,
        instance: instance({ status: 'draft', payload: { basisInfo: '昨日已填的依据', conclusionInfo: '结论草稿' } })
      }
    })
    const values = wrapper.findAll('textarea').map((ta) => ta.element.value)
    expect(values).toContain('昨日已填的依据')
    expect(values).toContain('结论草稿')
    expect(wrapper.text()).toContain('草稿（已动笔）')
  })

  it('submitted 实例：锁定只读（输入框禁用 + 状态行），不发 PATCH', async () => {
    const wrapper = mount(ReviewTemplateForm, {
      props: {
        templateId: 'T01',
        spec: null,
        instance: instance({ status: 'submitted', payload: { basisInfo: '已提交内容' } })
      }
    })
    expect(wrapper.findAll('textarea').every((ta) => ta.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.text()).toContain('已提交（锁定）')
    expect(wrapper.text()).toContain('待管理员或公司负责人复核')
    expect(wrapper.text()).not.toMatch(/ADMIN|BOSS|拍板/)
    expect(wrapper.find('.rtf-save').exists()).toBe(false)
    expect(patchTemplateInstance).not.toHaveBeenCalled()
  })

  it('PATCH 失败（409/403 文案）如实展示，不 emit saved', async () => {
    vi.mocked(patchTemplateInstance).mockRejectedValue(new Error('模板实例状态 submitted 不允许迁移到 submitted'))
    const wrapper = mount(ReviewTemplateForm, {
      props: { templateId: 'T01', spec: null, instance: instance() }
    })
    for (const ta of wrapper.findAll('textarea')) await ta.setValue('内容')
    await wrapper.find('.rtf-save').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('不允许迁移到 submitted')
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('模板备注只显示业务规则：险情须入案例库等规则保留，议题号与实现说明不出现', () => {
    const wrapper = mount(ReviewTemplateForm, { props: { templateId: 'T09' } })
    expect(wrapper.text()).toContain('侥幸逃过的险情单独附记')
    expect(wrapper.text()).toContain('须登记到复盘案例库')
    expect(wrapper.text()).not.toMatch(/near_miss|#20\d\d/)
  })
  it('模拟提示点名来自演示价格测算的字段，不笼统说本表价格', () => {
    const wrapper = mount(ReviewTemplateForm, { props: { templateId: 'S3' } })
    expect(wrapper.text()).toContain('模拟数据')
    expect(wrapper.text()).toContain('计划充电量 MWh')
    expect(wrapper.text()).not.toContain('本表的价格')
    expect(mount(ReviewTemplateForm, { props: { templateId: 'T01' } }).text()).not.toContain('模拟数据')
  })
})
