// @vitest-environment happy-dom
// 推理模型管理页（dljy#2465）：健康三态上屏、协变量供给交叉列、停用经确认后调代理并刷新、未在线时写操作禁用。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// vi.mock 工厂会被提升到文件顶部：工厂里引用的桩必须经 vi.hoisted 定义，否则 TDZ 报错
const { confirm, api, getCurrentUser } = vi.hoisted(() => ({
  confirm: vi.fn(async (..._args: unknown[]): Promise<void> => undefined),
  api: {
    fetchRemoteHealth: vi.fn(),
    fetchRemoteModels: vi.fn(),
    fetchRemoteVersions: vi.fn(async () => [{ version: 'v1', active: true }, { version: 'v0', active: false, hasCheckpoint: true }]),
    setRemoteModelEnabled: vi.fn(async () => ({ ok: true })),
    activateRemoteVersion: vi.fn(async () => ({ ok: true })),
    reloadRemoteModel: vi.fn(async () => ({ ok: true })),
    unloadRemoteModel: vi.fn(async () => ({ ok: true })),
    rescanRemote: vi.fn(async () => ({ ok: true, modelCount: 1, availableCount: 1 })),
  },
  getCurrentUser: vi.fn(),
}))
vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm },
}))
vi.mock('@/services/forecast/remoteModelAdmin', async () => ({
  ...(await vi.importActual<typeof import('@/services/forecast/remoteModelAdmin')>('@/services/forecast/remoteModelAdmin')),
  ...api,
}))
// dljy#3226（AA-06.2）：写按钮按当前登录角色受控，用户来源与页面其它处一致走 services/auth
vi.mock('@/services/auth', () => ({ getCurrentUser }))
import SystemModelsView from './SystemModelsView.vue'

const STUBS = {
  'el-card': { template: '<div><slot name="header" /><slot /></div>' },
  'el-tag': { template: '<span class="stub-tag" :data-type="type"><slot /></span>', props: ['type'] },
  // 不手动 $emit('click')：父级 @click 经 attrs 直接落到根 <button>（手动 emit 会让点击触发两次）
  'el-button': { template: '<button class="stub-btn" :disabled="disabled"><slot /></button>', props: ['disabled', 'loading', 'type'] },
  'el-alert': { template: '<div class="stub-alert">{{ title }}</div>', props: ['title'] },
  'el-dialog': { template: '<div v-if="modelValue" class="stub-dialog"><slot /></div>', props: ['modelValue', 'title'] },
}
const MODEL = {
  modelId: 'remote:yunnan-user-price-rt-dynamic-tmoe-covariates-20260731', name: 'Dynamic TMoE 实时用户电价（协变量）',
  target: 'price_user_rt_settlement', regionId: 'yunnan', available: false, unit: '元/MWh',
  unavailableReason: '协变量缺平台数据源：[transfer_plan_guizhou_export]（…dljy#2475）。',
  framework: 'bundle/Dynamic TMoE', source: 'remote:bundle', supportedTargets: ['price_user_rt_settlement'],
  io: { intervalMinutes: 60, seqLen: 168, predLen: 24, quantilesSupported: [],
    covariates: [
      { field: 'region_load_actual', labelZh: '统调负荷实际', unit: 'MW', platformStatus: 'available' },
      { field: 'transfer_plan_guizhou_export', platformStatus: 'blocked', blockedReason: '须回灌（dljy#2475）' },
    ] },
  lineage: { version: 'artifact-1', bundleId: 'b-1', mock: false, loaded: true },
  basisVersion: 'model-registry.v1', provenance: { basis: 'real', sourceType: 'REAL', mock: false, productionWrite: false },
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchRemoteModels.mockResolvedValue([MODEL])
  // 默认平台超管：既有用例按「可写」语义编写（dljy#3226 之前的口径即超管面）
  getCurrentUser.mockReturnValue({ roleCode: 'ADMIN' })
})

async function mountWith(health: Record<string, unknown>) {
  api.fetchRemoteHealth.mockResolvedValue(health)
  const w = mount(SystemModelsView, { global: { stubs: STUBS } })
  await flushPromises()
  return w
}

describe('健康三态', () => {
  it('ok：在线 + 模型数 + 契约版本；写操作可用', async () => {
    const w = await mountWith({ state: 'ok', modelCount: 26, contractVersion: 'remote-inference.v1', version: 'dljy-infer 0.1.0', device: 'cuda' })
    expect(w.find('[data-test="health"]').text()).toContain('在线 · 26 个模型 · remote-inference.v1')
    expect((w.find('[data-test="toggle"]').element as HTMLButtonElement).disabled).toBe(false)
  })
  it('unauthorized：连上了但凭据无效——提示且写操作禁用', async () => {
    const w = await mountWith({ state: 'unauthorized', reason: 'HTTP 401' })
    expect(w.find('[data-test="health"]').text()).toContain('平台凭据在南洋无效')
    expect(w.find('.stub-alert').exists()).toBe(true)
    expect((w.find('[data-test="toggle"]').element as HTMLButtonElement).disabled).toBe(true)
  })
  it('unreachable：连不上', async () => {
    const w = await mountWith({ state: 'unreachable', reason: 'refused' })
    expect(w.find('[data-test="health"]').text()).toContain('连不上推理服务：refused')
  })
})

