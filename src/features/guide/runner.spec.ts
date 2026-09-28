// 导引运行器（runner）的会话生命周期不变量（ChenShi-Tech/dljy#3404）。
// 守什么：推进条件（form 稳定窗口 / 信号 / 路由）满足才进步；等目标超时进 target-missing
// 且可重试恢复；会话持久化后能按 stepId 恢复（失效回第 0 步）；切公司 / 切地区自动暂停、
// resume 先回地区再回练习公司；exit 退出练习空间切回原公司并清 active 指针。
// 坏掉的症状：用户填对了但导引不推进；刷新后导引从头再来、重复建数据；切走公司回来
// 导引还往真实公司写数据；退出后停在练习公司里出不来。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import type { GuideDefinition, GuideStep, GuideSession } from './types'
import {
  attachGuideRouter, attachGuideTargetResolver, enterGuidePracticeSpace, exit, guideSession,
  next, pause, restore, resume, retryTarget, start,
} from './runner'
import { emitGuideSignal, registerGuideForm, resetGuideBridge } from './bridge'
import { loadActiveGuideOrigin, loadCompletedGuides, loadGuideSession, resetGuideStorageCache, saveGuideSession } from './storage'
import { registerPracticeCompanies } from '@/services/company/practiceCompany'

vi.mock('./registry', () => ({
  // 假注册表：用例里往 definitions 塞定义，避免拉起真实 36 步内容层。
  loadGuideDefinition: vi.fn(async (id: string) => definitions[id] ?? null),
}))

vi.mock('@/services/company/companyContext', async () => {
  const { ref: vueRef } = await import('vue')
  const selectedCompanyId = vueRef('c-origin')
  return {
    selectedCompanyId,
    setCurrentCompanyId: (id: string) => {
      selectedCompanyId.value = id
    },
    __selected: selectedCompanyId,
  }
})

vi.mock('@/services/region/regionContext', async () => {
  const { computed: vueComputed, ref: vueRef } = await import('vue')
  const regionId = vueRef('yunnan')
  return {
    currentRegion: vueComputed(() => ({ id: regionId.value })),
    setCurrentRegionId: (id: string) => {
      regionId.value = id
    },
    __regionId: regionId,
  }
})

vi.mock('@/services/company/practiceSpace', () => ({
  enterPracticeSpace: vi.fn(async () => ({
    practiceCompanyId: 'c-practice',
    originCompanyId: 'c-origin',
    result: { stations: [{ id: 901, regionId: 'yunnan' }, { id: 902, regionId: 'yunnan' }, { id: 903, regionId: 'shanxi' }] },
  })),
  exitPracticeSpace: vi.fn(async () => {}),
}))

import * as companyContext from '@/services/company/companyContext'
import * as regionContext from '@/services/region/regionContext'
import * as practiceSpace from '@/services/company/practiceSpace'

const definitions: Record<string, GuideDefinition> = {}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// 假 router 的路径句柄：用例直接改它模拟导航（attachGuideRouter 的 watch 会广播给 route 条件）。
const routePath = ref('/start')

function defineGuide(steps: GuideStep[]): void {
  definitions['test.guide'] = {
    id: 'test.guide', group: 'midlong', title: '测试导引', summary: '', status: 'ready',
    requires: [], needsWrite: true, steps,
  }
}

const manual = (id: string): GuideStep => ({ id, chapter: 0, title: id, body: id, advance: { kind: 'manual' } })

// 假 DOM：findGuideTarget 直接查 Map；waitForGuideTarget 按「存在立即 resolve，否则等满超时 reject」。
const fakeTargets = new Map<string, { click: () => void }>()

function currentStepId(): string {
  return guideSession.value?.stepId ?? ''
}

function currentStatus(): string {
  return guideSession.value?.status ?? ''
}

beforeAll(() => {
  attachGuideRouter(
    {
      push: (to) => {
        routePath.value = typeof to === 'string' ? to : to.path
      },
      // GuideRouterLike 的 currentRoute 是普通对象：用 getter 读 ref（直接传 computed Ref
      // 会因 Ref 没有 path 字段而让 watch 永远读到 undefined，GuideHost 也是 getter 适配）。
      currentRoute: { get path() { return routePath.value } },
    },
    { getUsername: () => 'tester' },
  )
  attachGuideTargetResolver(
    (name) => (fakeTargets.get(name) as HTMLElement | undefined) ?? null,
    async (name, options) => {
      const el = fakeTargets.get(name)
      if (el) return el as HTMLElement
      await sleep(options?.timeoutMs ?? 10000)
      throw new Error(`guide target not found: ${name}`)
    },
  )
})

beforeEach(() => {
  resetGuideStorageCache()
  resetGuideBridge()
  fakeTargets.clear()
  for (const key of Object.keys(definitions)) delete definitions[key]
  vi.clearAllMocks()
  // mock 的 ref 是模块级单例：上一个用例切走的公司 / 地区不能泄漏到本用例的 origin 断言。
  ;(companyContext as unknown as { __selected: { value: string } }).__selected.value = 'c-origin'
  ;(regionContext as unknown as { __regionId: { value: string } }).__regionId.value = 'yunnan'
  routePath.value = '/start'
})

