// 当前主对话模型（主仓 #2658 的 /pi-api/agent/model）。
//
// 为什么需要它：后端的 auto 档会随自建端点可用性自动切换模型，此前这件事只写在
// 服务端日志里。**已经出过一次事故**：上游隧道断开后系统按设计回落到云端模型，
// 使用者却在页面上完全看不出来，只感觉「自建模型好像没生效」。演示场景更糟——
// 端点悄悄断掉、答案照常出来，观众会以为看到的是自建模型的输出。
//
// **模块级共享状态**：面板可能同时存在多个实例（工作台 + 悬浮球解读），各自轮询
// 等于把同一个事实问 N 遍。这里一份状态、一个定时器，组件只读。
import { onBeforeUnmount, onMounted, readonly, ref } from 'vue'

import { fetchCurrentModel, type CurrentModelInfo } from '@/services/agent/piPocClient'

/** 与后端 auto 档的复查周期同频（60s）——问得更勤也不会更快知道。 */
const REFRESH_MS = 60_000

const info = ref<CurrentModelInfo | null>(null)
let timer: ReturnType<typeof setInterval> | null = null
let consumers = 0

async function refresh(): Promise<void> {
  try {
    info.value = await fetchCurrentModel()
  } catch {
    // 服务未启动 / 旧版后端无此端点 / 超时：一律降级为不显示。
    // **宁可不显示，也不显示一个可能已经不对的模型名**——这个标签的全部价值就在于可信。
    info.value = null
  }
}

/**
 * 只读订阅当前模型。多个组件共用一份状态与一个定时器，最后一个卸载时停表。
 */
export function useCurrentModel() {
  onMounted(() => {
    consumers += 1
    void refresh()
    timer ??= setInterval(() => { void refresh() }, REFRESH_MS)
  })

  onBeforeUnmount(() => {
    consumers -= 1
    if (consumers <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  })

  return { model: readonly(info) }
}

/** 测试用：清空共享状态与定时器，避免用例间互相污染。 */
export function __resetCurrentModel(): void {
  info.value = null
  if (timer) clearInterval(timer)
  timer = null
  consumers = 0
}
