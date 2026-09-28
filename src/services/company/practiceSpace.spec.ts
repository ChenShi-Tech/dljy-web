// 守什么：练习空间进入/退出编排（ChenShi-Tech/dljy#3403）——开通 → 刷新授权列表 →
// 钉住 → 切换练习公司的顺序与失败路径；退出切回来源公司并解除钉住。
// 坏掉的症状：导引数据落到错误公司（未切到练习公司）、刷新把练习公司顶掉（未钉住/顺序错）、
// 403 无重试导致管理员进不去、失败后钉住残留把用户锁在错误上下文里。
// Issue: ChenShi-Tech/dljy#3403
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '@/services/auth'

// companyContext / regionContext 模块顶层读 window.localStorage，node 环境需最小 stub。
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
vi.mock('@/services/company/practiceSpaceApi', () => ({ ensurePracticeSpace: vi.fn(), fetchPracticeSpace: vi.fn() }))
vi.mock('@/services/company/companyApi', () => ({ refreshCompanyOptions: vi.fn() }))

const { getCurrentUser } = await import('@/services/auth')
const { ensurePracticeSpace } = await import('@/services/company/practiceSpaceApi')
const { refreshCompanyOptions } = await import('@/services/company/companyApi')
const {
  companyOptions, companyPin, selectedCompanyId, pinCompanySelection, unpinCompanySelection,
  setCompanyOptions
} = await import('./companyContext')
const { setCurrentRegionId } = await import('@/services/region/regionContext')
const { enterPracticeSpace, exitPracticeSpace, currentPracticeCompany } = await import('./practiceSpace')
const { ApiError } = await import('@/services/api')
import type { PracticeSpaceResult } from 'shared/company/practice-space.mjs'

type ApiErrorInstance = InstanceType<typeof ApiError>

function fakeUser(overrides: Partial<AuthUser>): AuthUser {
  return {
    username: 'alice',
    companyId: 'dljy-demo',
    companyName: '演示集团',
    roleCode: 'ADMIN',
    companyTier: 'GROUP',
    ...overrides
  } as AuthUser
}

const yunnanCompany = { companyId: 'comp-cgn-yunnan', name: '中广核云南新能源' }
const practiceOption = {
  companyId: 'comp-cgn-yunnan-practice',
  name: '【练习】中广核云南新能源',
  source: 'PRACTICE',
  parentCompanyId: 'comp-cgn-yunnan'
}
const practiceResult: PracticeSpaceResult = {
  created: true,
  exists: true,
  canCreate: true,
  parentCompanyId: 'comp-cgn-yunnan',
  practiceCompanyId: 'comp-cgn-yunnan-practice',
  company: {
    companyId: 'comp-cgn-yunnan-practice',
    name: '【练习】中广核云南新能源',
    shortName: null,
    tier: 'COMPANY',
    parentCompanyId: 'comp-cgn-yunnan',
    status: 'ACTIVE',
    source: 'PRACTICE'
  },
  stations: []
}

function forbidden(): ApiErrorInstance {
  return new ApiError('无权限在该公司下开通练习空间', { status: 403, code: 403, payload: { code: 403 } })
}

