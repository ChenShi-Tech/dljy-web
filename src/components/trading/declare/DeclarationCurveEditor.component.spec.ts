// DeclarationCurveEditor 受控组件测试（merge-declare-desk-into-s4 任务 2.1/5.1）
// 守什么：① 编辑器从 props 单据灌入 96 点（MWh×4=MW）；② 改点置脏后才可保存，
//        保存走 updateDeclarationCurve（MW/4 回 MWh）并 emit updated——组件不自持单据；
//        ③ 清空时点（非法输入）挡住保存。
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

vi.mock('@/services/declarations', () => ({
  EDITABLE_DRAFT_STATUSES: ['DRAFT', 'RISK_CHECKED', 'REJECTED'],
  STATUS_LABEL: { DRAFT: '草稿' },
  editorMwOf: (v: unknown) => {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return Number.NaN
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : Number.NaN
  },
  invalidPointIndexesOf: (points: unknown[]) =>
    points.flatMap((v, i) => {
      if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return [i]
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? [] : [i]
    }),
  isCurveEdited: (pointMw96: number[], saved?: number[] | null) => {
    if (!Array.isArray(saved) || saved.length !== 96) return false
    return pointMw96.some((mw, i) => Math.abs(saved[i]! - Math.round((mw / 4) * 10000) / 10000) > 1e-6)
  },
  updateDeclarationCurve: vi.fn(async (id: string, input: { energyCurveMwh96: number[] }) => ({
    id,
    energyCurveMwh96: input.energyCurveMwh96,
    status: 'DRAFT'
  }))
}))

vi.mock('@/composables/useEChart', () => ({
  useEChart: () => ({ setOption: vi.fn(), instance: () => null, resize: vi.fn(), loading: { value: false } })
}))

vi.mock('@/components/DataBasisBadge.vue', () => ({
  default: { name: 'DataBasisBadge', template: '<span />' }
}))

import DeclarationCurveEditor from './DeclarationCurveEditor.vue'
import { updateDeclarationCurve } from '@/services/declarations'
import { mount } from '@/test/mount'

function declaration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'DECL-E1',
    status: 'DRAFT',
    targetDate: '2026-10-10',
    capacityMw: 100,
    basis: 'captured',
    energyCurveMwh96: Array.from({ length: 96 }, () => 2.5), // = 10 MW/点
    ...overrides
  }
}

async function mountEditor(props: Record<string, unknown> = {}) {
  const wrapper = mount(DeclarationCurveEditor, {
    props: { declaration: declaration(), ...props }
  })
  await flushPromises()
  return wrapper
}

describe('DeclarationCurveEditor（受控 96 点编辑器）', () => {
  it('从单据灌入曲线：总量 240 MWh，保存键未脏不可用', async () => {
    const w = await mountEditor()
    expect(w.text()).toContain('申报总量')
    expect(w.text()).toContain('240')
    const save = w.findAll('button').find((b) => b.text() === '保存曲线')
    expect(save).toBeTruthy()
    expect(save!.attributes('disabled')).toBeDefined()
  })

  it('改点置脏 → 保存走 updateDeclarationCurve 并 emit updated（MW/4 回 MWh）', async () => {
    vi.mocked(updateDeclarationCurve).mockClear()
    const w = await mountEditor()
    const firstInput = w.find('.dce-point-grid input')
    await firstInput.setValue('20') // 20 MW → 5 MWh
    const save = w.findAll('button').find((b) => b.text() === '保存曲线')!
    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')
    await flushPromises()
    expect(updateDeclarationCurve).toHaveBeenCalledWith('DECL-E1', expect.objectContaining({
      energyCurveMwh96: expect.arrayContaining([5])
    }))
    const payload = vi.mocked(updateDeclarationCurve).mock.calls[0]![1] as { energyCurveMwh96: number[] }
    expect(payload.energyCurveMwh96).toHaveLength(96)
    expect(payload.energyCurveMwh96[1]).toBe(2.5)
    expect(w.emitted('updated')).toBeTruthy()
  })

  it('清空时点（非法输入）挡住保存并点名时点', async () => {
    const w = await mountEditor()
    const firstInput = w.find('.dce-point-grid input')
    await firstInput.setValue('')
    expect(w.text()).toContain('未填或为负数')
    const save = w.findAll('button').find((b) => b.text() === '保存曲线')!
    expect(save.attributes('disabled')).toBeDefined()
  })

  it('复制历史曲线候选由父级 historyRows 供给，排除当日单自身', async () => {
    const w = await mountEditor({
      historyRows: [
        declaration({ id: 'DECL-E1' }),
        declaration({ id: 'DECL-OLD', targetDate: '2026-10-01' })
      ]
    })
    const select = w.find('.dce-batch-row select')
    expect(select.exists()).toBe(true)
    expect(select.text()).toContain('DECL-OLD')
    expect(select.text()).not.toContain('DECL-E1（')
  })

  // D7 验收反馈：复制历史曲线入口在编辑器工具区常显，打开（聚焦/点按）时才让父级
  // 懒加载候选列表——不藏在⑥段历史单列表里。
  it('复制历史曲线入口常显：无候选时聚焦下拉发出 request-history（懒加载）', async () => {
    const w = await mountEditor() // 不传 historyRows：入口仍渲染
    const select = w.find('.dce-batch-row select')
    expect(select.exists()).toBe(true)
    expect(select.text()).toContain('加载/查看历史申报单')
    await select.trigger('focus')
    expect(w.emitted('request-history')).toBeTruthy()
  })
})
