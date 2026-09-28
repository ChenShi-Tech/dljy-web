<script setup lang="ts">
// 导引卡片（dljy#3404）：锚定态（floating-ui 跟随目标 + 箭头）/ 居中态（无目标步骤，如章节说明）/
// 暂停停靠条（离开练习空间或切地区）/ target-missing 态。正文纯文本渲染（无 v-html），
// 无焦点陷阱——用户随时可以直接操作页面。
import { computed, ref, toRef } from 'vue'
import type { CSSProperties } from 'vue'
import {
  assist, back, backFromMissing, exit, guideSession, guideState, next, resume, retryTarget, skip,
} from '../runner'
import { useAnchoredPosition } from '../composables/useAnchoredPosition'

const props = defineProps<{ targetEl: HTMLElement | null; zIndex: number }>()

const state = guideState
const cardRef = ref<HTMLElement | null>(null)
const targetElRef = toRef(props, 'targetEl')

const anchored = computed(() => !!props.targetEl && !!state.value?.step?.target)
const placement = computed<'top' | 'bottom' | 'left' | 'right'>(() => {
  const p = state.value?.step?.placement
  return p === 'top' || p === 'left' || p === 'right' ? p : 'bottom'
})

const { x, y, side } = useAnchoredPosition(targetElRef, cardRef, computed(() => ({ placement: placement.value })))

const cardStyle = computed<CSSProperties>(() => {
  if (anchored.value) return { position: 'fixed', top: `${y.value}px`, left: `${x.value}px`, zIndex: props.zIndex }
  return { position: 'fixed', top: '18vh', left: '50%', transform: 'translateX(-50%)', zIndex: props.zIndex }
})

const status = computed(() => guideSession.value?.status ?? 'running')
const pauseText = computed(() => {
  const reason = guideSession.value?.pauseReason
  if (reason === 'company') return '已离开练习空间'
  if (reason === 'region') return '已切换到其它地区'
  return '导引已暂停'
})

const assistLabel = computed(() => {
  const a = state.value?.assist
  if (!a) return ''
  if (a.kind === 'fill') return '帮我填示例值'
  if (a.kind === 'click') return '帮我点'
  if (a.kind === 'navigate') return '带我去'
  return a.label
})

const isManual = computed(() => state.value?.step?.advance.kind === 'manual')
const finishing = computed(() => state.value?.step?.finishing === true)

const doExit = (): void => {
  void exit()
}
const doAssist = (): void => {
  void assist()
}
const doResume = (): void => {
  void resume()
}
const finishExit = (stay: boolean): void => {
  void exit({ stay, completed: true })
}
</script>

<template>
  <!-- 暂停态：右下角停靠条 -->
  <div v-if="status === 'paused'" class="guide-dock" :style="{ zIndex }">
    <span class="guide-dock-text">{{ pauseText }}</span>
    <el-button size="small" type="primary" :loading="state?.busy" @click="doResume">回到练习空间继续</el-button>
    <el-button size="small" @click="doExit">退出导引</el-button>
  </div>

  <!-- 目标缺失态 -->
  <div v-else-if="status === 'target-missing'" class="guide-card is-centered" :style="{ position: 'fixed', top: '18vh', left: '50%', transform: 'translateX(-50%)', zIndex }">
    <div class="guide-card-head">
      <span class="guide-card-title">没找到要指的位置</span>
    </div>
    <p class="guide-card-body" aria-live="polite">页面结构变了，或者要操作的对话框没打开。可以先重试；仍不行就跳到上一步重新操作。</p>
    <div class="guide-card-actions">
      <el-button size="small" type="primary" @click="retryTarget()">重试</el-button>
      <el-button size="small" @click="backFromMissing()">跳到上一步</el-button>
      <el-button size="small" text @click="doExit">退出</el-button>
    </div>
  </div>

  <!-- 常规态：锚定或居中 -->
  <div
    v-else-if="state?.step"
    ref="cardRef"
    class="guide-card"
    :class="anchored ? `is-anchored arrow-${side}` : 'is-centered'"
    :style="cardStyle"
  >
    <span v-if="anchored" class="guide-arrow" data-guide-arrow />
    <div class="guide-card-head">
      <span class="guide-card-title">{{ state.step.title }}</span>
      <span class="guide-card-progress">{{ state.index + 1 }} / {{ state.total }}</span>
    </div>
    <p class="guide-card-body" aria-live="polite">{{ state.body }}</p>
    <p v-if="state.missing.length" class="guide-card-missing">还差：{{ state.missing.join('、') }}</p>
    <p v-if="state.error" class="guide-card-error">{{ state.error }}</p>
    <div class="guide-card-actions">
      <template v-if="finishing">
        <el-button size="small" type="primary" @click="finishExit(false)">退出并回原公司</el-button>
        <el-button size="small" @click="finishExit(true)">留在练习空间</el-button>
      </template>
      <template v-else>
        <el-button v-if="assistLabel" size="small" type="primary" :loading="state.busy" @click="doAssist">
          {{ assistLabel }}
        </el-button>
        <el-button v-if="isManual" size="small" :type="assistLabel ? 'default' : 'primary'" @click="next()">下一步</el-button>
        <el-button v-if="state.hasPrev" size="small" @click="back()">上一步</el-button>
        <el-button v-if="state.optional" size="small" text @click="skip()">跳过</el-button>
        <el-button size="small" text @click="doExit">退出</el-button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.guide-card {
  width: 300px;
  max-width: calc(100vw - 32px);
  padding: 14px 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), 0 8px 24px rgba(15, 23, 42, 0.12);
  color: var(--text);
  pointer-events: auto;
}

.guide-card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.guide-card-title {
  font-size: var(--font-lg);
  font-weight: 600;
}

.guide-card-progress {
  flex: none;
  font-size: var(--font-xs);
  color: var(--muted);
}

.guide-card-body {
  margin: 0 0 8px;
  font-size: var(--font-sm);
  line-height: 1.6;
  color: var(--text-body);
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.guide-card-missing {
  margin: 0 0 8px;
  font-size: var(--font-xs);
  color: var(--warning);
}

.guide-card-error {
  margin: 0 0 8px;
  font-size: var(--font-xs);
  color: var(--danger);
}

.guide-card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.guide-arrow {
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--panel);
  border: 1px solid var(--line);
}

.arrow-top .guide-arrow {
  top: 0;
  border-top: none;
  border-left: none;
  transform: translate(-50%, -100%) rotate(45deg);
}

.arrow-bottom .guide-arrow {
  bottom: 0;
  border-bottom: none;
  border-right: none;
  transform: translate(-50%, 100%) rotate(45deg);
}

.arrow-left .guide-arrow {
  left: 0;
  border-bottom: none;
  border-left: none;
  transform: translate(-100%, -50%) rotate(45deg);
}

.arrow-right .guide-arrow {
  right: 0;
  border-top: none;
  border-right: none;
  transform: translate(100%, -50%) rotate(45deg);
}

.guide-dock {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), 0 8px 24px rgba(15, 23, 42, 0.12);
  pointer-events: auto;
}

.guide-dock-text {
  font-size: var(--font-sm);
  color: var(--text-soft);
}
</style>
