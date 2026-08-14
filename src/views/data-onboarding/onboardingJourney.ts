// ============================================================================
// onboardingJourney.ts — 数据接入向导旅程状态推导（#885）
// ----------------------------------------------------------------------------
// 把「模板台账 + 投递状态 + capture 新鲜度」三路只读信号折算成五步旅程线状态，
// 供 DataOnboardingView 每张卡片顶部「输入→校验→落位→生效→见数」横向 steps 实时点亮。
//
// 五步语义：
//   输入(input)    用户已上传模板/数据就绪（GET /api/v1/import-templates/records 有记录）
//   校验(validate) 上传行通过校验并 COMMITTED（台账 status=COMMITTED）
//   落位(deliver)  已投递到清单协议目录（record.deliveredPaths 非空，#822）
//   生效(effect)   ETL 已跑、数据落 capture（对应 family 新鲜度非 unknown）
//   见数(consume)  消费页可见（生效前提同源：freshness 非 unknown 即消费页可回放见数）
//
// 与真伪标注（basis）/ 新鲜度（freshness）正交：本模块只回答「链路走到哪步」，
// 不回答数据真不真（basis）/ 新不新（freshness 具体档位）。取数失败一律按未达成处理，绝不猜。
// 纯函数、无副作用、单测友好（参照 src/data/pageHelp.spec.ts 风格）。
// ============================================================================

import type { Freshness } from '@/services/data/freshness'

export type JourneyStepStatus = 'done' | 'pending' | 'unknown'

export interface JourneySteps {
  input: JourneyStepStatus
  validate: JourneyStepStatus
  deliver: JourneyStepStatus
  effect: JourneyStepStatus
  consume: JourneyStepStatus
}

export interface JourneyInput {
  /** GET /api/v1/import-templates/records 存在该 templateId 的记录（输入✓） */
  hasTemplateRecord?: boolean | null
  /** 存在 status=COMMITTED 的记录（校验通过并落台账✓） */
  hasCommitted?: boolean | null
  /** record.deliveredPaths 非空（已投递清单协议目录✓，#822） */
  hasDelivered?: boolean | null
  /** 对应 capture family 的新鲜度（生效/见数依据；'unknown'=未在 capture） */
  freshness?: Freshness | null
}

const isTrue = (v: boolean | null | undefined): v is true => v === true

/**
 * 把三路只读信号折算成五步旅程状态。
 *
 * 任一信号缺失（null/undefined/false）按未达成（'pending'）处理，不猜不夸大（诚实红线）。
 * freshness 非 'unknown'（fresh/aging/stale）视为数据已落 capture → 生效+见数 'done'；
 * 其中 stale 是「曾生效但过期」，仍算链路走通（具体档位由 UI 另标，不影响「走到哪步」判定）。
 */
export function deriveJourneySteps(input: JourneyInput): JourneySteps {
  const hasRecord = isTrue(input.hasTemplateRecord)
  const committed = isTrue(input.hasCommitted)
  const delivered = isTrue(input.hasDelivered)
  const fresh = input.freshness ?? null
  const hasEffect = fresh !== null && fresh !== 'unknown'

  return {
    input: hasRecord ? 'done' : 'pending',
    validate: committed ? 'done' : 'pending',
    deliver: delivered ? 'done' : 'pending',
    effect: hasEffect ? 'done' : 'pending',
    consume: hasEffect ? 'done' : 'pending',
  }
}

/**
 * 多 family 新鲜度聚合（best-wins）：取最有利档位 fresh > aging > stale > unknown。
 *
 * 一张卡片关联多个 family（如节点电价卡含 yn_node_price + yn_plant_nodal_price）时，
 * 任一族有数据即视为该链路已生效；显示档位取最新鲜的一族。全 unknown → 'unknown'。
 */
export function aggregateFreshness(
  freshnesses: Array<Freshness | null | undefined>
): Freshness {
  const rank: Record<Freshness, number> = { fresh: 0, aging: 1, stale: 2, unknown: 3 }
  let best: Freshness = 'unknown'
  for (const f of freshnesses) {
    if (!f) continue
    if (rank[f] < rank[best]) best = f
  }
  return best
}
