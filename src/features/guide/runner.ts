// 导引运行器（dljy#3404）：模块级单例，管理会话生命周期、步骤激活、推进/兜底/暂停/恢复/退出。
// 依赖注入纪律：router 与用户名经 attachGuideRouter 注入（GuideHost 调用，不 import '@/router'，
// 避免循环依赖，也让 node 侧测试可以传假 router）；目标等待函数可注入（attachGuideTargetResolver）。
// 练习空间进出复用 #3403 的 practiceSpace 服务；离开练习公司 / 切出导引地区时自动暂停。
import { computed, ref, watch } from 'vue'
import type { GuideCtx, GuideDefinition, GuideSession, GuideStep } from './types'
import { fillGuideForm, readGuideForm } from './bridge'
import { findGuideTarget, waitForGuideTarget } from './targets'
import { watchAdvance } from './advance'
import {
  clearActiveGuideOrigin, clearGuideSession, loadActiveGuideOrigin, loadGuideSession, markGuideCompleted, saveActiveGuideOrigin, saveGuideSession,
} from './storage'
import { loadGuideDefinition } from './registry'
import { enterPracticeSpace, exitPracticeSpace } from '@/services/company/practiceSpace'
import { selectedCompanyId, setCurrentCompanyId } from '@/services/company/companyContext'
import { currentRegion, setCurrentRegionId } from '@/services/region/regionContext'

export type GuideRouterLike = {
  push(to: string | { path: string; query?: Record<string, string> }): unknown
  currentRoute: { path: string }
}

export type GuideTargetResolver = typeof findGuideTarget
export type GuideTargetWaiter = typeof waitForGuideTarget

export const guideSession = ref<GuideSession | null>(null)
/** 「还差：xx」实时缺项（form 条件产出）。 */
export const guideMissing = ref<string[]>([])
/** 进入练习空间 / 兜底动作进行中（按钮转圈）。 */
export const guideBusy = ref(false)
/** 兜底动作失败的可读原因（填不进、找不到元素等）。 */
export const guideError = ref('')

let router: GuideRouterLike | null = null
let getUsername: () => string = () => ''
let resolveGuideTarget: GuideTargetResolver = findGuideTarget
let waitForGuideTargetFn: GuideTargetWaiter = waitForGuideTarget
let definition: GuideDefinition | null = null
let ctx: GuideCtx | null = null
let stepIndex = 0
let activationSeq = 0
let disposeAdvance: (() => void) | null = null
let waitAbort: AbortController | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

const routeListeners = new Set<(route: { path: string }) => void>()

/** GuideHost 调用：注入 router 与当前用户名（storage 键用）。 */
export function attachGuideRouter(next: GuideRouterLike, opts?: { getUsername?: () => string }): void {
  router = next
  if (opts?.getUsername) getUsername = opts.getUsername
  watch(
    () => router?.currentRoute.path,
    (path) => {
      if (!path) return
      for (const cb of [...routeListeners]) cb({ path })
    },
  )
}

/** 测试注入：替换目标查找 / 等待（node 无 DOM）。 */
export function attachGuideTargetResolver(resolve: GuideTargetResolver, wait?: GuideTargetWaiter): void {
  resolveGuideTarget = resolve
  if (wait) waitForGuideTargetFn = wait
}

function currentStep(): GuideStep | null {
  if (!definition) return null
  return definition.steps[stepIndex] ?? null
}

function persist(): void {
  const session = guideSession.value
  if (!session) return
  session.updatedAt = Date.now()
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const live = guideSession.value
    if (live) saveGuideSession(getUsername(), live.originCompanyId, { ...live })
  }, 250)
}

function teardownAdvance(): void {
  disposeAdvance?.()
  disposeAdvance = null
  waitAbort?.abort()
  waitAbort = null
  guideMissing.value = []
}

function makeCtx(session: GuideSession): GuideCtx {
  return {
    runTag: session.runTag,
    regionId: session.regionId,
    practiceCompanyId: session.practiceCompanyId,
    artifacts: session.artifacts,
    go: (path) => {
      router?.push(path)
    },
  }
}