afterEach(async () => {
  // 会话内 definition/ctx 是 runner 私有，唯一干净的复位方式是走 exit（stay 避免触碰公司切换）。
  if (guideSession.value) await exit({ stay: true, completed: false })
  guideSession.value = null
})

describe('推进条件', () => {
  it('form 条件：满足后要过稳定窗口才推进；不满足时停在原步', async () => {
    defineGuide([
      { id: 's0', chapter: 0, title: '', body: '', advance: { kind: 'form', form: 'f', settleMs: 60, done: (v) => v.a === 'x' } },
      manual('s1'),
    ])
    const form = reactive<{ a: string }>({ a: '' })
    registerGuideForm('f', form)
    await start('test.guide')
    expect(currentStepId()).toBe('s0')

    form.a = 'wrong'
    await sleep(120)
    expect(currentStepId()).toBe('s0')

    form.a = 'x'
    await sleep(20)
    expect(currentStepId()).toBe('s0') // 稳定窗口内不推进
    await sleep(120)
    expect(currentStepId()).toBe('s1')
  })

  it('signal 条件：match 不通过的载荷不推进，通过后推进', async () => {
    defineGuide([
      { id: 's0', chapter: 0, title: '', body: '', advance: { kind: 'signal', name: 'sig.test', match: (p) => (p as { ok?: boolean })?.ok === true } },
      manual('s1'),
    ])
    await start('test.guide')
    emitGuideSignal('sig.test', { ok: false })
    await sleep(20)
    expect(currentStepId()).toBe('s0')
    emitGuideSignal('sig.test', { ok: true })
    await sleep(20)
    expect(currentStepId()).toBe('s1')
  })

  it('route 条件：路由变化广播后按 match 推进', async () => {
    defineGuide([
      { id: 's0', chapter: 0, title: '', body: '', advance: { kind: 'route', match: (r) => r.path === '/done' } },
      manual('s1'),
    ])
    await start('test.guide')
    await sleep(10)
    expect(currentStepId()).toBe('s0')
    routePath.value = '/elsewhere'
    await sleep(20)
    expect(currentStepId()).toBe('s0')
    routePath.value = '/done'
    await sleep(20)
    expect(currentStepId()).toBe('s1')
  })
})

describe('目标等待', () => {
  it('等目标超时进入 target-missing；目标就绪后 retryTarget 恢复同一步', async () => {
    defineGuide([
      { id: 's0', chapter: 0, title: '', body: '', target: 'missing-anchor', timeoutMs: 40, advance: { kind: 'manual' } },
      manual('s1'),
    ])
    await start('test.guide')
    await sleep(80)
    expect(currentStatus()).toBe('target-missing')
    expect(currentStepId()).toBe('s0')

    fakeTargets.set('missing-anchor', { click: () => {} })
    retryTarget()
    await sleep(20)
    expect(currentStatus()).toBe('running')
    expect(currentStepId()).toBe('s0')
  })
})

describe('持久化与恢复', () => {
  it('推进后写盘；模拟刷新（内存会话丢弃）后 restore 回到持久化的 stepId', async () => {
    defineGuide([manual('s0'), manual('s1')])
    await start('test.guide')
    next()
    await sleep(320) // persist 有 250ms 防抖
    expect(loadGuideSession('tester', 'c-origin')?.stepId).toBe('s1')

    guideSession.value = null // 模拟刷新：内存会话没了
    await restore()
    await sleep(20)
    // 上面显式置 null 后 TS 会把 .value 窄化成 null；经 helper 读取走声明类型。
    expect(currentStepId()).toBe('s1')
    expect(currentStatus()).toBe('running')
  })

  it('持久化的 stepId 在定义里找不到时回退到第 0 步', async () => {
    defineGuide([manual('s0'), manual('s1')])
    await start('test.guide')
    await sleep(320)
    const saved = loadGuideSession('tester', 'c-origin')!
    saveGuideSession('tester', 'c-origin', { ...saved, stepId: 'gone-with-the-wind' })

    guideSession.value = null
    await restore()
    await sleep(20)
    expect(currentStepId()).toBe('s0')
  })

  it('暂停中的会话刷新后只恢复为暂停，不激活步骤（不因等目标失败改写状态）', async () => {
    // 停在一个指向对话框内元素的步骤上：激活的话 1.5 秒等目标失败会改写成 target-missing。
    defineGuide([manual('s0'), { id: 's1', chapter: 0, title: 's1', body: 's1', target: 'ml-in-dialog', within: 'dialog', advance: { kind: 'manual' } }])
    await start('test.guide')
    await sleep(320)
    const saved = loadGuideSession('tester', 'c-origin')!
    saveGuideSession('tester', 'c-origin', { ...saved, stepId: 's1', status: 'paused', pauseReason: 'company' })

    guideSession.value = null
    await restore()
    await sleep(1700)
    expect(currentStepId()).toBe('s1')
    expect(currentStatus()).toBe('paused')
    // 上面显式置 null 后 TS 会把 .value 窄化成 null，按声明类型读取。
    expect((guideSession.value as GuideSession | null)?.pauseReason).toBe('company')
  })

  it('从练习公司发起（上一轮留在练习空间再来一遍）：来源记为它的上级，不记成练习公司自己', async () => {
    registerPracticeCompanies([{ companyId: 'c-practice', source: 'PRACTICE', parentCompanyId: 'c-origin' }])
    ;(companyContext as unknown as { __selected: { value: string } }).__selected.value = 'c-practice'
    defineGuide([manual('s0')])
    await start('test.guide')
    expect(guideSession.value?.originCompanyId).toBe('c-origin')
    registerPracticeCompanies([])
  })

  it('定义的 initArtifacts 在会话开始时写入产物', async () => {
    definitions['test.guide'] = {
      id: 'test.guide', group: 'midlong', title: '测试导引', summary: '', status: 'ready',
      requires: [], needsWrite: true, steps: [manual('s0')], initArtifacts: () => ({ guideMonths: ['2026-10', '2026-11', '2026-12'] }),
    }
    await start('test.guide')
    expect(guideSession.value?.artifacts.guideMonths).toEqual(['2026-10', '2026-11', '2026-12'])
  })

  it('done 状态的残留会话在 restore 时被清理，不再恢复', async () => {
    defineGuide([manual('s0')])
    await start('test.guide')
    await sleep(320)
    const saved = loadGuideSession('tester', 'c-origin')!
    saveGuideSession('tester', 'c-origin', { ...saved, status: 'done' })
    guideSession.value = null
    await restore()
    expect(guideSession.value).toBeNull()
    expect(loadActiveGuideOrigin('tester')).toBeNull()
  })
})

