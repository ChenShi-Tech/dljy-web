// 推进条件编译（dljy#3404）：把 AdvanceCondition 编成一组订阅，条件满足时回调一次。
// 返回清理函数；form 条件满足后需持续 settleMs（默认 800ms 文本防抖）稳定才推进，
// 不满足时经 onMissing 实时上报「还差：xx」。本模块不 import router / 业务服务。
import { watch } from 'vue'
import type { AdvanceCondition, GuideCtx, GuideWithin } from './types'
import { onGuideSignal, readGuideForm, readGuideState } from './bridge'
import { findGuideTarget, waitForGuideTarget } from './targets'

export type AdvanceHooks = {
  /** 路由订阅由 runner 注入（advance 保持叶子，不 import '@/router'）。 */
  onRoute(cb: (route: { path: string }) => void): () => void
  /** 换步/退出时中止 visible 条件内部的 waitForGuideTarget。 */
  signal?: AbortSignal
}

/** 目标从页面上消失时回调（el-dialog 关闭靠 v-if/class 变化，MutationObserver 能看到）。 */
function watchGuideHidden(name: string, within: GuideWithin | undefined, onHidden: () => void): () => void {
  let disposed = false
  let frame = 0
  let observer: MutationObserver | null = null
  const cleanup = () => {
    disposed = true
    observer?.disconnect()
    clearInterval(interval)
    if (frame) cancelAnimationFrame(frame)
  }
  const check = () => {
    frame = 0
    if (disposed) return
    if (!findGuideTarget(name, within)) {
      cleanup()
      onHidden()
    }
  }
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(check)
  }
  try {
    observer = new MutationObserver(schedule)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden'],
    })
  } catch {
    // 无 body 的环境：仅靠 interval。
  }
  const interval = setInterval(schedule, 500)
  schedule()
  return cleanup
}

/**
 * 编译并挂起一个推进条件。onAdvance 至多回调一次（携带 signal/route 的 payload 供 capture）；
 * 返回清理函数，换步 / 暂停 / 退出时调用。ctx 是可变引用：artifacts 更新后各回调看到最新值。
 */
export function watchAdvance(
  cond: AdvanceCondition,
  ctx: GuideCtx,
  hooks: AdvanceHooks,
  onAdvance: (payload?: unknown) => void,
  onMissing?: (items: string[]) => void,
): () => void {
  let fired = false
  const fire = (payload?: unknown) => {
    if (fired) return
    fired = true
    onAdvance(payload)
  }
  const disposers: Array<() => void> = []

  switch (cond.kind) {
    case 'manual':
      // 手动推进：卡片上的「下一步」按钮，无自动订阅。
      break
    case 'visible':
      // 元素出现即推进（waitForGuideTarget 对已存在的目标立即 resolve）。
      waitForGuideTarget(cond.target, { within: cond.within, signal: hooks.signal }).then(
        () => fire(),
        () => {
          // 中止 / 环境异常：安静结束（换步由 runner 驱动）。
        },
      )
      break
    case 'hidden':
      disposers.push(watchGuideHidden(cond.target, cond.within, () => fire()))
      break
    case 'form': {
      const settleMs = cond.settleMs ?? 800
      let timer: ReturnType<typeof setTimeout> | null = null
      const evaluate = (values: Record<string, unknown> | null) => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (!values) return
        if (!cond.done(values, ctx)) {
          onMissing?.(cond.missing?.(values, ctx) ?? [])
          return
        }
        if (settleMs <= 0) {
          fire()
          return
        }
        // 满足后等稳定窗口：窗口内值又变了（watch 会再进来）就重新计时。
        timer = setTimeout(() => {
          const latest = readGuideForm(cond.form)
          if (latest && cond.done(latest, ctx)) fire()
        }, settleMs)
      }
      disposers.push(watch(() => readGuideForm(cond.form), evaluate, { immediate: true }))
      disposers.push(() => {
        if (timer) clearTimeout(timer)
      })
      break
    }
    case 'state':
      disposers.push(
        watch(
          () => readGuideState(cond.state),
          (snapshot) => {
            // payload 带 snapshot：capture 可从中提取场站清单等（如 0-0 记练习场站）。
            if (cond.done(snapshot, ctx)) fire(snapshot ?? undefined)
          },
          { immediate: true },
        ),
      )
      break
    case 'signal':
      disposers.push(
        onGuideSignal(cond.name, (payload) => {
          if (!cond.match || cond.match(payload, ctx)) fire(payload)
        }),
      )
      break
    case 'route':
      // 只在路由「变化」时评估：恢复时已落在目标路由的场景由步骤 recover 负责。
      disposers.push(
        hooks.onRoute((route) => {
          if (cond.match(route, ctx)) fire(route)
        }),
      )
      break
    case 'any': {
      const missingPer: string[][] = cond.of.map(() => [])
      cond.of.forEach((sub, i) => {
        disposers.push(
          watchAdvance(
            sub,
            ctx,
            hooks,
            (payload) => fire(payload),
            (items) => {
              missingPer[i] = items
              const first = missingPer.find((m) => m.length > 0)
              if (first) onMissing?.(first)
            },
          ),
        )
      })
      break
    }
  }

  return () => {
    for (const dispose of disposers) dispose()
  }
}