describe('协变量供给交叉列', () => {
  it('缺一个协变量 → 红「缺 1/2」，缺的那项标 blocked 并带原因', async () => {
    const w = await mountWith({ state: 'ok', modelCount: 1 })
    const supply = w.find('[data-test="supply"]')
    expect(supply.text()).toBe('缺 1/2')
    expect(supply.attributes('data-type')).toBe('danger')
    const blocked = w.find('.cov.blocked')
    expect(blocked.text()).toBe('transfer_plan_guizhou_export')
    expect(blocked.attributes('title')).toContain('dljy#2475')
    expect(w.find('[data-test="avail"]').text()).toBe('不可用')
    expect(w.text()).toContain('60 分钟 · 回看 168 · 出 24')
  })
})

describe('写操作', () => {
  it('启用不需确认：调代理（裸 id）后刷新', async () => {
    const w = await mountWith({ state: 'ok', modelCount: 1 })
    await w.find('[data-test="toggle"]').trigger('click')
    await flushPromises()
    expect(api.setRemoteModelEnabled).toHaveBeenCalledWith(MODEL.modelId, true)
    expect(api.fetchRemoteModels).toHaveBeenCalledTimes(2)
    expect(confirm).not.toHaveBeenCalled()
  })
  it('停用先确认；取消则不调代理', async () => {
    api.fetchRemoteModels.mockResolvedValue([{ ...MODEL, available: true }])
    confirm.mockRejectedValueOnce(new Error('cancel'))
    const w = await mountWith({ state: 'ok', modelCount: 1 })
    await w.find('[data-test="toggle"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(api.setRemoteModelEnabled).not.toHaveBeenCalled()
  })
  it('版本对话框：非当前版本可切换，切换后刷新', async () => {
    const w = await mountWith({ state: 'ok', modelCount: 1 })
    await w.find('[data-test="versions"]').trigger('click')
    await flushPromises()
    expect(api.fetchRemoteVersions).toHaveBeenCalledWith(MODEL.modelId)
    const activate = w.findAll('[data-test="activate"]')
    expect(activate).toHaveLength(1)   // 只有 v0（非当前）可切
    await activate[0].trigger('click')
    await flushPromises()
    expect(api.activateRemoteVersion).toHaveBeenCalledWith(MODEL.modelId, 'v0')
    expect(api.fetchRemoteModels).toHaveBeenCalledTimes(2)
  })
})

describe('共享资源写权限（dljy#3226 · AA-06.2）', () => {
  it('内部版 BOSS：看得到模型清单与版本列表，但全部写按钮禁用并提示「仅平台超管可操作」', async () => {
    getCurrentUser.mockReturnValue({ roleCode: 'BOSS' })
    const w = await mountWith({ state: 'ok', modelCount: 1 })
    // 页面入口与只读信息不收窄：模型清单照常渲染
    expect(w.find('[data-test="models"]').exists()).toBe(true)
    expect(w.find('[data-test="models"]').text()).toContain(MODEL.name)
    expect(w.find('[data-test="write-locked"]').exists()).toBe(true)
    // 写按钮禁用且带提示
    for (const key of ['toggle', 'rescan', 'memory']) {
      const btn = w.find(`[data-test="${key}"]`)
      expect((btn.element as HTMLButtonElement).disabled).toBe(true)
      expect(btn.attributes('title')).toBe('仅平台超管可操作')
    }
    // 「版本」按钮只是打开查看，保持可点；其中的切换激活动作受控
    const versions = w.find('[data-test="versions"]')
    expect((versions.element as HTMLButtonElement).disabled).toBe(false)
    await versions.trigger('click')
    await flushPromises()
    const activate = w.find('[data-test="activate"]')
    expect((activate.element as HTMLButtonElement).disabled).toBe(true)
    expect(activate.attributes('title')).toBe('仅平台超管可操作')
    // 只读视角下点不动：写代理零调用
    expect(api.setRemoteModelEnabled).not.toHaveBeenCalled()
    expect(api.activateRemoteVersion).not.toHaveBeenCalled()
    expect(api.rescanRemote).not.toHaveBeenCalled()
    w.unmount()
  })

  it('内部版 ADMIN：写按钮可用，不出现只读提示', async () => {
    const w = await mountWith({ state: 'ok', modelCount: 1 })
    expect(w.find('[data-test="write-locked"]').exists()).toBe(false)
    for (const key of ['toggle', 'rescan', 'memory']) {
      expect((w.find(`[data-test="${key}"]`).element as HTMLButtonElement).disabled).toBe(false)
      expect(w.find(`[data-test="${key}"]`).attributes('title')).toBeUndefined()
    }
    await w.find('[data-test="versions"]').trigger('click')
    await flushPromises()
    expect((w.find('[data-test="activate"]').element as HTMLButtonElement).disabled).toBe(false)
    w.unmount()
  })
})
