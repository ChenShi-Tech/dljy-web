<script setup lang="ts">
// 交易平台文档 (zptwd) — 精修版,对照 D2(数据维持现状,不再补抓)。
//  表格:复选 + 上传日期/文档名称/文档级别(普通蓝框·重要红框)/文档大小 + 操作(下载/预览)。
//  预览:PDF 直接新窗口预览;不易支持的格式(ppt/doc/xls)无法预览则触发下载。
//  搜索:按日期 / 按名称 / 按级别(普通/重要)。
// 数据:GET /sdpt/zptwd/list -> 10 文档 {scrq,wdmc,wdjb(0普通/1重要),wddx,downloadPath};本地文件经 /api/realfile 下发。
import { onMounted, ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchCaptured } from '@/services/captured'
import { fetchRaw, timeoutSignal } from '@/services/api'
import { currentRegion } from '@/services/region/regionContext'
import { onRegionChange } from '../composables/useRegionReload'
import { useQuerySync } from '../composables/useQuerySync'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'

const loading = ref(true)
const error = ref('')
const rows = ref<any[]>([])
const localById = ref<Record<string, string>>({})
const fDate = ref(''), fName = ref(''), fLevel = ref('')
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
// 筛选条件与路由 query 双向同步,刷新/分享链接后还原
useQuerySync({ date: fDate, name: fName, level: fLevel })
const pvVisible = ref(false), pvUrl = ref(''), pvTitle = ref('')

// region 随附件直链下发（直链不带 x-region-id 头），令附件命中与 _manifest 列表同一地区目录；
// 严格地区（云南）无自身附件时优雅断链而非串读山西（#346 阶段B 地区第一级）。
const fileUrl = (row: any) => { const n = localById.value[String(row.id)]; return n ? `${API_BASE}/realfile?family=sdpt_zptwd&name=${encodeURIComponent(n)}&region=${encodeURIComponent(currentRegion.value.id)}` : '' }
const ext = (name: string) => (String(name).split('.').pop() || '').toLowerCase()
const sizeText = (mb: number) => mb == null ? '-' : (mb >= 1 ? `${mb} MB` : `${Math.round(mb * 1024)} KB`)
const dates = computed(() => [...new Set(rows.value.map((r) => r.scrq).filter(Boolean))].sort().reverse())

const filtered = computed(() => rows.value.filter((r) =>
  (!fDate.value || r.scrq === fDate.value) &&
  (!fName.value || String(r.wdmc).includes(fName.value)) &&
  (!fLevel.value || String(r.wdjb) === fLevel.value)
).sort((a, b) => (a.scrq < b.scrq ? 1 : -1)))

async function load() {
  loading.value = true; error.value = ''
  try {
    const [res, manifest] = await Promise.all([
      fetchCaptured<any>('sdpt_zptwd', 'list'),
      fetchRaw('/realfile', { family: 'sdpt_zptwd', name: '_manifest.json' }, { signal: timeoutSignal(4000) }).then((r) => (r.ok ? r.json() : [])).catch(() => [])
    ])
    rows.value = res?.rows || res?.data || []
    const m: Record<string, string> = {}
    for (const e of manifest || []) m[String(e.id)] = e.savedAs
    localById.value = m
  } catch (e) { error.value = e instanceof Error ? e.message : '加载失败' } finally { loading.value = false }
}

function download(row: any) { const u = fileUrl(row); if (!u) { ElMessage.warning('该文档本地未存,需登录生产下载'); return } const a = document.createElement('a'); a.href = u + '&dl=1'; a.download = row.wdmc; a.click() }
function preview(row: any) {
  const u = fileUrl(row)
  if (!u) { ElMessage.warning('该文档本地未存,无法预览'); return }
  // PDF 浏览器可内联渲染 → 弹窗内 iframe 预览;ppt/word/excel 微软在线也打不开 → 直接触发下载
  if (ext(row.wdmc) === 'pdf') { pvUrl.value = u; pvTitle.value = row.wdmc; pvVisible.value = true }
  else { ElMessage.info('该格式（Word/Excel/PPT）暂不支持在线预览,已触发下载'); download(row) }
}
function reset() { fDate.value = fName.value = fLevel.value = '' }
function openExternal() { if (pvUrl.value) window.open(pvUrl.value, '_blank') }
onMounted(load)

