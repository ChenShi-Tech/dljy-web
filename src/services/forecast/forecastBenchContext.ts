// 预测中心内「建模工作台 → 申报决策」的同页上下文共享（#79，codex P1 3620694192）。
// 工作台每次成功生成预测后登记本次实验上下文；申报决策 tab 激活时（用户尚未在决策
// 侧手动改过控件的前提下）跟随最近一次实验的模型/目标日/训练窗，避免决策计算
// 默默退回默认值。这是模块级共享状态，不是跨页跳转——两个视图同属预测中心单页。
import { ref } from 'vue'

export type ForecastBenchContext = {
  // 仅计算型算法可作为驾驶舱 /predict 模型；回放算法生成的实验不携带 model。
  modelId?: string
  targetDate: string
  trainDays: number
  // 单调递增序号：消费方比对「是否已应用过该次实验」，避免重复覆盖。
  seq: number
}

let seq = 0
export const latestBenchContext = ref<ForecastBenchContext | null>(null)

export function publishBenchContext(ctx: Omit<ForecastBenchContext, 'seq'>) {
  latestBenchContext.value = { ...ctx, seq: ++seq }
}

