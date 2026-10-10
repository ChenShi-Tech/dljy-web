<script setup lang="ts">
// 导引选择面板（dljy#3404）：GuideLauncher 的 popover 内容。
// 顶部固定说明（练习空间数据口径），下面按注册表列导引：可开始 / 继续进行中的 /
// 已完成可再来一遍 / 规划中灰显不可点。运行中面板提供 继续 / 暂停 / 退出。
import { computed, onMounted, ref } from 'vue'
import type { GuideDefinition } from '../types'
import { exit, guideSession, guideState, pause, resume, start } from '../runner'
import { listGuides } from '../registry'
import { midlongGuideAvailability } from '../midlong/availability'
import { loadCompletedGuides } from '../storage'
import { getCurrentUser } from '@/services/auth'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'

const props = defineProps<{ capabilities: MidlongCapabilities | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const guides = ref<GuideDefinition[]>([])
const completed = ref<string[]>([])
const availability = computed(() => midlongGuideAvailability(props.capabilities))

onMounted(async () => {
  guides.value = await listGuides('midlong')
  completed.value = loadCompletedGuides(getCurrentUser().username)
})

const session = guideSession
const runningState = guideState

const isCurrent = (guide: GuideDefinition): boolean => session.value?.guideId === guide.id

async function begin(guide: GuideDefinition): Promise<void> {
  await start(guide.id)
  emit('close')
}

function doContinue(): void {
  if (session.value?.status === 'paused') void resume()
  emit('close')
}

function doPause(): void {
  pause()
  emit('close')
}

function doExit(): void {
  void exit()
  emit('close')
}
</script>

<template>
  <div class="guide-picker">
    <p class="guide-picker-note">
      导引会切到练习空间【练习】公司，在里面建一套测试业务流；练习数据不计入集团汇总，也不能删除，再练一遍会追加新的一批。
    </p>

    <!-- 运行中的导引：继续 / 暂停 / 退出 -->
    <div v-if="session && runningState" class="guide-picker-active">
      <div class="guide-picker-active-head">
        <span class="guide-picker-active-title">正在跟：{{ runningState.definition.title }}</span>
        <span class="guide-picker-active-progress">{{ runningState.index + 1 }} / {{ runningState.total }}</span>
      </div>
      <div class="guide-picker-actions">
        <el-button size="small" type="primary" @click="doContinue">继续</el-button>
        <el-button v-if="session.status === 'running'" size="small" @click="doPause">暂停</el-button>
        <el-button size="small" text @click="doExit">退出导引</el-button>
      </div>
    </div>

    <ul class="guide-picker-list">
      <li v-for="guide in guides" :key="guide.id" class="guide-picker-item" :class="{ 'is-planned': guide.status === 'planned' }">
        <div class="guide-picker-item-main">
          <span class="guide-picker-item-title">
            {{ guide.title }}
            <span v-if="guide.status === 'planned'" class="guide-picker-item-badge">规划中</span>
            <span v-else-if="completed.includes(guide.id)" class="guide-picker-item-badge is-done">已完成</span>
          </span>
          <span class="guide-picker-item-summary">{{ guide.summary }}</span>
          <span v-if="guide.status === 'ready' && !availability.available" class="guide-picker-item-reason">
            {{ availability.reason }}
          </span>
        </div>
        <el-button
          v-if="guide.status === 'ready'"
          size="small"
          :type="isCurrent(guide) ? 'default' : 'primary'"
          :disabled="!availability.available"
          :title="availability.available ? undefined : availability.reason"
          @click="begin(guide)"
        >
          {{ isCurrent(guide) ? '继续' : completed.includes(guide.id) ? '再来一遍' : '开始' }}
        </el-button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.guide-picker-note {
  margin: 0 0 10px;
  padding: 8px 10px;
  font-size: var(--font-xs);
  line-height: 1.6;
  color: var(--text-soft);
  background: var(--panel-sub);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
}

.guide-picker-active {
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid var(--primary-tint-border);
  border-radius: var(--radius-sm);
  background: var(--primary-tint);
}

.guide-picker-active-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.guide-picker-active-title {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text);
}

.guide-picker-active-progress {
  font-size: var(--font-xs);
  color: var(--muted);
}

.guide-picker-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.guide-picker-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.guide-picker-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.guide-picker-item-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.guide-picker-item-title {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text);
}

.guide-picker-item.is-planned .guide-picker-item-title {
  color: var(--muted);
}

.guide-picker-item-badge {
  margin-left: 6px;
  padding: 1px 6px;
  font-size: var(--font-xs);
  font-weight: 400;
  color: var(--muted);
  background: var(--panel-sub);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.guide-picker-item-badge.is-done {
  color: var(--success);
}

.guide-picker-item-summary {
  font-size: var(--font-xs);
  line-height: 1.5;
  color: var(--text-soft);
}

.guide-picker-item.is-planned .guide-picker-item-summary {
  color: var(--muted);
}

.guide-picker-item-reason {
  font-size: var(--font-xs);
  color: var(--warning);
}
</style>
