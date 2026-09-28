import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { AuthUser } from '@/services/auth'

// companyContext.ts / regionContext.ts 在浏览器运行，模块顶层读 window.localStorage 决定初始
// 选中地区/公司；单测环境是纯 node（vitest.config.ts 未接 jsdom，纯逻辑无需 DOM），import 前
// 需最小 stub 才不在模块加载时抛 ReferenceError。
// 本文件守住：公司上下文的四规则协调、切换判据与练习空间钉住（#3403）不被回归改坏——
// 坏掉的症状是切地区/刷新授权集后用户被切到错误公司、越权读写或练习数据落错租户。
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
const {
  resolveCompanyForRegion, setCompanyOptions, selectedCompanyId, companyOptions, canSwitchCompany,
  companyPin, pinCompanySelection, unpinCompanySelection, resetCompanyContextToHome, setCurrentCompanyId
} = await import('./companyContext')
const { companyUnselected } = await import('./companyApi')
const { setCurrentRegionId } = await import('@/services/region/regionContext')

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
// 练习公司（#3403）：不在静态地区表 COMPANY_REGION 里 → companyRegionId 返回 null。
const practiceCompany = {
  companyId: 'comp-cgn-yunnan-practice',
  name: '【练习】中广核云南新能源',
  source: 'PRACTICE',
  parentCompanyId: 'comp-cgn-yunnan'
}

// canSwitchCompany（切换器渲染判据，#2898 / Epic #2887 拍板）回归锁：
// 提权只认角色不认层级——GROUP 主体不再让任何角色自动可切换；此前「GROUP 层级即提权」
// 会让 TRADER/QUANT 等看到只有自己一家的切换器、手工构造请求撞服务端 403。
describe('canSwitchCompany', () => {
  it('GROUP 层级但非提权角色（TRADER）→ false（层级不再自动提权）', () => {
    expect(canSwitchCompany(fakeUser({ roleCode: 'TRADER', companyTier: 'GROUP', companyId: 'dljy-demo' }))).toBe(false)
  })

  it('GROUP 层级的其他非提权角色（SETTLEMENT）→ false', () => {
    expect(canSwitchCompany(fakeUser({ roleCode: 'SETTLEMENT', companyTier: 'GROUP', companyId: 'dljy-demo' }))).toBe(false)
  })

  it('GROUP 层级的 BOSS → true（按角色提权；可见范围=自身公司树由后端收口）', () => {
    expect(canSwitchCompany(fakeUser({ roleCode: 'BOSS', companyTier: 'GROUP', companyId: 'dljy-demo' }))).toBe(true)
  })

  it('COMPANY 层级的 ADMIN → true（平台管理员，不依赖 GROUP 层级）', () => {
    expect(canSwitchCompany(fakeUser({ roleCode: 'ADMIN', companyTier: 'COMPANY', companyId: 'comp-shanxi' }))).toBe(true)
  })

  it('COMPANY 层级的 BOSS → true', () => {
    expect(canSwitchCompany(fakeUser({ roleCode: 'BOSS', companyTier: 'COMPANY', companyId: 'comp-shanxi' }))).toBe(true)
  })

  it('COMPANY 层级普通角色（PLANT_OPERATOR）→ false', () => {
    expect(canSwitchCompany(fakeUser({ roleCode: 'PLANT_OPERATOR', companyTier: 'COMPANY' }))).toBe(false)
  })

  it('未登录（null/undefined）→ false', () => {
    expect(canSwitchCompany(null)).toBe(false)
    expect(canSwitchCompany(undefined)).toBe(false)
  })
})

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

// companyUnselected（job355/job361/job386 反复回归的空态守卫）三态回归锁：
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

// setCompanyOptions（job355/job361 三轮回归修复的授权集校准入口）：授权集刷新后
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

