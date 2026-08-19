<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ApiError } from '@/services/api'
import { Clock3, History, Pencil, RotateCcw, Save, ShieldCheck, X } from 'lucide-vue-next'
import { fetchGridGeoPlantRevisions, revertGridGeoPlant, updateGridGeoPlant } from './client'
import type { GridGeoPlant, GridGeoPlantType, GridGeoRevision } from './types'

const props = defineProps<{ open: boolean; plant: GridGeoPlant | null; canWrite: boolean; startMode?: 'edit' | 'history' }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [plant: GridGeoPlant] }>()
const mode = ref<'edit' | 'history'>('edit')
const saving = ref(false)
const historyLoading = ref(false)
const revisions = ref<GridGeoRevision<GridGeoPlant>[]>([])
const form = reactive({ standardName: '', aliasesText: '', plantType: 'other' as GridGeoPlantType, capacityMw: null as number | null, status: '', subjectType: '', longitude: 0, latitude: 0, elevationM: null as number | null, locationLabel: '', accuracyLevel: 'approximate', confidence: 'unverified', uncertaintyMeters: 10000, nodeName: '', note: '', reason: '', evidenceTitle: '', evidenceUrl: '' })

const visible = computed({ get: () => props.open, set: (value) => emit('update:open', value) })
const types: Array<{ value: GridGeoPlantType; label: string }> = [{ value: 'wind', label: '风电' }, { value: 'solar', label: '光伏' }, { value: 'hydro', label: '水电' }, { value: 'thermal', label: '火电' }, { value: 'storage', label: '储能' }, { value: 'other', label: '其他' }]

watch(() => props.plant, (plant) => {
  if (!plant) return
  Object.assign(form, { standardName: plant.standardName, aliasesText: plant.aliases.join('、'), plantType: plant.plantType, capacityMw: plant.capacityMw, status: plant.status, subjectType: plant.subjectType, longitude: plant.location.longitude, latitude: plant.location.latitude, elevationM: plant.location.elevationM ?? null, locationLabel: plant.location.locationLabel, accuracyLevel: plant.location.accuracyLevel, confidence: plant.location.confidence, uncertaintyMeters: plant.location.uncertaintyMeters, nodeName: plant.nodeRefs[0]?.nodeName ?? '', note: plant.dataMeta.note, reason: '', evidenceTitle: plant.location.evidence[0]?.title ?? '', evidenceUrl: plant.location.evidence[0]?.url ?? '' })
}, { immediate: true })
watch(() => props.open, (open) => { if (open) mode.value = props.startMode ?? 'edit' })
watch([() => props.open, mode], ([open, currentMode]) => { if (open && currentMode === 'history') void loadHistory() })

async function loadHistory() {
  if (!props.plant) return
  historyLoading.value = true
  try { revisions.value = (await fetchGridGeoPlantRevisions(props.plant.plantId)).rows }
  catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : '版本历史加载失败') }
  finally { historyLoading.value = false }
}

async function save() {
  if (!props.plant || !props.canWrite) return
  if (!form.standardName.trim() || !form.reason.trim()) return ElMessage.warning('电厂名称和变更原因不能为空')
  const evidence = form.evidenceTitle.trim() && form.evidenceUrl.trim() ? [{ title: form.evidenceTitle.trim(), url: form.evidenceUrl.trim() }] : []
  saving.value = true
  try {
    const result = await updateGridGeoPlant(props.plant.plantId, {
      expectedVersion: props.plant.version,
      changes: {
        standardName: form.standardName.trim(), aliases: form.aliasesText.split(/[、,\n]/).map((item) => item.trim()).filter(Boolean),
        plantType: form.plantType, capacityMw: form.capacityMw, status: form.status.trim(), subjectType: form.subjectType.trim(),
        location: { longitude: Number(form.longitude), latitude: Number(form.latitude), elevationM: form.elevationM, coordinateSystem: 'WGS84', locationLabel: form.locationLabel.trim(), accuracyLevel: form.accuracyLevel, confidence: form.confidence, uncertaintyMeters: Number(form.uncertaintyMeters), displayPolicy: form.accuracyLevel === 'site' ? 'exact-marker' : 'uncertainty-halo', coordinateSource: props.plant.location.coordinateSource, evidence },
        nodeRefs: form.nodeName.trim() ? [{ nodeName: form.nodeName.trim(), relationType: 'pricing' }] : [],
        integrationRefs: props.plant.integrationRefs, dataMeta: { note: form.note.trim() },
      },
      reason: form.reason.trim(), evidence,
    })
    ElMessage.success('电厂空间卡片已保存为新版本')
    emit('saved', result.asset)
    visible.value = false
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409) {
      ElMessage.warning('电厂卡片已被其他会话更新，请刷新后重试')
      visible.value = false
    } else ElMessage.error(cause instanceof Error ? cause.message : '保存失败')
  } finally { saving.value = false }
}

