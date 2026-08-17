<script setup lang="ts">
// 一日作业链进度条：显示「你在第几步、上一步产出了什么、下一步是什么」。
//
// 它不是装饰：七步此前散在独立路由页，交易员做完一步不知道该去哪、也不知道上一步
// 的结论有没有被下一步接住。进度条把这条链显性化，且状态**只从申报单事实推导**
// （见 workflowStages.ts），不另存进度——独立存储的进度一旦与单据漂移，比没有更误导人。
//
// 2026-08-10 起为**纯页内组件**：点击步骤只 emit select 切换作业台内的面板，不做任何
// 路由跳转——跨页跳转会把链条切碎（每页各自绑单据、各自加载）。
import { computed } from 'vue'
import { Check, ChevronRight, Lock } from 'lucide-vue-next'
import type { DeclarationOrder } from '@/services/declarations'
import {
  STAGE_STATE_LABEL,
  stageStates,
  stagesForPosition,
  type StageId
} from '@/data/workflowStages'
import { activeStanceType } from '@/services/stance/stanceContext'

const props = defineProps<{
  /** 当前所在阶段 */
  current: StageId
  /** 作业主线单据；为 null 表示尚未绑定（作业台顶部先选/建单） */
  declaration: DeclarationOrder | null
}>()

const emit = defineEmits<{ select: [stage: StageId] }>()

const stages = computed(() => stagesForPosition(activeStanceType.value))
const states = computed(() => stageStates(stages.value, props.declaration))

const currentIndex = computed(() => stages.value.findIndex((s) => s.id === props.current))
const nextStage = computed(() => stages.value[currentIndex.value + 1] ?? null)
const prevStage = computed(() => (currentIndex.value > 0 ? stages.value[currentIndex.value - 1] : null))

/** 上一步是否已产出——没产出就提示回去补，而不是让人在本面板硬填。 */
const prevPending = computed(
  () => prevStage.value && states.value[prevStage.value.id] !== 'done'
)
</script>

<template>
  <nav class="ws">
    <ol class="ws-track">
      <li
        v-for="(stage, i) in stages"
        :key="stage.id"
        class="ws-node"
        :class="[states[stage.id], { active: stage.id === current }]"
      >
        <button type="button" class="ws-link" @click="emit('select', stage.id)">
          <span class="ws-badge">
            <Check v-if="states[stage.id] === 'done'" :size="12" />
            <Lock v-else-if="states[stage.id] === 'locked'" :size="11" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="ws-text">
            <b>{{ stage.scenario }} {{ stage.title }}</b>
            <em>{{ stage.id === current ? stage.window : STAGE_STATE_LABEL[states[stage.id]] }}</em>
          </span>
        </button>
        <ChevronRight v-if="i < stages.length - 1" :size="14" class="ws-arrow" />
      </li>
    </ol>

    <p v-if="!declaration" class="ws-hint warn">
      尚未绑定作业单据——本阶段的产出无处写回，请先在顶部选择或新建标的日申报单。
    </p>
    <p v-else-if="prevPending" class="ws-hint warn">
      上一步「{{ prevStage!.scenario }} {{ prevStage!.title }}」尚未产出结论，本阶段的部分判据会落
      「待接入」并升档审批。建议
      <button type="button" class="ws-jump" @click="emit('select', prevStage!.id)">先回去完成</button>。
    </p>
    <p v-else-if="nextStage" class="ws-hint">
      本阶段产出：{{ stages[currentIndex]?.output }} · OODA {{ stages[currentIndex]?.ooda }}。完成后进入
      <button type="button" class="ws-jump" @click="emit('select', nextStage!.id)">
        {{ nextStage.scenario }} {{ nextStage.title }}
      </button>
      —— {{ nextStage.output }}
    </p>
  </nav>
</template>

<style scoped>
.ws {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 10px;
  background: var(--el-fill-color-light, #f8fafc);
}

.ws-track {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ws-node {
  display: flex;
  align-items: center;
  gap: 2px;
}

.ws-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: none;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.ws-link:hover {
  background: rgba(37, 99, 235, 0.06);
}

.ws-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  background: #e2e8f0;
  color: #64748b;
  flex-shrink: 0;
}

.ws-text {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.ws-text b {
  font-size: 12px;
  font-weight: 600;
}

.ws-text em {
  font-style: normal;
  font-size: 10px;
  color: var(--el-text-color-secondary, #667);
}

.ws-node.done .ws-badge {
  background: #dcfce7;
  color: #15803d;
}

.ws-node.current .ws-badge {
  background: #2563eb;
  color: #fff;
}

.ws-node.locked .ws-badge {
  background: #f1f5f9;
  color: #94a3b8;
}

.ws-node.locked .ws-text b {
  color: #94a3b8;
}

.ws-node.active .ws-link {
  background: #eff6ff;
  box-shadow: inset 0 0 0 1px #bfdbfe;
}

.ws-arrow {
  color: #cbd5e1;
  flex-shrink: 0;
}

.ws-hint {
  margin: 0;
  padding-left: 2px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--el-text-color-secondary, #667);
}

.ws-hint.warn {
  color: #b45309;
}

.ws-jump {
  padding: 0;
  border: none;
  background: none;
  color: #1d4ed8;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
