<script setup lang="ts">
// 复盘会议纪要表单（Epic #2033 · M4 · #2049：模板十二，C 档纯人工）
// ---------------------------------------------------------------------------
// 议程/上期措施回查/问题清单/改进分工/时限；会后 1 个工作日归档提醒（周末顺延）。
// 「上期改进措施」自动带入 improvement_actions 未闭环项，端点未上线，诚实占位 +
// 人工带入；案例库检索强化（类型/场景/是否公开）占位（visibility 默认不公开）。
import { computed, ref } from 'vue'
import { archiveDeadline, CASE_LIBRARY_NOTE, type MinutesActionRow } from '@/services/review/meetingMinutes'

const meetingDate = ref(new Date().toISOString().slice(0, 10))
const agenda = ref('')
const issues = ref<string[]>([])
const issueInput = ref('')
const actions = ref<MinutesActionRow[]>([])

const deadline = computed(() => archiveDeadline(meetingDate.value))

function addIssue() {
  const t = issueInput.value.trim()
  if (t) {
    issues.value.push(t)
    issueInput.value = ''
  }
}
function removeIssue(i: number) {
  issues.value.splice(i, 1)
}
function addAction() {
  actions.value.push({ action: '', owner: '', dueDate: '' })
}
</script>

<template>
  <section class="mm">
    <header class="mm-head">
      <b>复盘会议纪要（模板十二 · C 档纯人工）</b>
      <label>会议日期 <input v-model="meetingDate" type="date" /></label>
    </header>
    <p v-if="deadline" class="mm-deadline">归档提醒：会后 1 个工作日内归档——截止 <b>{{ deadline }}</b>（周末顺延，法定节假日表未接入以周末口径为保守值）。</p>

    <label class="mm-field">
      议程
      <textarea v-model="agenda" rows="2" class="mm-input" placeholder="本期复盘议程" />
    </label>

    <div class="mm-block">
      <b>上期改进措施回查</b>
      <p class="mm-note">未闭环项应自动带入（review.improvement_actions）——读取端点随服务端化上线；上线前请从上期纪要人工带入并在下框逐项回查（断言验收随端点接入启用）。</p>
      <textarea rows="2" class="mm-input" placeholder="上期措施逐项回查（落实/未落实/顺延原因）" />
    </div>

    <div class="mm-block">
      <b>问题清单</b>
      <div class="mm-add">
        <input v-model="issueInput" class="mm-input" placeholder="本期暴露的问题" @keyup.enter="addIssue" />
        <button type="button" @click="addIssue">加入</button>
      </div>
      <p v-for="(q, i) in issues" :key="i" class="mm-item">{{ q }} <button type="button" class="mm-x" @click="removeIssue(i)">×</button></p>
    </div>

    <div class="mm-block">
      <b>改进分工与时限</b>
      <button type="button" class="mm-add-btn" @click="addAction">+ 添加行动项</button>
      <div v-for="(a, i) in actions" :key="i" class="mm-action">
        <input v-model="a.action" class="mm-input" placeholder="改进措施" />
        <input v-model="a.owner" class="mm-input mm-owner" placeholder="责任人" />
        <input v-model="a.dueDate" type="date" class="mm-input" />
      </div>
      <p class="mm-note">行动项落 improvement_actions 跟踪（写入端点未上线，本地草稿不落库）。</p>
    </div>

    <div class="mm-block">
      <b>案例库检索强化</b>
      <p class="mm-note">{{ CASE_LIBRARY_NOTE }}</p>
    </div>
  </section>
</template>

<style scoped>
.mm { display: flex; flex-direction: column; gap: 9px; font-size: 12.5px; }
.mm-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.mm-head label { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--el-text-color-secondary, #666); }
.mm-deadline { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11.5px; }
.mm-field { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--el-text-color-secondary, #666); }
.mm-block { display: flex; flex-direction: column; gap: 5px; }
.mm-block b { font-size: 12px; }
.mm-note { margin: 0; font-size: 11px; color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.mm-input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: 11.5px; font-family: inherit; }
.mm-add { display: flex; gap: 6px; }
.mm-add button, .mm-add-btn { align-self: flex-start; padding: 3px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: 11.5px; cursor: pointer; }
.mm-item { margin: 0; padding: 4px 8px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 6px; font-size: 11.5px; }
.mm-x { border: none; background: none; color: #b91c1c; cursor: pointer; padding: 0 2px; }
.mm-action { display: flex; gap: 6px; flex-wrap: wrap; }
.mm-action .mm-input { flex: 1; min-width: 100px; }
.mm-action .mm-owner { flex: 0 0 110px; }
</style>