/** 激活步骤：recover（仅恢复链）→ 路由前缀跳转 → 等目标出现 → 挂推进条件。 */
async function activate(index: number, opts: { restoring?: boolean } = {}): Promise<void> {
  if (!definition || !guideSession.value || !ctx) return
  const steps = definition.steps
  const i = Math.max(0, index)
  if (i >= steps.length) {
    guideSession.value.status = 'done'
    persist()
    return
  }
  const seq = ++activationSeq
  stepIndex = i
  const step = steps[i]
  const session = guideSession.value
  session.stepId = step.id
  if (session.status === 'target-missing') session.status = 'running'
  teardownAdvance()
  persist()

  // 恢复链上先按服务端真实状态找回：recover 成立说明这步（及之前）已完成，直接进下一步。
  if (opts.restoring && step.recover) {
    guideBusy.value = true
    const recovered = await tryRecover(step)
    guideBusy.value = false
    if (seq !== activationSeq) return
    if (recovered) {
      void activate(i + 1, { restoring: true })
      return
    }
  }

  if (step.route && router && !router.currentRoute.path.startsWith(step.route)) {
    router.push(step.route)
  }

  if (step.target) {
    // 刷新恢复给 1.5s 宽限；正常激活用步骤自己的 timeoutMs（默认 10s）。
    const timeoutMs = opts.restoring ? 1500 : (step.timeoutMs ?? 10000)
    waitAbort = new AbortController()
    const abort = waitAbort
    try {
      await waitForGuideTargetFn(step.target, { within: step.within, timeoutMs, signal: abort.signal })
    } catch {
      if (seq !== activationSeq || !guideSession.value) return
      if (opts.restoring && step.resumeTo) {
        const back = steps.findIndex((st) => st.id === step.resumeTo)
        if (back >= 0 && back !== i) {
          void activate(back)
          return
        }
      }
      guideSession.value.status = 'target-missing'
      persist()
      return
    }
    if (seq !== activationSeq) return
  } else {
    waitAbort = new AbortController()
  }

  disposeAdvance = watchAdvance(
    step.advance,
    ctx,
    {
      onRoute: (cb) => {
        routeListeners.add(cb)
        return () => routeListeners.delete(cb)
      },
      signal: waitAbort?.signal,
    },
    (payload) => {
      if (seq === activationSeq) proceed(payload)
    },
    (items) => {
      if (seq === activationSeq) guideMissing.value = items
    },
  )
}

async function tryRecover(step: GuideStep): Promise<boolean> {
  if (!step.recover || !ctx) return false
  // 页面数据加载需要时间：轮询等 state 就绪，上限 2.5s。
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    try {
      if (await step.recover(ctx)) return true
    } catch {
      // recover 出错当不成立，走正常激活。
      return false
    }
    await new Promise((sleep) => setTimeout(sleep, 200))
  }
  return false
}

/** 推进一步：capture 记录产物（subjectId / frameworkId 等）再激活下一步。 */
function proceed(payload?: unknown): void {
  const step = currentStep()
  const session = guideSession.value
  if (!step || !session || !definition) return
  step.capture?.(payload, ctx!)
  teardownAdvance()
  void activate(stepIndex + 1)
}

/** 开始一条导引：只建会话；进练习空间由 0-0 卡片的按钮（assist action）触发。 */
export async function start(guideId: string): Promise<void> {
  const def = await loadGuideDefinition(guideId)
  if (!def || def.status !== 'ready') return
  teardownAdvance()
  activationSeq++
  const session: GuideSession = {
    v: 1,
    guideId,
    stepId: def.steps[0]?.id ?? '',
    runTag: def.makeRunTag?.() ?? `G${Date.now().toString(36)}`,
    artifacts: {},
    originCompanyId: selectedCompanyId.value ?? '',
    practiceCompanyId: '',
    regionId: currentRegion.value?.id ?? 'yunnan',
    status: 'running',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  }
  definition = def
  guideSession.value = session
  ctx = makeCtx(session)
  stepIndex = 0
  const username = getUsername()
  saveActiveGuideOrigin(username, session.originCompanyId)
  saveGuideSession(username, session.originCompanyId, { ...session })
  void activate(0)
}

