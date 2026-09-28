// 数据接入向导面板契约（dljy#3385 版式精简后）：
// ① 状态如实：新鲜度标签、五步线、模板进度都来自数据目录与导入台账；取数失败一律「未知」，不猜；
// ② 判不出状态的卡（中广核私有库、台账型）不画五步线，免得常年半亮被读成「未生效」；
// ③ 精简只收说明、不动操作：一键生效仍按原 kind 触发，成功后重读状态；命令行仍常显可复制。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { IngestResult } from '@/services/data/ingestClient'

const apiGet = vi.fn()
const triggerIngest = vi.fn()

vi.mock('@/services/api', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }))
vi.mock('@/services/data/ingestClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/data/ingestClient')>()),
  triggerIngest: (...args: unknown[]) => triggerIngest(...args)
}))

import DataOnboardingView from './DataOnboardingView.vue'

const HOUR = 3_600_000
const stubs = { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } }

function mockSignals() {
  apiGet.mockImplementation((path: string, params?: { templateId?: string }) => {
    if (path === '/api/v1/governance/catalog') {
      return Promise.resolve({
        items: [
          { family: 'yn_node_price', dataTime: new Date(Date.now() - 2 * HOUR).toISOString() },
          { family: 'yn_meteo', dataTime: new Date(Date.now() - 5 * 24 * HOUR).toISOString() }
        ]
      })
    }
    if (path === '/api/v1/import-templates/records') {
      const rows = params?.templateId === 'yn-t0-node-price' ? [{ status: 'COMMITTED', deliveredPaths: ['x.csv'] }] : []
      return Promise.resolve({ rows, total: rows.length })
    }
    return Promise.reject(new Error(`未预期的路径 ${path}`))
  })
}

function result(partial: Partial<IngestResult>): IngestResult {
  return {
    code: 200, ok: true, kind: 'spot-ingest', label: '', actor: 'demo', isService: false,
    exitCode: 0, timedOut: false, stdout: 'ok', stderr: '', ...partial
  }
}

async function mountView() {
  const wrapper = mount(DataOnboardingView, { global: { stubs } })
  await flushPromises()
  return wrapper
}

const card = (wrapper: Awaited<ReturnType<typeof mountView>>, key: string) => wrapper.get(`[data-card="${key}"]`)
const stepStates = (wrapper: Awaited<ReturnType<typeof mountView>>, key: string) =>
  card(wrapper, key).findAll('.step').map((s) => (s.classes().includes('done') ? 'done' : 'pending'))
const catalogCalls = () => apiGet.mock.calls.filter(([p]) => p === '/api/v1/governance/catalog').length
const refreshButton = (wrapper: Awaited<ReturnType<typeof mountView>>) =>
  wrapper.findAll('button').find((b) => b.text() === '刷新状态')!

