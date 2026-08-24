<script setup lang="ts">
// 复盘会议纪要表单（Epic #2033 · M4 · #2049：模板十二，C 档纯人工）
// ---------------------------------------------------------------------------
// 议程/上期措施回查/问题清单/改进分工/时限；会后 1 个工作日归档提醒（周末顺延）。
// 「上期改进措施」自动带入 improvement_actions 未闭环项（端点上线已接通；带入与
// 服务端清单逐项断言，违规即红字）；行动项写入落库；案例库检索强化占位
// （visibility 默认不公开）。
import { computed, onMounted, ref } from 'vue'
import { archiveDeadline, CASE_LIBRARY_NOTE, type MinutesActionRow } from '@/services/review/meetingMinutes'
import {
  broughtActionsViolations,
  type ImprovementActionSummary
} from '@/services/review/reviewStoreApi'
import {
  createImprovementAction,
  fetchCarryOverActions,
  patchImprovementAction
} from '@/services/review/reviewStoreClient'

const meetingDate = ref(new Date().toISOString().slice(0, 10))
const agenda = ref('')
const issues = ref<string[]>([])
const issueInput = ref('')
const actions = ref<MinutesActionRow[]>([])

const deadline = computed(() => archiveDeadline(meetingDate.value))

// ── 上期改进措施自动带入（#2049 验收断言随端点接入启用） ────────────────────
const carryAvailable = ref(false)
const carryNote = ref('')
const carried = ref<ImprovementActionSummary[]>([])
/** 回查结论：每条带入项的服务端 id + 人工判定（done/dropped/carried_over）。 */
const carryVerdicts = ref<Record<string, 'done' | 'dropped' | 'carried_over' | ''>>({})

onMounted(async () => {
  const feed = await fetchCarryOverActions()
  if (feed.available) {
    carryAvailable.value = true
    carried.value = feed.actions
    carryVerdicts.value = Object.fromEntries(feed.actions.map((a) => [a.id, '']))
  } else {
    carryAvailable.value = false
    carryNote.value =
      feed.reason === 'endpoint-absent'
        ? 'improvement_actions 读取端点未上线：上期措施请从上期纪要人工带入（断言验收不可用，如实提示）。'
        : 'improvement_actions 读取端点不可达：稍后刷新重试，或从上期纪要人工带入。'
  }
})

/** 带入视图行（含断言所需的 id/文本/状态镜像）。 */
const carriedRows = computed(() =>
  carried.value.map((a) => ({ actionId: a.id, action: a.action, status: a.status }))
)
/** #2049 验收断言：带入项与服务端未闭环清单逐项一致（多/少/改文本都算违规）。 */
const carryViolations = computed(() =>
  carryAvailable.value ? broughtActionsViolations(carriedRows.value, carried.value) : []
)

async function submitCarryVerdict(id: string) {
  const verdict = carryVerdicts.value[id]
  if (!verdict) return
  try {
    await patchImprovementAction(id, { status: verdict })
    carried.value = carried.value.filter((a) => a.id !== id)
    delete carryVerdicts.value[id]
  } catch (e) {
    carryNote.value = e instanceof Error ? e.message : '回查结论回写失败'
  }
}

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

