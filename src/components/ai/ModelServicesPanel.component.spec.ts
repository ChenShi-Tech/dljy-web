// @vitest-environment happy-dom
//
// 「选服务」面的渲染不变量（主仓 Epic #2661 · #2668 · #2701）：
// 1. 网关不可达 / 未配网关 → 显示「模型服务暂不可用」（未配置凭据时先引导去填）+ 服务端给的原因，
//    **不渲染任何档位卡片**（不伪造清单、不静默降级）；
// 2. 可用时按档位渲染中文标签 + 能力位中文，未开通的档位不能启用；
// 3. 密钥输入只出现在「接入凭据」卡里（type=password），全文不出现「API Key」字样——
//    密钥明文只在粘贴保存那一次直传服务端；
// 4. 勾选启用 → 以「当前已启用集合 ± 本档位」整体 PUT，服务端拒绝时回读真实状态；
// 5. 用量与额度、联网搜索状态如实呈现：上限 null 显示「不限」，给不出额度只灰字不弹窗。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'

// vi.mock 会被提升到文件顶部，工厂里引用的变量必须经 vi.hoisted 先于它求值
const { getServices, putServices, testService, putCredential, deleteCredential, getServicesUsage, testSearchService, getCurrentUser } = vi.hoisted(() => ({
  getServices: vi.fn(),
  putServices: vi.fn(),
  testService: vi.fn(),
  putCredential: vi.fn(),
  deleteCredential: vi.fn(),
  getServicesUsage: vi.fn(),
  testSearchService: vi.fn(),
  getCurrentUser: vi.fn()
}))
vi.mock('@/services/llm', () => ({ getServices, putServices, testService, putCredential, deleteCredential, getServicesUsage, testSearchService }))
vi.mock('@/services/agent/agentConfig', () => ({ ROLE_LABELS: { market_analyst: '市场分析师' } }))
// dljy#3226（AA-06.2）：写控件按当前登录角色受控，用户来源与页面其它处一致走 services/auth
vi.mock('@/services/auth', () => ({ getCurrentUser }))

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
  putCredential.mockReset()
  deleteCredential.mockReset()
  getServicesUsage.mockReset()
  testSearchService.mockReset()
  getCurrentUser.mockReset()
  // 默认平台超管：既有用例按「可写」语义编写（dljy#3226 之前的口径即超管面）
  getCurrentUser.mockReturnValue({ roleCode: 'ADMIN' })
  // 面板可用时会拉一次用量；没显式 mock 的用例给个「给不出」的默认，避免 undefined
  getServicesUsage.mockResolvedValue({ available: false, reason: '' })
})