// 练习空间钉住（ChenShi-Tech/dljy#3403）：进入练习空间后公司上下文必须稳定停留在练习公司，
// 授权集刷新/地区切换都不得把用户切走——否则导引写的测试数据会落到错误公司。
// 练习公司不在静态地区表，四规则天然不会自动选中它（规则 2/3 只从 regionAuthorized 里挑），
// 反而会把停留其上的用户顶掉，钉住就是为这条通路加的「保持」豁免。
describe('练习空间钉住（#3403）', () => {
  beforeEach(() => {
    companyOptions.value = []
    selectedCompanyId.value = ''
    unpinCompanySelection()
    vi.mocked(getCurrentUser).mockReset()
    vi.mocked(getCurrentUser).mockReturnValue(
      fakeUser({ roleCode: 'ADMIN', companyId: 'dljy-demo', username: 'alice' })
    )
  })

  it('钉住生效：授权集刷新（setCompanyOptions）不把练习公司顶掉', () => {
    setCurrentRegionId('yunnan')
    selectedCompanyId.value = practiceCompany.companyId
    pinCompanySelection({ companyId: practiceCompany.companyId, regionId: 'yunnan', originCompanyId: 'comp-cgn-yunnan' })
    setCompanyOptions([yunnanCompany, practiceCompany])
    expect(selectedCompanyId.value).toBe(practiceCompany.companyId)
    expect(companyPin.value?.companyId).toBe(practiceCompany.companyId)
  })

  it('钉住生效：切回钉住地区且当前仍是练习公司 → 地区协调不接管', async () => {
    setCurrentRegionId('yunnan')
    selectedCompanyId.value = practiceCompany.companyId
    pinCompanySelection({ companyId: practiceCompany.companyId, regionId: 'yunnan', originCompanyId: 'comp-cgn-yunnan' })
    setCompanyOptions([shanxiCompany, yunnanCompany, practiceCompany])
    expect(selectedCompanyId.value).toBe(practiceCompany.companyId)
    // 切到其它地区：钉住不拦截（新地区 ≠ 钉住地区），四规则正常接管，但钉住记录保留。
    // watch 是异步 flush（pre），断言前等一拍。
    setCurrentRegionId('shanxi')
    await nextTick()
    expect(selectedCompanyId.value).toBe('comp-shanxi')
    expect(companyPin.value).not.toBeNull()
    // 手动切回练习公司后再切回钉住地区：地区 watch 命中钉住守卫，不再协调。
    selectedCompanyId.value = practiceCompany.companyId
    setCurrentRegionId('yunnan')
    await nextTick()
    expect(selectedCompanyId.value).toBe(practiceCompany.companyId)
  })

  it('钉住公司被授权集合收回 → 清除钉住并按四规则正常协调', () => {
    setCurrentRegionId('yunnan')
    selectedCompanyId.value = practiceCompany.companyId
    pinCompanySelection({ companyId: practiceCompany.companyId, regionId: 'yunnan', originCompanyId: 'comp-cgn-yunnan' })
    setCompanyOptions([yunnanCompany])
    expect(companyPin.value).toBeNull()
    expect(selectedCompanyId.value).toBe('comp-cgn-yunnan')
  })

  it('钉住属于其他用户（上一账号残留）→ 不生效，按常规协调切走', () => {
    vi.mocked(getCurrentUser).mockReturnValue(fakeUser({ roleCode: 'ADMIN', companyId: 'dljy-demo', username: 'bob' }))
    setCurrentRegionId('yunnan')
    selectedCompanyId.value = practiceCompany.companyId
    pinCompanySelection({ companyId: practiceCompany.companyId, regionId: 'yunnan', originCompanyId: 'comp-cgn-yunnan' })
    vi.mocked(getCurrentUser).mockReturnValue(fakeUser({ roleCode: 'ADMIN', companyId: 'dljy-demo', username: 'alice' }))
    setCompanyOptions([yunnanCompany, practiceCompany])
    expect(selectedCompanyId.value).toBe('comp-cgn-yunnan')
    // 失效不清除：钉住记录仍在，供判定「这不是当前用户的练习空间」。
    expect(companyPin.value).not.toBeNull()
  })

  it('手动切换公司：钉住记录保留但不再生效', () => {
    setCurrentRegionId('yunnan')
    selectedCompanyId.value = practiceCompany.companyId
    pinCompanySelection({ companyId: practiceCompany.companyId, regionId: 'yunnan', originCompanyId: 'comp-cgn-yunnan' })
    setCompanyOptions([yunnanCompany, practiceCompany])
    expect(setCurrentCompanyId('comp-cgn-yunnan')).toBe(true)
    expect(companyPin.value).not.toBeNull()
    // 再次刷新授权集：当前公司 ≠ 钉住公司 → 钉住不拦截，按常规逻辑保留当前选择。
    setCompanyOptions([yunnanCompany, practiceCompany])
    expect(selectedCompanyId.value).toBe('comp-cgn-yunnan')
  })

  it('resetCompanyContextToHome（登录/切换账号）→ 清除钉住并归位自身公司', () => {
    setCurrentRegionId('yunnan')
    selectedCompanyId.value = practiceCompany.companyId
    pinCompanySelection({ companyId: practiceCompany.companyId, regionId: 'yunnan', originCompanyId: 'comp-cgn-yunnan' })
    resetCompanyContextToHome()
    expect(companyPin.value).toBeNull()
    expect(selectedCompanyId.value).toBe('dljy-demo')
  })

  it('localStorage 写入抛错 → 钉住不抛（内存态照常生效）', () => {
    setCurrentRegionId('yunnan')
    selectedCompanyId.value = practiceCompany.companyId
    const storage = (globalThis as unknown as { window: { localStorage: ReturnType<typeof memoryStorage> } }).window.localStorage
    const spy = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() =>
      pinCompanySelection({ companyId: practiceCompany.companyId, regionId: 'yunnan', originCompanyId: 'comp-cgn-yunnan' })
    ).not.toThrow()
    expect(companyPin.value?.companyId).toBe(practiceCompany.companyId)
    // 确认写入路径真的被走到（否则「不抛错」是假绿：setItem 没被调用也不会抛）。
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('持久化的钉住数据损坏（非 JSON）→ 初始化视同无钉住，不阻塞模块加载', async () => {
    const storage = (globalThis as unknown as { window: { localStorage: ReturnType<typeof memoryStorage> } }).window.localStorage
    storage.setItem('dljy.companyPin', '{not-json')
    vi.resetModules()
    const fresh = await import('./companyContext')
    expect(fresh.companyPin.value).toBeNull()
  })

  it('规则2：练习公司不在静态地区表 → 该地区仅剩它也不会被自动选中', () => {
    const resolved = resolveCompanyForRegion({
      regionId: 'yunnan',
      currentCompanyId: 'dljy-demo',
      availableCompanies: [yunnanCompany, practiceCompany],
      rememberedCompanyId: null
    })
    expect(resolved).toEqual({ companyId: 'comp-cgn-yunnan', reason: 'single' })
  })

  it('规则3：地区记忆指向练习公司 → 不被采纳，落默认公司', () => {
    const resolved = resolveCompanyForRegion({
      regionId: 'shanxi',
      currentCompanyId: 'comp-cgn-yunnan',
      availableCompanies: [shanxiCompany, sandePuhua, practiceCompany],
      rememberedCompanyId: practiceCompany.companyId
    })
    expect(resolved).toEqual({ companyId: 'comp-shanxi', reason: 'default' })
  })
})
