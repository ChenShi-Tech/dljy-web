<script setup lang="ts">
// 「操作导引」入口按钮（dljy#3404）：挂在「中长期售电合同」页头右侧。
// 未运行显示「操作导引」；运行中显示「导引中 n/N」或「导引已暂停」，点开面板可继续/暂停/退出。
// 不可用时按钮禁用但保持可见，原生 tooltip 说明原因。
import { computed, ref } from 'vue'
import { guideSession, guideState } from '../runner'
import { midlongGuideAvailability } from '../midlong/availability'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'
import GuidePicker from './GuidePicker.vue'

const props = defineProps<{ group: 'midlong'; capabilities: MidlongCapabilities | null }>()

const open = ref(false)
const availability = computed(() => midlongGuideAvailability(props.capabilities))
const label = computed(() => {
  const session = guideSession.value
  if (!session) return '操作导引'
  if (session.status === 'paused') return '导引已暂停'
  const st = guideState.value
  return st ? `导引中 ${st.index + 1}/${st.total}` : '操作导引'
})
</script>

<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    :disabled="!availability.available"
    placement="bottom-end"
    :width="360"
  >
    <template #reference>
      <el-button
        size="small"
        class="guide-launcher-btn"
        data-guide="ml-guide-launcher"
        :disabled="!availability.available"
        :title="availability.available ? undefined : availability.reason"
      >
        {{ label }}
      </el-button>
    </template>
    <GuidePicker :capabilities="capabilities" @close="open = false" />
  </el-popover>
</template>

<style scoped>
.guide-launcher-btn {
  margin-left: auto;
}
</style>