describe('ModelServicesPanel', () => {
  it('网关不可达且未配置凭据：引导去填凭据并显示原因，不渲染档位卡片', async () => {
    getServices.mockResolvedValue({
      available: false, gateway: true, reason: '网关不可达：connect ECONNREFUSED', tiers: [], roles: [],
      credential: { configured: false, source: null, url: '', key_hint: '', updated_at: null }
    })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    // 未配置时告警 title 是引导语，description 仍显示服务端 reason
    expect(w.text()).toContain('请填写供应方提供的模型服务地址与密钥')
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

  it('已配置但网关不可达：仍显示「模型服务暂不可用」而不是引导语', async () => {
    getServices.mockResolvedValue({
      available: false, gateway: true, reason: '网关不可达', tiers: [], roles: [],
      credential: { configured: true, source: 'env', url: 'https://gw.example.internal/v1', key_hint: '****abcd', updated_at: null }
    })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    expect(w.text()).toContain('模型服务暂不可用')
    expect(w.text()).not.toContain('请填写供应方提供的模型服务地址与密钥')
    w.unmount()
  })

  it('可用：渲染中文标签与能力位；未开通档位不可启用；密码框只出现在接入凭据卡里', async () => {
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
    // 验收标准第一条（#2701 收窄）：密码输入只存在于「接入凭据」卡内，全文不出现「API Key」字样
    const pwdInputs = w.findAll('input[type="password"]')
    expect(pwdInputs.length).toBeGreaterThan(0)
    for (const input of pwdInputs) {
      expect((input.element as HTMLElement).closest('.credential-card')).toBeTruthy()
    }
    expect(w.text()).not.toContain('API Key')
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

  it('关掉最后一个已启用档位：拦下不 PUT（服务端把空集合当「全部启用」），回读复位', async () => {
    getServices.mockResolvedValue(OK)
    const w = mount(ModelServicesPanel)
    await flushPromises()
    await w.findAll('.tier-card')[0].find('.el-switch').trigger('click')
    await flushPromises()
    expect(putServices).not.toHaveBeenCalled()
    expect(getServices).toHaveBeenCalledTimes(2)
    expect(w.findAll('.tier-card')[0].find('.el-switch').classes()).toContain('is-checked')
    w.unmount()
  })

  it('角色当前档位未启用时下拉显示中文标签 +「未启用」而不是原始 id', async () => {
    getServices.mockResolvedValue({
      ...OK,
      tiers: TIERS.map((t) => ({ ...t, enabled: t.id === 'dljy-fast' })),
      roles: [{ role: 'market_analyst', default_tier: 'dljy-standard', tier: 'dljy-standard', override: false, requires: ['tool_call'] }]
    })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    const row = w.find('.roles-block .route-row')
    expect(row.text()).toContain('标准（未启用）')
    expect(row.text()).not.toContain('dljy-standard')
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

  it('未配置：凭据卡显示「未配置」状态行与表单，地址预填服务端给的 url', async () => {
    getServices.mockResolvedValue({
      ...OK,
      credential: { configured: false, source: null, url: 'https://gw.example.internal/v1', key_hint: '', updated_at: null }
    })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    const card = w.find('.credential-card')
    expect(card.text()).toContain('未配置')
    const inputs = card.findAll('input')
    expect((inputs[0].element as HTMLInputElement).value).toBe('https://gw.example.internal/v1')
    expect(inputs[1].attributes('type')).toBe('password')
    w.unmount()
  })

  it('凭据提交：调用 putCredential，成功后用返回的 services 刷新整页（档位卡随之出现）', async () => {
    getServices.mockResolvedValue({
      ...OK,
      available: false,
      credential: { configured: false, source: null, url: '', key_hint: '', updated_at: null }
    })
    const after = {
      ...OK,
      credential: { configured: true, source: 'ui', url: 'https://gw.example.internal/v1', key_hint: '****abcd', updated_at: '2026-09-03T08:00:00+08:00' }
    }
    putCredential.mockResolvedValue({ ok: true, services: after })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    expect(w.findAll('.tier-card')).toHaveLength(0)
    const card = w.find('.credential-card')
    const inputs = card.findAll('input')
    await inputs[0].setValue('https://gw.example.internal/v1')
    await inputs[1].setValue('sk-test-0000')
    const saveBtn = card.findAll('button').find((b) => b.text().includes('验证并保存'))
    expect(saveBtn).toBeTruthy()
    await saveBtn!.trigger('click')
    await flushPromises()
    expect(putCredential).toHaveBeenCalledWith({ url: 'https://gw.example.internal/v1', key: 'sk-test-0000' })
    // 整页刷新：档位卡出现、状态行换回回显形态、界面填写的凭据出现「清除」
    expect(w.findAll('.tier-card')).toHaveLength(3)
    expect(w.find('.credential-card').text()).toContain('已配置 · 来源：界面填写')
    expect(w.find('.credential-card').text()).toContain('尾号 ****abcd')
    expect(w.find('.credential-card').findAll('button').some((b) => b.text().includes('清除'))).toBe(true)
    expect(w.emitted('loaded')?.at(-1)?.[0]).toEqual(after)
    w.unmount()
  })

  it('凭据提交失败：服务端 msg 红字显示在表单下方，不整页刷新', async () => {
    getServices.mockResolvedValue({
      ...OK,
      available: false,
      credential: { configured: false, source: null, url: '', key_hint: '', updated_at: null }
    })
    putCredential.mockResolvedValue({ ok: false, msg: '密钥校验失败：模型服务返回 401' })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    const card = w.find('.credential-card')
    await card.findAll('input')[1].setValue('sk-bad')
    await card.findAll('button').find((b) => b.text().includes('验证并保存'))!.trigger('click')
    await flushPromises()
    expect(card.text()).toContain('密钥校验失败：模型服务返回 401')
    expect(w.findAll('.tier-card')).toHaveLength(0)
    w.unmount()
  })

  it('credential.source 为 env（安装预置）时不显示「清除」——界面不清除预置凭据', async () => {
    getServices.mockResolvedValue({
      ...OK,
      credential: { configured: true, source: 'env', url: 'https://gw.example.internal/v1', key_hint: '****abcd', updated_at: null }
    })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    const card = w.find('.credential-card')
    expect(card.text()).toContain('安装预置')
    expect(card.findAll('button').some((b) => b.text().includes('清除'))).toBe(false)
    w.unmount()
  })

  it('用量卡：已用 / 上限（null 显示「不限」）、剩余、本地时间重置与档位小表（未知 id 原样）', async () => {
    getServices.mockResolvedValue(OK)
    getServicesUsage.mockResolvedValue({
      available: true,
      usage: {
        today: { day: '2026-09-03', requests: 12, total_tokens: 3456, usage_unknown: 2 },
        quota: { requests_per_day: 100, tokens_per_day: null },
        remaining: { requests: 88, tokens: null },
        resets_at: '2026-06-15T12:00:00Z',
        rows: [
          { day: '2026-09-03', tier: 'dljy-standard', requests: 12, failed: 2, total_tokens: 3456 },
          { day: '2026-09-02', tier: 'mystery-tier', requests: 3, failed: 0, total_tokens: 120 }
        ]
      }
    })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    expect(getServicesUsage).toHaveBeenCalled()
    const card = w.find('.usage-card')
    expect(card.text()).toContain('已用 12 / 上限 100')
    expect(card.text()).toContain('已用 3456 / 上限 不限')
    expect(card.text()).toContain('剩余 88')
    expect(card.text()).toContain('额度于')
    expect(card.text()).toContain('2026')
    expect(card.text()).toContain('重置')
    // 档位小表：已知 id 映射中文 label，未知 id 原样
    expect(card.text()).toContain('标准')
    expect(card.text()).toContain('mystery-tier')
    w.unmount()
  })

  it('服务端给不出额度（available:false）：只显示 reason 灰字，不弹错误', async () => {
    getServices.mockResolvedValue(OK)
    getServicesUsage.mockResolvedValue({ available: false, reason: '凭据未配置，无法统计用量' })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    expect(w.find('.usage-card').text()).toContain('凭据未配置，无法统计用量')
    expect(w.find('.usage-card').text()).not.toContain('已用')
    w.unmount()
  })

  it('搜索卡（已开通）：提示由模型服务统一提供，测试按钮调 testSearchService 并上屏结果', async () => {
    getServices.mockResolvedValue({ ...OK, search: { granted: true, available: true, reason: null } })
    testSearchService.mockResolvedValue({ ok: false, msg: '搜索服务超时' })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    const card = w.find('.search-card')
    expect(card.text()).toContain('已开通 · 由模型服务统一提供')
    const btn = card.findAll('button').find((b) => b.text().includes('测试'))
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()
    expect(testSearchService).toHaveBeenCalledTimes(1)
    expect(card.text()).toContain('搜索服务超时')
    w.unmount()
  })

  it('搜索卡（未开通）：显示「未开通——请联系供应方」', async () => {
    getServices.mockResolvedValue({ ...OK, search: { granted: false, available: false, reason: null } })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    expect(w.find('.search-card').text()).toContain('未开通——请联系供应方')
    w.unmount()
  })

  it('搜索卡（开通但暂不可用）：显示「暂时不可用」与服务端原因', async () => {
    getServices.mockResolvedValue({ ...OK, search: { granted: true, available: false, reason: '搜索上游超时' } })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    const card = w.find('.search-card')
    expect(card.text()).toContain('暂时不可用')
    expect(card.text()).toContain('搜索上游超时')
    expect(card.text()).not.toContain('已开通 · 由模型服务统一提供')
    w.unmount()
  })

  it('共享资源写权限（dljy#3226 · AA-06.2）内部版 BOSS：清单/额度/连通探测照常，全部写控件禁用并提示', async () => {
    getCurrentUser.mockReturnValue({ roleCode: 'BOSS' })
    getServices.mockResolvedValue({
      ...OK,
      credential: { configured: true, source: 'ui', url: 'https://gw.example.internal/v1', key_hint: '****abcd', updated_at: '2026-09-03T08:00:00+08:00' }
    })
    getServicesUsage.mockResolvedValue({
      available: true,
      usage: {
        today: { day: '2026-09-03', requests: 12, total_tokens: 3456, usage_unknown: 0 },
        quota: { requests_per_day: 100, tokens_per_day: null },
        remaining: { requests: 88, tokens: null },
        resets_at: '2026-06-15T12:00:00Z',
        rows: []
      }
    })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    // 只读提示上屏；档位清单照常渲染（页面入口与查看不收窄）
    expect(w.find('[data-test="write-locked"]').text()).toContain('仅平台超管可操作')
    expect(w.findAll('.tier-card')).toHaveLength(3)
    // 额度展示保持可用
    expect(w.find('.usage-card').text()).toContain('已用 12 / 上限 100')
    // 凭据地址/密钥输入、保存、清除全部禁用
    const credInputs = w.find('.credential-card').findAll('input')
    for (const input of credInputs) expect((input.element as HTMLInputElement).disabled).toBe(true)
    const saveBtn = w.findAll('button').find((b) => b.text().includes('验证并保存'))
    expect(saveBtn!.element.disabled).toBe(true)
    const clearBtn = w.findAll('button').find((b) => b.text().includes('清除'))
    expect(clearBtn!.element.disabled).toBe(true)
    // 档位启用开关、角色路由选择禁用
    for (const sw of w.findAll('.el-switch')) expect(sw.classes()).toContain('is-disabled')
    // el-select 的 is-disabled 在内部 wrapper 上（版本差异），对整棵子树断言
    expect(w.find('.route-select').html()).toContain('is-disabled')
    // 连通探测保持可用
    const testBtn = w.findAll('.tier-card')[1].findAll('button').find((b) => b.text().includes('测试连接'))
    expect(testBtn).toBeTruthy()
    expect(testBtn!.element.disabled).toBe(false)
    w.unmount()
  })

  it('共享资源写权限（dljy#3226 · AA-06.2）内部版 ADMIN：写控件可用，不出现只读提示', async () => {
    getServices.mockResolvedValue({
      ...OK,
      credential: { configured: true, source: 'ui', url: 'https://gw.example.internal/v1', key_hint: '****abcd', updated_at: null }
    })
    const w = mount(ModelServicesPanel)
    await flushPromises()
    expect(w.find('[data-test="write-locked"]').exists()).toBe(false)
    const saveBtn = w.findAll('button').find((b) => b.text().includes('验证并保存'))
    expect(saveBtn!.element.disabled).toBe(false)
    expect(w.findAll('.tier-card')[0].find('.el-switch').classes()).not.toContain('is-disabled')
    expect(w.find('.route-select').html()).not.toContain('is-disabled')
    const credInputs = w.find('.credential-card').findAll('input')
    for (const input of credInputs) expect((input.element as HTMLInputElement).disabled).toBe(false)
    w.unmount()
  })
})
