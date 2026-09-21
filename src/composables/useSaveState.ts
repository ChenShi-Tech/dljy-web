import { ref } from 'vue'

// Stage 写回三态单源（spot-trading-module-hygiene）：saving/saveMsg/saveError 三连 +
// 「清态→成功写 saveMsg→失败写 saveError→finally 复位 saving」此前在 6 个 Stage/Storage
// 组件逐字复制。save() 返回成功提示文案（各步不同），抛错时取 e.message，
// 非 Error 抛出物回退到 errorFallback（各步历史文案不同，逐处传入保行为不变）。
export function useSaveState() {
  const saving = ref(false)
  const saveMsg = ref('')
  const saveError = ref('')

  async function runSave(save: () => Promise<string>, options: { errorFallback?: string } = {}): Promise<void> {
    saving.value = true
    saveMsg.value = ''
    saveError.value = ''
    try {
      saveMsg.value = await save()
    } catch (e) {
      // 默认文案沿用六个 Stage 历史副本的统一措辞「写回失败」
      saveError.value = e instanceof Error ? e.message : (options.errorFallback ?? '写回失败')
    } finally {
      saving.value = false
    }
  }

  return { saving, saveMsg, saveError, runSave }
}