describe('enterPracticeSpace（进入练习空间，#3403）', () => {
  beforeEach(() => {
    companyOptions.value = []
    selectedCompanyId.value = ''
    unpinCompanySelection()
    setCurrentRegionId('yunnan')
    vi.clearAllMocks()
    vi.mocked(getCurrentUser).mockReturnValue(fakeUser({ roleCode: 'ADMIN', companyId: 'dljy-demo' }))
  })

  it('成功路径：开通 → 刷新授权列表 → 钉住 → 切换到练习公司', async () => {
    selectedCompanyId.value = 'comp-cgn-yunnan'
    companyOptions.value = [yunnanCompany]
    vi.mocked(ensurePracticeSpace).mockResolvedValue(practiceResult)
    // 刷新走真实 setCompanyOptions（含四规则协调），确保顺序链路被覆盖：协调先发生，
    // 钉住随后接管。
    vi.mocked(refreshCompanyOptions).mockImplementation(async () => {
      setCompanyOptions([yunnanCompany, practiceOption])
      return [yunnanCompany, practiceOption]
    })

    const entered = await enterPracticeSpace()

    expect(ensurePracticeSpace).toHaveBeenCalledWith('comp-cgn-yunnan', { module: 'midlong', regionId: 'yunnan' })
    expect(refreshCompanyOptions).toHaveBeenCalledTimes(1)
    expect(companyPin.value).toEqual({
      companyId: 'comp-cgn-yunnan-practice',
      username: 'alice',
      regionId: 'yunnan',
      originCompanyId: 'comp-cgn-yunnan'
    })
    expect(selectedCompanyId.value).toBe('comp-cgn-yunnan-practice')
    expect(entered).toEqual({
      practiceCompanyId: 'comp-cgn-yunnan-practice',
      originCompanyId: 'comp-cgn-yunnan',
      result: practiceResult
    })
  })

  it('当前已是练习公司 → 来源取其上级，重进不换练习公司', async () => {
    selectedCompanyId.value = practiceOption.companyId
    companyOptions.value = [yunnanCompany, practiceOption]
    vi.mocked(ensurePracticeSpace).mockResolvedValue({ ...practiceResult, created: false })
    vi.mocked(refreshCompanyOptions).mockImplementation(async () => {
      setCompanyOptions([yunnanCompany, practiceOption])
      return [yunnanCompany, practiceOption]
    })

    await enterPracticeSpace()

    expect(ensurePracticeSpace).toHaveBeenCalledWith('comp-cgn-yunnan', expect.anything())
    expect(selectedCompanyId.value).toBe('comp-cgn-yunnan-practice')
  })

  it('当前公司不可写（403）且非本人归属公司 → 改用归属公司重试一次', async () => {
    selectedCompanyId.value = 'comp-cgn-yunnan'
    companyOptions.value = [yunnanCompany]
    vi.mocked(ensurePracticeSpace)
      .mockRejectedValueOnce(forbidden())
      .mockResolvedValueOnce(practiceResult)
    vi.mocked(refreshCompanyOptions).mockImplementation(async () => {
      setCompanyOptions([yunnanCompany, practiceOption])
      return [yunnanCompany, practiceOption]
    })

    await enterPracticeSpace()

    expect(ensurePracticeSpace).toHaveBeenCalledTimes(2)
    expect(ensurePracticeSpace).toHaveBeenNthCalledWith(1, 'comp-cgn-yunnan', expect.anything())
    expect(ensurePracticeSpace).toHaveBeenNthCalledWith(2, 'dljy-demo', expect.anything())
    expect(companyPin.value?.originCompanyId).toBe('dljy-demo')
  })

  it('当前公司即本人归属公司仍 403 → 不重试，如实抛出', async () => {
    vi.mocked(getCurrentUser).mockReturnValue(fakeUser({ roleCode: 'ADMIN', companyId: 'comp-cgn-yunnan' }))
    selectedCompanyId.value = 'comp-cgn-yunnan'
    companyOptions.value = [yunnanCompany]
    const error = forbidden()
    vi.mocked(ensurePracticeSpace).mockRejectedValue(error)

    await expect(enterPracticeSpace()).rejects.toBe(error)
    expect(ensurePracticeSpace).toHaveBeenCalledTimes(1)
    expect(companyPin.value).toBeNull()
  })

  it('归属公司重试仍 403 → 抛出第二次的错误，不留钉住', async () => {
    selectedCompanyId.value = 'comp-cgn-yunnan'
    companyOptions.value = [yunnanCompany]
    vi.mocked(ensurePracticeSpace).mockRejectedValueOnce(forbidden()).mockRejectedValueOnce(forbidden())

    await expect(enterPracticeSpace()).rejects.toBeInstanceOf(ApiError)
    expect(ensurePracticeSpace).toHaveBeenCalledTimes(2)
    expect(companyPin.value).toBeNull()
  })

  it('刷新后练习公司不在授权集合（setCurrentCompanyId 失败）→ 解除钉住并抛明确错误', async () => {
    selectedCompanyId.value = 'comp-cgn-yunnan'
    companyOptions.value = [yunnanCompany]
    vi.mocked(ensurePracticeSpace).mockResolvedValue(practiceResult)
    vi.mocked(refreshCompanyOptions).mockImplementation(async () => {
      setCompanyOptions([yunnanCompany])
      return [yunnanCompany]
    })

    await expect(enterPracticeSpace()).rejects.toThrow('练习公司不在当前授权范围')
    expect(companyPin.value).toBeNull()
    expect(selectedCompanyId.value).not.toBe('comp-cgn-yunnan-practice')
  })
})

describe('exitPracticeSpace / currentPracticeCompany（退出与标识，#3403）', () => {
  beforeEach(() => {
    companyOptions.value = []
    selectedCompanyId.value = ''
    unpinCompanySelection()
    setCurrentRegionId('yunnan')
    vi.clearAllMocks()
    vi.mocked(getCurrentUser).mockReturnValue(fakeUser({ roleCode: 'ADMIN', companyId: 'dljy-demo' }))
  })

  it('退出：切回钉住的来源公司并解除钉住', () => {
    companyOptions.value = [yunnanCompany, practiceOption]
    selectedCompanyId.value = practiceOption.companyId
    pinCompanySelection({ companyId: practiceOption.companyId, regionId: 'yunnan', originCompanyId: 'comp-cgn-yunnan' })

    exitPracticeSpace()

    expect(companyPin.value).toBeNull()
    expect(selectedCompanyId.value).toBe('comp-cgn-yunnan')
  })

  it('来源公司已被授权收回 → 不硬切，交回四规则协调（此处落空态）', () => {
    companyOptions.value = [practiceOption]
    selectedCompanyId.value = practiceOption.companyId
    pinCompanySelection({ companyId: practiceOption.companyId, regionId: 'yunnan', originCompanyId: 'comp-cgn-yunnan' })

    expect(() => exitPracticeSpace()).not.toThrow()

    expect(companyPin.value).toBeNull()
    expect(selectedCompanyId.value).toBe('')
  })

  it('当前不是练习公司 → 只解除钉住，公司不动', () => {
    companyOptions.value = [yunnanCompany]
    selectedCompanyId.value = 'comp-cgn-yunnan'
    pinCompanySelection({ companyId: practiceOption.companyId, regionId: 'yunnan', originCompanyId: 'comp-cgn-yunnan' })

    exitPracticeSpace()

    expect(companyPin.value).toBeNull()
    expect(selectedCompanyId.value).toBe('comp-cgn-yunnan')
  })

  it('currentPracticeCompany：练习公司在授权列表且为当前公司 → 给出档案，否则 null', () => {
    expect(currentPracticeCompany.value).toBeNull()
    companyOptions.value = [yunnanCompany, practiceOption]
    selectedCompanyId.value = practiceOption.companyId
    expect(currentPracticeCompany.value).toEqual({
      companyId: 'comp-cgn-yunnan-practice',
      name: '【练习】中广核云南新能源',
      parentCompanyId: 'comp-cgn-yunnan'
    })
    selectedCompanyId.value = 'comp-cgn-yunnan'
    expect(currentPracticeCompany.value).toBeNull()
  })
})