/** manual 步的「下一步」。 */
export function next(): void {
  const step = currentStep()
  if (!step || !guideSession.value) return
  teardownAdvance()
  void activate(stepIndex + 1)
}

/** 上一步（不小于第 0 步）。 */
export function back(): void {
  if (!guideSession.value) return
  teardownAdvance()
  void activate(Math.max(0, stepIndex - 1))
}

/** 跳过：仅 optional 步显示入口，这里同样校验。 */
export function skip(): void {
  const step = currentStep()
  if (!step?.optional || !guideSession.value) return
  teardownAdvance()
  void activate(stepIndex + 1)
}

/** 「帮我填 / 帮我点 / 带我去 / 进入练习空间并开始」兜底。 */
export async function assist(): Promise<void> {
  const step = currentStep()
  if (!step?.assist || !ctx) return
  const spec = step.assist
  guideBusy.value = true
  guideError.value = ''
  try {
    if (spec.kind === 'fill') {
      // ready（如框架协议候选已加载）不满足时等待，而不是把值写脏。
      const deadline = Date.now() + 5000
      let current: Record<string, unknown> | null = null
      for (;;) {
        current = readGuideForm(spec.form)
        if (current && (!spec.ready || spec.ready(current))) break
        if (Date.now() >= deadline) {
          guideError.value = '表单还没准备好，稍后再试'
          return
        }
        await new Promise((sleep) => setTimeout(sleep, 200))
      }
      if (!fillGuideForm(spec.form, spec.values(ctx, current ?? undefined))) {
        guideError.value = '没找到要填的表单（对话框可能没打开）'
      }
    } else if (spec.kind === 'click') {
      const el = resolveGuideTarget(step.target ?? '', step.within)
      if (!el) {
        guideError.value = '没找到要点的元素'
        return
      }
      el.click()
    } else if (spec.kind === 'navigate') {
      if (!router) {
        guideError.value = '导航不可用'
        return
      }
      router.push(spec.to(ctx))
    } else {
      await spec.run(ctx)
    }
  } finally {
    guideBusy.value = false
  }
}

/**
 * 进入练习空间（0-0 按钮 / 恢复会话共用）。幂等：已在练习公司时服务端直接返回；
 * origin 以服务端解析的上级公司为准，但会话里已有 origin 就不再覆盖。
 */
export async function enterGuidePracticeSpace(): Promise<void> {
  const session = guideSession.value
  if (!session) return
  guideBusy.value = true
  try {
    const result = await enterPracticeSpace({ module: 'midlong', regionId: session.regionId, seedStations: true })
    session.practiceCompanyId = result.practiceCompanyId
    if (!session.originCompanyId) session.originCompanyId = result.originCompanyId
    if (ctx) ctx.practiceCompanyId = result.practiceCompanyId
    persist()
  } finally {
    guideBusy.value = false
  }
}

// 离开练习公司 / 切出导引地区 → 暂停。0-0 之前（还没进过练习空间）切公司不暂停，
// 导引停在原地等用户回来点「进入练习空间并开始」。
watch(selectedCompanyId, (id) => {
  const session = guideSession.value
  if (!session || (session.status !== 'running' && session.status !== 'target-missing')) return
  if (!session.practiceCompanyId || id === session.practiceCompanyId) return
  teardownAdvance()
  activationSeq++
  session.status = 'paused'
  session.pauseReason = 'company'
  persist()
})

watch(
  () => currentRegion.value?.id,
  (regionId) => {
    const session = guideSession.value
    if (!session || (session.status !== 'running' && session.status !== 'target-missing')) return
    if (!regionId || regionId === session.regionId) return
    teardownAdvance()
    activationSeq++
    session.status = 'paused'
    session.pauseReason = 'region'
    persist()
  },
)