onRegionChange(load)
</script>

<template>
  <div class="docs" v-loading="loading">
    <RegionDataBanner />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <div class="toolbar">
      <span class="lbl">上传日期</span>
      <el-select v-model="fDate" placeholder="全部" clearable size="small" style="width: 140px"><el-option v-for="d in dates" :key="d" :label="d" :value="d" /></el-select>
      <span class="lbl">文档名称</span>
      <el-input v-model="fName" placeholder="按名称搜索" clearable size="small" style="width: 200px" />
      <span class="lbl">级别</span>
      <el-select v-model="fLevel" placeholder="全部" clearable size="small" style="width: 110px"><el-option label="普通" value="0" /><el-option label="重要" value="1" /></el-select>
      <el-button size="small" @click="reset">重置</el-button>
    </div>

    <el-card shadow="never">
      <template #header><span style="font-weight:600;font-size:13px">交易平台文档（{{ filtered.length }} / {{ rows.length }}）</span></template>
      <el-table :data="filtered" height="540" border size="default" class="big" :empty-text="rows.length ? '当前筛选无结果' : '暂无文档数据'">
        <el-table-column type="index" label="序号" width="64" align="center" />
        <el-table-column prop="scrq" label="上传日期" width="120" sortable />
        <el-table-column prop="wdmc" label="文档名称" min-width="360" show-overflow-tooltip />
        <el-table-column label="文档级别" width="100" align="center">
          <template #default="{ row }">
            <span class="badge" :class="String(row.wdjb) === '1' ? 'imp' : 'normal'">{{ String(row.wdjb) === '1' ? '重要' : '普通' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="wddx" label="文档大小" width="115" align="right" sortable><template #default="{ row }">{{ sizeText(row.wddx) }}</template></el-table-column>
        <el-table-column label="操作" width="140" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="fileUrl(row)" text type="primary" size="small" @click="preview(row)">预览</el-button>
            <el-button v-if="fileUrl(row)" text type="primary" size="small" @click="download(row)">下载</el-button>
            <span v-else class="muted">未下载</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <!-- 数据源(内部参考,勿对外展示)：真实数据：GET /sdpt/zptwd/list + /api/realfile · 本地已存 个 ｜ PDF 可在线预览,其余格式触发下载 -->

    <!-- PDF 内联预览(浏览器原生渲染) -->
    <el-dialog v-model="pvVisible" :title="pvTitle" width="80%" top="5vh" append-to-body destroy-on-close>
      <iframe v-if="pvUrl" :src="pvUrl" class="pv-frame"></iframe>
      <template #footer>
        <el-button @click="pvVisible = false">关闭</el-button>
        <el-button type="primary" @click="openExternal">新窗口打开</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.docs { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; }
.toolbar .lbl { font-size: 13px; color: var(--el-text-color-regular); font-weight: 600; }
/* 移动端:筛选条纵排,行内定宽控件占满整行(断点规约 768) */
@media (max-width: 768px) {
  .toolbar { align-items: stretch; flex-direction: column; }
  .toolbar .el-select, .toolbar .el-input { width: 100% !important; }
}
.big :deep(.el-table__cell) { font-size: 13px; }
.big :deep(th .cell) { font-weight: 600; color: var(--el-text-color-primary); }
.badge { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; border: 1px solid; }
.badge.normal { color: var(--el-color-primary); border-color: var(--line); background: var(--panel-sub); }
.badge.imp { color: var(--danger); border-color: var(--danger); background: var(--danger-tint); }
.muted { color: var(--el-text-color-disabled); font-size: 12px; }
.pv-frame { width: 100%; height: 78vh; border: none; }
.mb { margin-bottom: 12px; }
.src { color: var(--el-text-color-secondary); font-size: 12px; margin: 12px 0 0; }
.src code { color: var(--el-color-primary); }
</style>
