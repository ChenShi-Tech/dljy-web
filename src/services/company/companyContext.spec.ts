import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '@/services/auth'

// companyContext.ts / regionContext.ts 在浏览器运行，模块顶层读 window.localStorage 决定初始
// 选中地区/公司；单测环境是纯 node（vitest.config.ts 未接 jsdom，纯逻辑无需 DOM），import 前
// 需最小 stub 才不在模块加载时抛 ReferenceError。
function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    }
  }
}
;(globalThis as unknown as { window: { localStorage: ReturnType<typeof memoryStorage> } }).window = {
  localStorage: memoryStorage()
}

vi.mock('@/services/auth', () => ({ getCurrentUser: vi.fn() }))

const { getCurrentUser } = await import('@/services/auth')
const { resolveCompanyForRegion, setCompanyOptions, selectedCompanyId, companyOptions } = await import(
  './companyContext'
)
const { companyUnselected } = await import('./companyApi')
const { selectedRegionId, setCurrentRegionId } = await import('@/services/region/regionContext')

function fakeUser(overrides: Partial<AuthUser>): AuthUser {
  return {
    companyId: 'comp-shanxi',
    companyName: '山西发电',
    roleCode: 'PLANT_OPERATOR',
    companyTier: 'COMPANY',
    ...overrides
  } as AuthUser
}

const shanxiCompany = { companyId: 'comp-shanxi', name: '山西发电' }
const sandePuhua = { companyId: 'comp-sande-puhua', name: '三德普华' }
const yunnanCompany = { companyId: 'comp-cgn-yunnan', name: '中广核云南新能源' }

// resolveCompanyForRegion（#668 四规则联动判定）纯函数回归锁：切地区后公司上下文该落到哪家
// 由这四条规则唯一决定，规则改错会造成串公司越权读写，故用可推导的确定性用例锁死。
describe('resolveCompanyForRegion', () => {
  it('规则1：当前公司属新地区且在授权集合 → 保持不覆盖', () => {
    const resolved = resolveCompanyForRegion({
      regionId: 'shanxi',
      currentCompanyId: 'comp-sande-puhua',
      availableCompanies: [shanxiCompany, sandePuhua],
      rememberedCompanyId: null
    })
    expect(resolved).toEqual({ companyId: 'comp-sande-puhua', reason: 'keep' })
  })

  it('规则2：该地区仅一家授权公司 → 自动切换', () => {
    const resolved = resolveCompanyForRegion({
      regionId: 'yunnan',
      currentCompanyId: 'comp-shanxi',
      availableCompanies: [shanxiCompany, yunnanCompany],
      rememberedCompanyId: null
    })
    expect(resolved).toEqual({ companyId: 'comp-cgn-yunnan', reason: 'single' })
  })

  it('规则3：多家授权且有该地区记忆 → 优先记忆', () => {
    const resolved = resolveCompanyForRegion({
      regionId: 'shanxi',
      currentCompanyId: 'comp-cgn-yunnan',
      availableCompanies: [shanxiCompany, sandePuhua],
      rememberedCompanyId: 'comp-sande-puhua'
    })
    expect(resolved).toEqual({ companyId: 'comp-sande-puhua', reason: 'memory' })
  })

  it('规则3兜底：多家授权且无记忆 → 落默认公司（regionHomeCompanyId）', () => {
    const resolved = resolveCompanyForRegion({
      regionId: 'shanxi',
      currentCompanyId: 'comp-cgn-yunnan',
      availableCompanies: [shanxiCompany, sandePuhua],
      rememberedCompanyId: null
    })
    expect(resolved).toEqual({ companyId: 'comp-shanxi', reason: 'default' })
  })

  it('规则4：该地区无任何授权公司 → 空态，绝不擅自落到非授权公司', () => {
    const resolved = resolveCompanyForRegion({
      regionId: 'sichuan',
      currentCompanyId: 'comp-shanxi',
      availableCompanies: [shanxiCompany, yunnanCompany],
      rememberedCompanyId: null
    })
    expect(resolved).toEqual({ companyId: null, reason: 'empty' })
  })
})