async function revert(revision: GridGeoRevision<GridGeoPlant>) {
  if (!props.plant || !revision.before) return
  const prompt = await ElMessageBox.prompt('回退会创建一个新版本，请记录原因。', `回退至 v${revision.assetVersion - 1}`, { inputPattern: /\S+/, inputErrorMessage: '请填写原因', confirmButtonText: '确认回退', cancelButtonText: '取消' }).catch(() => null)
  if (!prompt) return
  try {
    const result = await revertGridGeoPlant(props.plant.plantId, revision.revisionId, props.plant.version, prompt.value)
    ElMessage.success('电厂卡片已回退')
    emit('saved', result.asset); visible.value = false
  } catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : '回退失败') }
}
</script>

<template>
  <el-drawer v-model="visible" size="min(600px, 96vw)" append-to-body :with-header="false">
    <div v-if="plant" class="governance">
      <header><div><small>VERSIONED PLANT PROFILE · v{{ plant.version }}</small><h2>{{ plant.standardName }}</h2><p><ShieldCheck :size="13" /> DB 审计写入 · 不写生产</p></div><button class="close" @click="visible = false"><X /></button></header>
      <nav><button :class="{ active: mode === 'edit' }" @click="mode = 'edit'"><Pencil :size="14" />编辑卡片</button><button :class="{ active: mode === 'history' }" @click="mode = 'history'"><History :size="14" />版本历史</button></nav>
      <div v-if="mode === 'edit'" class="form">
        <div v-if="!canWrite" class="readonly">当前角色/公司上下文仅可查看，编辑按钮已禁用。</div>
        <label class="wide"><span>标准名称</span><input v-model="form.standardName" :disabled="!canWrite" /></label><label class="wide"><span>别名</span><input v-model="form.aliasesText" :disabled="!canWrite" /></label>
        <label><span>类型</span><select v-model="form.plantType" :disabled="!canWrite"><option v-for="item in types" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><label><span>装机 MW</span><input v-model.number="form.capacityMw" type="number" :disabled="!canWrite" /></label><label><span>运行状态</span><input v-model="form.status" :disabled="!canWrite" /></label><label><span>主体类型</span><input v-model="form.subjectType" :disabled="!canWrite" /></label>
        <h4 class="wide">物理位置</h4><label><span>经度</span><input v-model.number="form.longitude" type="number" step="0.00001" :disabled="!canWrite" /></label><label><span>纬度</span><input v-model.number="form.latitude" type="number" step="0.00001" :disabled="!canWrite" /></label><label><span>高程 m</span><input v-model.number="form.elevationM" type="number" :disabled="!canWrite" /></label><label><span>不确定性 m</span><input v-model.number="form.uncertaintyMeters" type="number" :disabled="!canWrite" /></label><label class="wide"><span>位置标签</span><input v-model="form.locationLabel" :disabled="!canWrite" /></label><label><span>精度</span><select v-model="form.accuracyLevel" :disabled="!canWrite"><option value="site">场址级</option><option value="village">村级</option><option value="township">乡镇级</option><option value="county">县域级</option><option value="approximate">近似</option></select></label><label><span>可信度</span><select v-model="form.confidence" :disabled="!canWrite"><option value="verified">已核验</option><option value="probable">待复核</option><option value="unverified">未核验</option></select></label>
        <h4 class="wide">业务接缝与证据</h4><label class="wide"><span>定价节点</span><input v-model="form.nodeName" :disabled="!canWrite" /></label><label><span>证据标题</span><input v-model="form.evidenceTitle" :disabled="!canWrite" /></label><label><span>证据 HTTPS URL</span><input v-model="form.evidenceUrl" :disabled="!canWrite" /></label><label class="wide"><span>数据说明</span><textarea v-model="form.note" rows="2" :disabled="!canWrite" /></label><label class="wide required"><span>变更原因</span><textarea v-model="form.reason" rows="2" :disabled="!canWrite" placeholder="必填，将记入版本审计" /></label>
        <footer class="wide"><button @click="visible = false">取消</button><button class="primary" :disabled="!canWrite || saving" @click="save"><Save :size="14" />{{ saving ? '保存中…' : '保存新版本' }}</button></footer>
      </div>
      <div v-else v-loading="historyLoading" class="timeline"><article v-for="revision in revisions" :key="revision.revisionId"><span class="dot"><Clock3 /></span><div><header><strong>v{{ revision.assetVersion }} · {{ revision.operation }}</strong><time>{{ new Date(revision.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</time></header><p>{{ revision.reason || '系统建档' }}</p><small>{{ revision.actor.userId }} · {{ revision.actor.role }}</small><button v-if="revision.before && revision.operation !== 'REVERT' && canWrite" @click="revert(revision)"><RotateCcw :size="13" />回退到变更前</button></div></article></div>
    </div>
  </el-drawer>
</template>

<style scoped>
.governance { min-height: 100%; padding: 22px; color: #25404c; background: #f4f8fa; }.governance>header { display:flex;justify-content:space-between;padding:21px;border-radius:16px;color:#e9fbff;background:radial-gradient(circle at 80% 0,rgba(50,217,237,.2),transparent 35%),linear-gradient(135deg,#071b2c,#0a3446); }.governance>header small { color:#47d7ec;font-size: var(--font-lg);letter-spacing:.16em; }.governance h2 { margin:5px 0; }.governance>header p { display:flex;align-items:center;gap:5px;margin:0;color:#8fb7c4;font-size: var(--font-15); }.close { width:34px;height:34px;padding:0;color:#a1c5d0;border:1px solid rgba(255,255,255,.15);border-radius:9px;background:rgba(255,255,255,.05); }.governance>nav { display:flex;gap:7px;margin:14px 0; }.governance button { display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 11px;border:1px solid #cddde3;border-radius:8px;color:#45616c;background:#fff;cursor:pointer; }.governance button.active,.primary { color:#fff!important;border-color:#0c9fbd!important;background:linear-gradient(135deg,#14b8d5,#087e9c)!important; }.form { display:grid;grid-template-columns:1fr 1fr;gap:11px;padding-bottom:30px; }.form label { display:flex;min-width:0;flex-direction:column;gap:5px; }.form label span { color:#607984;font-size: var(--font-15); }.form input,.form select,.form textarea { width:100%;box-sizing:border-box;padding:9px;border:1px solid #d3e2e7;border-radius:8px;color:#284651;background:#fff; }.wide { grid-column:1/-1; }.form h4 { margin:8px 0 0;padding-bottom:6px;border-bottom:1px solid #dce8ec; }.readonly { grid-column:1/-1;padding:10px;border:1px solid #f0d69d;border-radius:9px;color:#966a19;background:#fff8e9;font-size: var(--font-15); }.required span::after { color:#e45454;content:' *'; }.form footer { display:flex;justify-content:flex-end;gap:7px;margin-top:5px; }.timeline article { display:grid;grid-template-columns:32px 1fr;gap:10px; }.timeline article>div { padding-bottom:24px; }.dot { display:grid;width:28px;height:28px;place-items:center;border-radius:50%;color:#0c9fbd;background:#e2f6fa; }.dot :deep(svg) { width:13px; }.timeline article>div>header { display:flex;justify-content:space-between; }.timeline time,.timeline small { color:#8ba0a9;font-size: var(--font-15); }.timeline p { margin:7px 0;color:#516c77;font-size: var(--font-15); }.timeline button { margin-top:8px;font-size: var(--font-15); }
@media(max-width:560px){.form{grid-template-columns:1fr}.wide{grid-column:auto}}
</style>