describe('数据接入向导面板', () => {
  beforeEach(() => {
    apiGet.mockReset()
    triggerIngest.mockReset()
  })

  it('六张卡片，中广核自动通道排第一；判不出状态的两张不画五步线', async () => {
    mockSignals()
    const wrapper = await mountView()
    expect(wrapper.findAll('.journey-card').map((c) => c.attributes('data-card'))).toEqual([
      'cgn-auto', 'node-price', 'load-hydro', 'monthly-export', 'weather', 'ledger'
    ])
    expect(card(wrapper, 'cgn-auto').find('.journey-line').exists()).toBe(false)
    expect(card(wrapper, 'cgn-auto').get('.tag').text()).toBe('每日自动')
    expect(card(wrapper, 'ledger').find('.journey-line').exists()).toBe(false)
    expect(card(wrapper, 'ledger').get('.tag').text()).toBe('台账型')
  })

  it('状态取自目录与台账：新鲜度、五步线、模板进度如实点亮', async () => {
    mockSignals()
    const wrapper = await mountView()

    const nodePrice = card(wrapper, 'node-price')
    expect(nodePrice.get('.tag').text()).toBe('数据新鲜')
    expect(stepStates(wrapper, 'node-price')).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(nodePrice.get('.status-line').text()).toContain('模板 yn-t0-node-price：已上传并提交')

    const loadHydro = card(wrapper, 'load-hydro')
    expect(loadHydro.get('.tag').text()).toBe('数据未知')
    expect(stepStates(wrapper, 'load-hydro')).toEqual(['pending', 'pending', 'pending', 'pending', 'pending'])
    expect(loadHydro.get('.status-line').text()).toContain('yn-t0-system-load / yn-t1-hydro：未上传')

    // 气象：前三步由定时任务自动完成常亮；数据 5 天前，按日更节律判过期
    expect(card(wrapper, 'weather').get('.tag').text()).toBe('数据过期')
    expect(card(wrapper, 'weather').get('.status-line').text()).toContain('每日 06:30 定时采集')
  })

  it('状态取数失败：显示失败原因，卡片一律「未知」，操作按钮照常可用', async () => {
    apiGet.mockRejectedValue(new Error('HTTP 502'))
    const wrapper = await mountView()
    expect(wrapper.get('.load-err').text()).toContain('HTTP 502')
    for (const key of ['node-price', 'load-hydro', 'monthly-export', 'weather']) {
      expect(card(wrapper, key).get('.tag').text()).toBe('数据未知')
    }
    expect(card(wrapper, 'node-price').get('.effect-btn').attributes('disabled')).toBeUndefined()
  })

  it('刷新失败即作废上一轮快照：不能一边报失败、一边继续显示「新鲜 / 已提交」（codex R1-01）', async () => {
    mockSignals()
    const wrapper = await mountView()
    expect(card(wrapper, 'node-price').get('.tag').text()).toBe('数据新鲜')

    apiGet.mockRejectedValue(new Error('HTTP 502'))
    await refreshButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.get('.load-err').text()).toContain('HTTP 502')
    expect(card(wrapper, 'node-price').get('.tag').text()).toBe('数据未知')
    expect(card(wrapper, 'node-price').get('.status-line').text()).toContain('模板 yn-t0-node-price：状态未知')
    expect(stepStates(wrapper, 'node-price')).toEqual(['pending', 'pending', 'pending', 'pending', 'pending'])
  })

  it('单个模板台账取数失败显示「状态未知」，不冒充「未上传」', async () => {
    mockSignals()
    const base = apiGet.getMockImplementation()!
    apiGet.mockImplementation((path: string, params?: { templateId?: string }) =>
      params?.templateId === 'yn-t1-hydro' ? Promise.reject(new Error('HTTP 500')) : base(path, params)
    )
    const wrapper = await mountView()
    expect(card(wrapper, 'load-hydro').get('.status-line').text()).toContain('yn-t0-system-load / yn-t1-hydro：状态未知')
    expect(card(wrapper, 'node-price').get('.status-line').text()).toContain('已上传并提交')
  })

  it('刷新与「生效后重读」赛跑：先发起的慢请求晚到，不得覆盖后发起的结果', async () => {
    mockSignals()
    const wrapper = await mountView()
    const base = apiGet.getMockImplementation()!
    let releaseSlow!: () => void
    let catalogCall = 0
    apiGet.mockImplementation((path: string, params?: { templateId?: string }) => {
      if (path !== '/api/v1/governance/catalog') return base(path, params)
      catalogCall += 1
      if (catalogCall === 1) return new Promise((r) => { releaseSlow = () => r(base(path, params)) })
      return Promise.reject(new Error('HTTP 503'))
    })

    // 刷新按钮加载中会置灰，真实的并发来源是：刷新进行中，一键生效成功又触发一次重读。
    triggerIngest.mockResolvedValue(result({ kind: 'spot-ingest' }))
    await refreshButton(wrapper).trigger('click') // 先发起、慢，最终会成功
    await card(wrapper, 'node-price').get('.effect-btn').trigger('click') // 后发起的重读，失败
    await flushPromises()
    expect(catalogCall).toBe(2)
    releaseSlow()
    await flushPromises()

    expect(wrapper.get('.load-err').text()).toContain('HTTP 503')
    expect(card(wrapper, 'node-price').get('.tag').text()).toBe('数据未知')
  })

  it('首屏不铺说明文字，但命令行与去哪见数常显', async () => {
    mockSignals()
    const wrapper = await mountView()
    const text = wrapper.text()
    expect(text).not.toContain('交易中心发布的日前节点电价')   // 「是什么」已收进卡片说明
    expect(text).not.toContain('本身不产生数据')               // 页级口径已收进工具栏说明
    expect(card(wrapper, 'monthly-export').get('.cmd-box code').text()).toBe('npm run import:spot-export -- --dir <解压包目录> --write')
    expect(card(wrapper, 'node-price').findAll('.consume-link').map((a) => a.attributes('href'))).toEqual([
      '/xhjy/yunnan/node-price', '/ycsj/workbench'
    ])
  })

  it('一键生效按原 kind 触发；成功后重读状态，失败不重读', async () => {
    mockSignals()
    triggerIngest
      .mockResolvedValueOnce(result({ kind: 'spot-ingest' }))
      .mockResolvedValueOnce(result({ kind: 'forecast-etl', ok: false, exitCode: 2, stderr: 'no delivered file' }))
    const wrapper = await mountView()
    expect(catalogCalls()).toBe(1)

    await card(wrapper, 'node-price').get('.effect-btn').trigger('click')
    await flushPromises()
    expect(triggerIngest).toHaveBeenLastCalledWith('spot-ingest', {})
    expect(card(wrapper, 'node-price').get('.result.ok').text()).toContain('✓ 生效成功 · exitCode 0')
    expect(catalogCalls()).toBe(2)

    await card(wrapper, 'load-hydro').get('.effect-btn').trigger('click')
    await flushPromises()
    expect(triggerIngest).toHaveBeenLastCalledWith('forecast-etl', {})
    expect(card(wrapper, 'load-hydro').get('.result.fail').text()).toContain('✗ 生效失败 · exitCode 2')
    expect(catalogCalls()).toBe(2)
  })

  it('复制命令写入剪贴板并给出「已复制」反馈', async () => {
    mockSignals()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const wrapper = await mountView()
    await card(wrapper, 'monthly-export').get('.copy').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('npm run import:spot-export -- --dir <解压包目录> --write')
    expect(card(wrapper, 'monthly-export').get('.copy').text()).toBe('已复制')
  })
})