// companyUnselected（roborev job346/job355/job361/job386 反复回归的空态守卫）三态回归锁：
// 判定结果直接决定公司专属请求是被短路/拒绝还是带 company 参数放行，误判即串租户或误报空态。
describe('companyUnselected', () => {
  beforeEach(() => {
    selectedCompanyId.value = ''
  })

  it('未选公司 → true（空态）', () => {
    selectedCompanyId.value = ''
    expect(companyUnselected()).toBe(true)
  })

  it('已选本地区专属公司 → false（有效）', () => {
    setCurrentRegionId('shanxi')
    selectedCompanyId.value = 'comp-shanxi'
    expect(companyUnselected()).toBe(false)
  })

  it('已选其它地区的专属公司（stale 残留）→ true（视同空态，防串地区读写）', () => {
    setCurrentRegionId('shanxi')
    selectedCompanyId.value = 'comp-cgn-yunnan'
    expect(companyUnselected()).toBe(true)
  })

  it('已选无地区归属的 GROUP 公司 → false（集团汇总视角在任何地区都有效）', () => {
    setCurrentRegionId('yunnan')
    selectedCompanyId.value = 'dljy-demo'
    expect(companyUnselected()).toBe(false)
  })
})

// setCompanyOptions（roborev job346/job355/job361 三轮回归修复的授权集校准入口）：授权集刷新后
// 是否保留当前选择、是否触发四规则协调，直接决定切公司/切地区竞态窗口是否残留越权选择。
describe('setCompanyOptions', () => {
  beforeEach(() => {
    companyOptions.value = []
    selectedCompanyId.value = ''
    vi.mocked(getCurrentUser).mockReset()
  })

  it('普通用户（不可切换）：授权集刷新不改变已锁定的自身公司', () => {
    vi.mocked(getCurrentUser).mockReturnValue(fakeUser({ roleCode: 'PLANT_OPERATOR', companyTier: 'COMPANY', companyId: 'comp-shanxi' }))
    setCurrentRegionId('shanxi')
    selectedCompanyId.value = 'comp-shanxi'
    setCompanyOptions([shanxiCompany, yunnanCompany])
    expect(selectedCompanyId.value).toBe('comp-shanxi')
  })

  it('可切换用户：当前选择仍在新授权集合且属当前地区 → 原样保留', () => {
    vi.mocked(getCurrentUser).mockReturnValue(fakeUser({ roleCode: 'ADMIN', companyId: 'dljy-demo' }))
    setCurrentRegionId('shanxi')
    selectedCompanyId.value = 'comp-sande-puhua'
    setCompanyOptions([shanxiCompany, sandePuhua])
    expect(selectedCompanyId.value).toBe('comp-sande-puhua')
  })

  it('可切换用户：当前选择的公司已被授权集合收回 → 按四规则重新校准（该地区仅剩一家则自动切）', () => {
    vi.mocked(getCurrentUser).mockReturnValue(fakeUser({ roleCode: 'ADMIN', companyId: 'dljy-demo' }))
    setCurrentRegionId('shanxi')
    selectedCompanyId.value = 'comp-sande-puhua'
    setCompanyOptions([shanxiCompany])
    expect(selectedCompanyId.value).toBe('comp-shanxi')
  })

  it('可切换用户：授权集合不含当前地区任何公司 → 校准为空态', () => {
    vi.mocked(getCurrentUser).mockReturnValue(fakeUser({ roleCode: 'ADMIN', companyId: 'dljy-demo' }))
    setCurrentRegionId('shanxi')
    selectedCompanyId.value = 'comp-cgn-yunnan'
    setCompanyOptions([yunnanCompany])
    expect(selectedCompanyId.value).toBe('')
  })
})
