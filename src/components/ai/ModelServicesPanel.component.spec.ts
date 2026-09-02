// @vitest-environment happy-dom
//
// 「选服务」面的渲染不变量（主仓 Epic #2661 · #2668）：
// 1. 网关不可达 / 未配网关 → 显示「模型服务暂不可用」+ 服务端给的原因，**不渲染任何档位卡片**
//    （不伪造清单、不静默降级）；
// 2. 可用时按档位渲染中文标签 + 能力位中文，未开通的档位不能启用；
// 3. 页面上没有任何密钥输入控件（验收标准第一条）；
// 4. 勾选启用 → 以「当前已启用集合 ± 本档位」整体 PUT，服务端拒绝时回读真实状态。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'

// vi.mock 会被提升到文件顶部，工厂里引用的变量必须经 vi.hoisted 先于它求值
const { getServices, putServices, testService } = vi.hoisted(() => ({
  getServices: vi.fn(),
  putServices: vi.fn(),
  testService: vi.fn()
}))
vi.mock('@/services/llm', () => ({ getServices, putServices, testService }))
vi.mock('@/services/agent/agentConfig', () => ({ ROLE_LABELS: { market_analyst: '市场分析师' } }))

import ModelServicesPanel from './ModelServicesPanel.vue'

const TIERS = [
  { id: 'dljy-standard', label: '标准', description: '日常问答', capabilities: ['tool_call', 'json_mode'], context_window: 128000, available: true, enabled: true },
  { id: 'dljy-fast', label: '快速', description: '低延迟', capabilities: ['tool_call'], context_window: null, available: true, enabled: false },
  { id: 'dljy-vision', label: '视觉', description: '看图读表', capabilities: ['vision'], context_window: null, available: false, enabled: false }
]
const OK = {
  available: true,
  gateway: true,
  reason: null,
  tiers: TIERS,
  roles: [{ role: 'market_analyst', default_tier: 'dljy-standard', tier: 'dljy-standard', override: false, requires: ['tool_call'] }]
}

beforeEach(() => {
  getServices.mockReset()
  putServices.mockReset()
  testService.mockReset()
})

describe('ModelServicesPanel', () => {
  it('网关不可达：只显示「模型服务暂不可用」与原因，不渲染档位卡片', async () => {
    getServices.mockResolvedValue({ available: false, gateway: true, reason: '网关不可达：connect ECONNREFUSED', tiers: [], roles: [] })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    expect(w.text()).toContain('模型服务暂不可用')
    expect(w.text()).toContain('网关不可达：connect ECONNREFUSED')
    expect(w.findAll('.tier-card')).toHaveLength(0)
    expect(w.findAll('.el-switch')).toHaveLength(0)
    w.unmount()
  })

  it('后端连不上：同样落「暂不可用」，不留空白', async () => {
    getServices.mockRejectedValue(new Error('services 503'))
    const w = mount(ModelServicesPanel)
    await flushPromises()
    expect(w.text()).toContain('模型服务暂不可用')
    expect(w.text()).toContain('services 503')
    w.unmount()
  })

  it('可用：渲染中文标签与能力位；未开通档位不可启用；页面无密钥输入', async () => {
    getServices.mockResolvedValue(OK)
    const w = mount(ModelServicesPanel)
    await flushPromises()
    const cards = w.findAll('.tier-card')
    expect(cards).toHaveLength(3)
    expect(cards[0].text()).toContain('标准')
    expect(cards[0].text()).toContain('工具调用')
    expect(cards[0].text()).toContain('结构化输出')
    expect(cards[0].text()).toContain('128k 上下文')
    expect(cards[2].text()).toContain('未开通')
    expect(cards[2].classes()).toContain('unavailable')
    expect(cards[2].find('.el-switch').classes()).toContain('is-disabled')
    // 验收标准第一条：页面上不存在任何密钥输入控件
    expect(w.findAll('input[type="password"]')).toHaveLength(0)
    expect(w.text()).not.toMatch(/API Key|密钥输入/)
    // 角色路由行
    expect(w.text()).toContain('市场分析师')
    w.unmount()
  })

  it('启用一个档位：以「已启用集合 + 本档位」整体 PUT，成功后用服务端回传刷新', async () => {
    getServices.mockResolvedValue(OK)
    const after = { ...OK, tiers: TIERS.map((t) => (t.id === 'dljy-fast' ? { ...t, enabled: true } : t)) }
    putServices.mockResolvedValue({ ok: true, services: after })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    await w.findAll('.tier-card')[1].find('.el-switch').trigger('click')
    await flushPromises()
    expect(putServices).toHaveBeenCalledWith({ enabled: ['dljy-standard', 'dljy-fast'] })
    expect(w.emitted('loaded')?.at(-1)?.[0]).toEqual(after)
    w.unmount()
  })

  it('服务端拒绝：回读真实状态，开关不停在「看似已改」的位置', async () => {
    getServices.mockResolvedValue(OK)
    putServices.mockResolvedValue({ ok: false, msg: '档位不存在' })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    expect(getServices).toHaveBeenCalledTimes(1)
    await w.findAll('.tier-card')[1].find('.el-switch').trigger('click')
    await flushPromises()
    expect(getServices).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  it('测试连接只发档位 id，结果原样上屏', async () => {
    getServices.mockResolvedValue(OK)
    testService.mockResolvedValue({ ok: false, msg: '模型服务网关未提供档位 dljy-fast' })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    const btn = w.findAll('.tier-card')[1].findAll('button').find((b) => b.text().includes('测试连接'))
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()
    expect(testService).toHaveBeenCalledWith('dljy-fast')
    expect(w.findAll('.tier-card')[1].text()).toContain('模型服务网关未提供档位 dljy-fast')
    w.unmount()
  })
})
