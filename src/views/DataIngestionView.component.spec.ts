// 数据摄取管理面板契约（dljy#3385 版式精简后）：
// ① 精简只收说明、不动行为——每个入口的「立即摄取」仍按原 kind 与参数触发（中广核两项的回看窗口是 #2203 的修复，丢了就回到单拉「今天」404）；
// ② 会改变结果的提醒（中广核专属）必须常显在首屏，不能跟着说明一起收进弹层；
// ③ 结果回显诚实：失败如实报失败，合成兜底降级为「仅决策支持」，接口报错透出原因。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { IngestResult } from '@/services/data/ingestClient'

const triggerIngest = vi.fn()

vi.mock('@/services/data/ingestClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/data/ingestClient')>()),
  triggerIngest: (...args: unknown[]) => triggerIngest(...args)
}))

import DataIngestionView from './DataIngestionView.vue'

const stubs = { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } }

function result(partial: Partial<IngestResult>): IngestResult {
  return {
    code: 200, ok: true, kind: 'weather-export', label: '', actor: 'demo', isService: false,
    exitCode: 0, timedOut: false, stdout: '', stderr: '', ...partial
  }
}

async function mountView() {
  const wrapper = mount(DataIngestionView, { global: { stubs } })
  await flushPromises()
  return wrapper
}

async function clickTrigger(wrapper: Awaited<ReturnType<typeof mountView>>, kind: string) {
  await wrapper.get(`[data-kind="${kind}"] .trigger`).trigger('click')
  await flushPromises()
}

describe('数据摄取管理面板', () => {
  beforeEach(() => {
    triggerIngest.mockReset()
  })

  it('四个入口按「中广核在前、公共数据在后」排列，每行都有立即摄取按钮', async () => {
    const wrapper = await mountView()
    const kinds = wrapper.findAll('.kind-row').map((row) => row.attributes('data-kind'))
    expect(kinds).toEqual(['cgn-yunnan-prices', 'cgn-yunnan-market', 'weather-export', 'spot-export'])
    expect(wrapper.findAll('.kind-row .trigger').every((b) => b.text() === '立即摄取')).toBe(true)
  })

  it('首屏不再铺整段说明，但改变结果的提醒仍常显', async () => {
    const wrapper = await mountView()
    const text = wrapper.text()
    // 原底部长说明与逐卡参数口径已收进弹层（弹层内容 teleport 到 body，不在首屏文本里）
    expect(text).not.toContain('服务端白名单硬编码')
    expect(text).not.toContain('export_manifest.csv')
    // 会改变摄取结果的提醒不能藏（原「默认山西目录」随市场分析族入口下线，ChenShi-Tech/dljy#3391）
    expect(text).toContain('中广核专属 · 写中广核私有库')
  })

  it('按钮按原 kind 与原参数触发：中广核两项带回看窗口，其余不带参数', async () => {
    triggerIngest.mockResolvedValue(result({}))
    const wrapper = await mountView()
    await clickTrigger(wrapper, 'cgn-yunnan-prices')
    await clickTrigger(wrapper, 'cgn-yunnan-market')
    await clickTrigger(wrapper, 'weather-export')
    await clickTrigger(wrapper, 'spot-export')
    expect(triggerIngest.mock.calls).toEqual([
      ['cgn-yunnan-prices', { lookbackDays: 3, market: 'day_ahead', interval: '15m' }],
      ['cgn-yunnan-market', { resource: 'all', lookbackDays: 3 }],
      ['weather-export', {}],
      ['spot-export', {}]
    ])
  })

  it('合成兜底如实降级：成功但输出含合成标记时标「合成兜底」与「仅决策支持」', async () => {
    triggerIngest.mockResolvedValue(result({ stdout: 'sourceType=MOCK (--synthetic 合成)' }))
    const wrapper = await mountView()
    await clickTrigger(wrapper, 'weather-export')
    const box = wrapper.get('[data-kind="weather-export"] .result')
    expect(box.text()).toContain('✓ 摄取完成·合成兜底 · exitCode 0')
    expect(box.text()).toContain('仅决策支持')
  })

  it('真实摄取成功标「可决策」；失败与超时如实回显；接口报错透出原因', async () => {
    triggerIngest
      .mockResolvedValueOnce(result({ stdout: 'wrote 96 rows' }))
      .mockResolvedValueOnce(result({ ok: false, exitCode: 1, timedOut: true, stdout: '', stderr: 'ETIMEDOUT' }))
      .mockRejectedValueOnce(new Error('该数据链路固定归属 comp-cgn-yunnan，当前账号不能触发'))
    const wrapper = await mountView()

    await clickTrigger(wrapper, 'spot-export')
    const ok = wrapper.get('[data-kind="spot-export"] .result')
    expect(ok.classes()).toContain('ok')
    expect(ok.text()).toContain('✓ 摄取成功 · exitCode 0')
    expect(ok.text()).toContain('可决策')

    await clickTrigger(wrapper, 'weather-export')
    const fail = wrapper.get('[data-kind="weather-export"] .result')
    expect(fail.classes()).toContain('fail')
    expect(fail.text()).toContain('✗ 摄取失败 · exitCode 1 · 超时')
    expect(fail.text()).toContain('ETIMEDOUT')

    await clickTrigger(wrapper, 'cgn-yunnan-prices')
    expect(wrapper.get('[data-kind="cgn-yunnan-prices"] .result.err').text()).toContain('当前账号不能触发')
  })

  it('执行中按钮置灰防连点，结束后恢复', async () => {
    let resolve!: (r: IngestResult) => void
    triggerIngest.mockReturnValue(new Promise<IngestResult>((r) => { resolve = r }))
    const wrapper = await mountView()
    await wrapper.get('[data-kind="weather-export"] .trigger').trigger('click')
    const btn = wrapper.get('[data-kind="weather-export"] .trigger')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.text()).toBe('摄取中…')
    resolve(result({}))
    await flushPromises()
    expect(wrapper.get('[data-kind="weather-export"] .trigger').attributes('disabled')).toBeUndefined()
  })
})