/** 手动暂停（Launcher 运行中面板的「暂停」）：不设 pauseReason，停靠条文案用通用措辞。 */
export function pause(): void {
  const session = guideSession.value
  if (!session || session.status !== 'running') return
  teardownAdvance()
  activationSeq++
  session.status = 'paused'
  session.pauseReason = undefined
  persist()
}

/** 恢复暂停的会话：先切回导引地区，再回练习公司（顺序错了会被地区守卫拦下）。 */
export async function resume(): Promise<void> {
  const session = guideSession.value
  if (!session || session.status !== 'paused') return
  guideBusy.value = true
  guideError.value = ''
  try {
    if (currentRegion.value?.id !== session.regionId) setCurrentRegionId(session.regionId)
    await enterGuidePracticeSpace()
    session.status = 'running'
    session.pauseReason = undefined
    persist()
    void activate(stepIndex)
  } catch (error) {
    guideError.value = error instanceof Error ? error.message : String(error)
  } finally {
    guideBusy.value = false
  }
}

/** target-missing 态的重试。 */
export function retryTarget(): void {
  const session = guideSession.value
  if (!session || session.status !== 'target-missing') return
  session.status = 'running'
  persist()
  void activate(stepIndex)
}

/** target-missing 态「跳到上一步」。 */
export function backFromMissing(): void {
  const session = guideSession.value
  if (!session || session.status !== 'target-missing') return
  session.status = 'running'
  persist()
  void activate(Math.max(0, stepIndex - 1))
}

/**
 * 退出导引。默认退出练习空间回原公司；stay:true 留在练习空间。
 * completed:true（总结卡片的两个按钮）额外记完成记录，普通退出不记。
 */
export async function exit(opts: { stay?: boolean; completed?: boolean } = {}): Promise<void> {
  const session = guideSession.value
  if (!session) return
  teardownAdvance()
  activationSeq++
  const username = getUsername()
  if (opts.completed) markGuideCompleted(username, session.guideId)
  clearGuideSession(username, session.originCompanyId)
  clearActiveGuideOrigin(username)
  if (!opts.stay) {
    try {
      await exitPracticeSpace()
    } catch {
      // 退出失败也结束导引；下面还有兜底切换。
    }
    if (session.originCompanyId && selectedCompanyId.value !== session.originCompanyId) {
      setCurrentCompanyId(session.originCompanyId)
    }
  }
  guideSession.value = null
  definition = null
  ctx = null
}

/** 刷新后恢复：按 active 指针找到会话，从持久化的 stepId（失效则回第 0 步）续跑。 */
export async function restore(): Promise<void> {
  if (guideSession.value || !router) return
  const username = getUsername()
  const origin = loadActiveGuideOrigin(username)
  if (!origin) return
  const saved = loadGuideSession(username, origin)
  if (!saved || saved.status === 'done') {
    clearActiveGuideOrigin(username)
    if (saved) clearGuideSession(username, origin)
    return
  }
  const def = await loadGuideDefinition(saved.guideId)
  if (!def || def.status !== 'ready') {
    clearActiveGuideOrigin(username)
    clearGuideSession(username, origin)
    return
  }
  definition = def
  guideSession.value = saved
  ctx = makeCtx(saved)
  const index = def.steps.findIndex((st) => st.id === saved.stepId)
  stepIndex = index >= 0 ? index : 0
  void activate(stepIndex, { restoring: true })
}

/** 卡片 / 停靠条渲染所需的一切（GuideCard 只读这个，不碰内部状态）。 */
export const guideState = computed(() => {
  const session = guideSession.value
  if (!session || !definition) return null
  const step = definition.steps[stepIndex] ?? null
  const total = definition.steps.length
  const body = step ? (typeof step.body === 'function' ? step.body(ctx!) : step.body) : ''
  return {
    session,
    definition,
    step,
    index: stepIndex,
    total,
    body,
    missing: guideMissing.value,
    busy: guideBusy.value,
    error: guideError.value,
    assist: step?.assist ?? null,
    optional: step?.optional ?? false,
    hasPrev: stepIndex > 0,
  }
})