// ── 改进分工行动项落库（写入端点已接通；端点缺席环境保留本地草稿） ──────────
const actionSaveState = ref<Record<number, 'saving' | 'saved' | 'error'>>({})
const actionSaveMsg = ref('')
async function saveAction(i: number) {
  const a = actions.value[i]
  if (!a.action.trim()) {
    actionSaveMsg.value = '改进措施内容必填后再落库'
    return
  }
  actionSaveState.value[i] = 'saving'
  try {
    await createImprovementAction({
      action: a.action.trim(),
      owner: a.owner || null,
      dueDate: a.dueDate || null
    })
    actionSaveState.value[i] = 'saved'
    actionSaveMsg.value = ''
  } catch (e) {
    actionSaveState.value[i] = 'error'
    actionSaveMsg.value = e instanceof Error ? e.message : '行动项落库失败（端点缺席环境保留本地草稿）'
  }
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
      <template v-if="carryAvailable">
        <p class="mm-note">未闭环项自动带入（review.improvement_actions，open/carried_over）——逐项回查后选结论并回写服务端。</p>
        <div v-for="a in carried" :key="a.id" class="mm-carry">
          <span class="mm-carry-text">{{ a.action }}<template v-if="a.owner"> · {{ a.owner }}</template><template v-if="a.dueDate"> · 限 {{ a.dueDate }}</template></span>
          <select v-model="carryVerdicts[a.id]">
            <option value="">回查结论…</option>
            <option value="done">已落实</option>
            <option value="dropped">已取消</option>
            <option value="carried_over">顺延下期</option>
          </select>
          <button type="button" :disabled="!carryVerdicts[a.id]" @click="submitCarryVerdict(a.id)">回写</button>
        </div>
        <p v-if="!carried.length" class="mm-note">服务端无未闭环项——上期措施全部闭环。</p>
        <p v-if="carryViolations.length" class="mm-warn">带入断言违规（与服务端未闭环清单不一致）：{{ carryViolations.join('；') }}</p>
        <p v-else-if="carried.length" class="mm-ok">带入断言通过：{{ carried.length }} 项与服务端未闭环清单一致。</p>
      </template>
      <template v-else>
        <p class="mm-note">{{ carryNote }}</p>
        <textarea rows="2" class="mm-input" placeholder="上期措施逐项回查（落实/未落实/顺延原因）" />
      </template>
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
        <button type="button" class="mm-save" :disabled="actionSaveState[i] === 'saving'" @click="saveAction(i)">
          {{ actionSaveState[i] === 'saved' ? '已落库' : actionSaveState[i] === 'saving' ? '落库中…' : '落库' }}
        </button>
      </div>
      <p v-if="actionSaveMsg" class="mm-warn">{{ actionSaveMsg }}</p>
      <p class="mm-note">行动项落 review.improvement_actions 跟踪（写入端点已接通；失败时保留本地草稿并提示，不静默丢弃）。</p>
    </div>

    <div class="mm-block">
      <b>案例库检索强化</b>
      <p class="mm-note">{{ CASE_LIBRARY_NOTE }}</p>
    </div>
  </section>
</template>

<style scoped>
.mm { display: flex; flex-direction: column; gap: 9px; font-size: var(--font-12-5); }
.mm-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.mm-head label { display: inline-flex; align-items: center; gap: 6px; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); }
.mm-deadline { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: var(--font-11-5); }
.mm-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); }
.mm-block { display: flex; flex-direction: column; gap: 5px; }
.mm-block b { font-size: var(--font-sm); }
.mm-note { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.mm-input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); font-family: inherit; }
.mm-add { display: flex; gap: 6px; }
.mm-add button, .mm-add-btn { align-self: flex-start; padding: 3px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: var(--font-11-5); cursor: pointer; }
.mm-item { margin: 0; padding: 4px 8px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 6px; font-size: var(--font-11-5); }
.mm-x { border: none; background: none; color: #b91c1c; cursor: pointer; padding: 0 2px; }
.mm-action { display: flex; gap: 6px; flex-wrap: wrap; }
.mm-action .mm-input { flex: 1; min-width: 100px; }
.mm-action .mm-owner { flex: 0 0 110px; }
.mm-carry { display: flex; align-items: center; gap: 6px; font-size: var(--font-11-5); }
.mm-carry-text { flex: 1; }
.mm-carry select { padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); }
.mm-carry button, .mm-save { padding: 3px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: var(--font-11-5); cursor: pointer; }
.mm-save:disabled { opacity: 0.6; cursor: default; }
.mm-warn { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: var(--font-11-5); }
.mm-ok { margin: 0; font-size: var(--font-xs); color: #15803d; }
</style>