describe('自动暂停与恢复', () => {
  it('进入练习空间前切公司不暂停；进入后切走自动暂停（company），resume 回练习公司', async () => {
    defineGuide([manual('s0')])
    await start('test.guide')
    const selected = (companyContext as unknown as { __selected: { value: string } }).__selected

    // 尚未进入练习空间（practiceCompanyId 为空）：切公司只算离开页面，不暂停。
    selected.value = 'c-other'
    await sleep(20)
    expect(currentStatus()).toBe('running')
    selected.value = 'c-origin'
    await sleep(20)

    await enterGuidePracticeSpace()
    expect(guideSession.value?.practiceCompanyId).toBe('c-practice')
    // 练习场站只取开通接口返回的本地区场站（不从页面快照取来源公司的真实场站）。
    expect(guideSession.value?.artifacts.practiceStationIds).toEqual([901, 902])
    selected.value = 'c-other'
    await sleep(20)
    expect(currentStatus()).toBe('paused')
    expect(guideSession.value?.pauseReason).toBe('company')

    await resume()
    expect(vi.mocked(practiceSpace.enterPracticeSpace)).toHaveBeenCalled()
    expect(currentStatus()).toBe('running')
    expect(guideSession.value?.pauseReason).toBeUndefined()
  })

  it('切出导引地区自动暂停（region）；resume 先把地区切回去', async () => {
    defineGuide([manual('s0')])
    await start('test.guide')
    const regionId = (regionContext as unknown as { __regionId: { value: string } }).__regionId

    regionId.value = 'guangdong'
    await sleep(20)
    expect(currentStatus()).toBe('paused')
    expect(guideSession.value?.pauseReason).toBe('region')

    await resume()
    expect(regionId.value).toBe('yunnan')
    expect(currentStatus()).toBe('running')
  })

  it('手动 pause 不带 pauseReason；resume 恢复运行', async () => {
    defineGuide([manual('s0')])
    await start('test.guide')
    pause()
    expect(currentStatus()).toBe('paused')
    expect(guideSession.value?.pauseReason).toBeUndefined()
    await resume()
    expect(currentStatus()).toBe('running')
  })
})

describe('退出', () => {
  it('exit：退出练习空间、切回原公司、清 active 指针与会话', async () => {
    defineGuide([manual('s0')])
    await start('test.guide')
    await enterGuidePracticeSpace()
    const selected = (companyContext as unknown as { __selected: { value: string } }).__selected
    selected.value = 'c-practice' // 进入练习空间后的真实状态

    await exit()
    expect(vi.mocked(practiceSpace.exitPracticeSpace)).toHaveBeenCalledTimes(1)
    expect(selected.value).toBe('c-origin')
    expect(loadActiveGuideOrigin('tester')).toBeNull()
    expect(loadGuideSession('tester', 'c-origin')).toBeNull()
    expect(guideSession.value).toBeNull()
  })

  it('exit completed：记完成记录；stay 留在练习空间不退出不切公司', async () => {
    defineGuide([manual('s0')])
    await start('test.guide')
    await enterGuidePracticeSpace()
    const selected = (companyContext as unknown as { __selected: { value: string } }).__selected
    selected.value = 'c-practice'

    await exit({ stay: true, completed: true })
    expect(vi.mocked(practiceSpace.exitPracticeSpace)).not.toHaveBeenCalled()
    expect(selected.value).toBe('c-practice')
    expect(loadCompletedGuides('tester')).toContain('test.guide')
  })
})
