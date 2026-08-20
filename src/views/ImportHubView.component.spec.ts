// @vitest-environment happy-dom
//
// 融合台的 Mock 标注不变量（#2355）。
//
// 这一页混着两类数据：真实导入记录（/v1/import-hub/records）和前端固定公式生成的
// 示意数据。CLAUDE.md 的 Mock 规则是强制项——示意数据必须有可见标注，违反按 P1 处理。
// 标注是「一行 alert / 一个徽章」这种最容易在重构里被顺手删掉的东西，且删了页面照常
// 渲染、没有任何自动信号，所以在这里钉死。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/services/api', () => ({
  apiGet: vi.fn(async () => ({ data: { rows: [] } })),
  apiPost: vi.fn(async () => ({ data: {} })),
  ApiError: class extends Error {},
}))
vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { value: { id: 'yunnan', name: '云南' } },
}))
vi.mock('@/services/agent/httpClient', () => ({
  createAgentClient: () => ({ postForm: vi.fn() }),
}))
vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

import ImportHubView from './ImportHubView.vue'

const STUBS = {
  TrustBadge: { props: ['basis', 'prefix'], template: '<span class="stub-trust" :data-basis="basis" />' },
  'el-alert': { props: ['title', 'type'], template: '<div class="stub-alert" :data-type="type">{{ title }}</div>' },
  'el-table': { template: '<div class="stub-table"><slot /></div>' },
  'el-table-column': { template: '<div />' },
  'el-radio-group': { template: '<div><slot /></div>' },
  'el-radio-button': { template: '<button><slot /></button>' },
  'el-button': { template: '<button><slot /></button>' },
  'el-tag': { template: '<span><slot /></span>' },
  'el-select': { template: '<select><slot /></select>' },
  'el-option': { template: '<option />' },
  'el-tooltip': { template: '<span><slot /></span>' },
}

function mountHub() {
  return mount(ImportHubView, { global: { stubs: STUBS } })
}

describe('融合台示意数据必须带标注', () => {
  it('售电结算预览有 illustrative 徽章 + 说明为示意数据、不可作结算依据', () => {
    const w = mountHub()
    const badge = w.findAll('.stub-trust').find((b) => b.attributes('data-basis') === 'illustrative')
    expect(badge, '售电结算预览缺 illustrative 口径徽章').toBeTruthy()
    const notice = w.findAll('.stub-alert').map((a) => a.text()).join('\n')
    expect(notice).toContain('示意数据')
    // 金额类内容必须说清不能作依据——这一句是这条标注真正的作用
    expect(notice).toMatch(/不可作为对账或结算依据|不是任何一次真实结算/)
  })

  it('指标卡在没有真实记录时标「演示」而不是「导入」', async () => {
    // 默认 tab 是 retailSettlement（真实历史因公司隔离未接入 → metricsAreReal=false）
    const w = mountHub()
    await w.vm.$nextTick()
    const tags = w.findAll('.metric-card em').map((e) => e.text())
    expect(tags.length).toBeGreaterThan(0)
    expect(tags.every((t) => t === '演示'), `指标卡标记应全为「演示」，实际：${tags.join('/')}`).toBe(true)
  })
})
