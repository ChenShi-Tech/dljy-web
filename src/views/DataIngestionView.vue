<script setup lang="ts">
// 数据摄取管理页（PR-2 可视化）：手动触发 POST /api/v1/ingest/:kind + 数据摄取链路说明。
// 与 /yygl/import-hub（手录 CSV）+ /yygl/data-browser（回放）构成「手录 → 自动摄取 → 回放」数据链路闭环。
// 定时自动摄取见 /system/schedules（data_ingestion kind）。
// 主题变量驱动，四档主题协调；遵循现有深色交易终端风格。
import { reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { CloudDownload, Database, Loader2, Sunset, Workflow } from 'lucide-vue-next'
import TrustBadge from '@/components/common/TrustBadge.vue'
import { triggerIngest, type IngestKind, type IngestResult } from '@/services/data/ingestClient'
import type { DataSourceBasis } from '@/services/data/types'

interface KindMeta {
  kind: IngestKind
  label: string
  desc: string
  icon: typeof Database
  paramsHint: string
  example: string
}

const KINDS: KindMeta[] = [
  { kind: 'weather-export', label: '云南气象', desc: 'Open-Meteo 气象要素 + 辐照 → yn_meteo / yn_irradiance', icon: CloudDownload, paramsHint: '无额外参数（自动从 Open-Meteo 拉取）', example: '{}' },
  { kind: 'spot-export', label: '云南现货', desc: '节点电价 / 系统供需 / 厂站结算 / 损益 → yn_node_price 等', icon: Database, paramsHint: 'dir（导出包解压目录）', example: '{ "dir": "data/yunnan/source/plant-exports/exports_2026_05..." }' },
  { kind: 'market-export', label: '市场经营分析', desc: '手录 CSV → market_analysis 公共 7 datasetKey', icon: Sunset, paramsHint: 'dir 或 file + dataset', example: '{ "dir": "/path/to/csv-dir", "region": "yunnan" }' }
]

// IngestKind 含 spot-ingest/forecast-etl（#885 向导一键生效），但本页 KINDS 仅展示前 3 个摄取入口；
// 补齐 Record 全部 key 满足类型完整性（新增 kind 在本页不渲染、不触发，无副作用）。
const busy = reactive<Record<IngestKind, boolean>>({ 'spot-export': false, 'weather-export': false, 'market-export': false, 'spot-ingest': false, 'forecast-etl': false })
const last = ref<Record<IngestKind, IngestResult | null>>({ 'spot-export': null, 'weather-export': null, 'market-export': null, 'spot-ingest': null, 'forecast-etl': null })
const errMsg = ref<Record<IngestKind, string>>({ 'spot-export': '', 'weather-export': '', 'market-export': '', 'spot-ingest': '', 'forecast-etl': '' })

async function run(meta: KindMeta) {
  busy[meta.kind] = true
  errMsg.value[meta.kind] = ''
  try {
    const params = {}
    last.value[meta.kind] = await triggerIngest(meta.kind, params)
  } catch (e) {
    errMsg.value[meta.kind] = (e as Error).message
  } finally {
    busy[meta.kind] = false
  }
}

// 摄取结果真伪判定（修 Codex P1-3：避免把合成兜底误标为可决策）。
// commitFamily source=IMPORT 默认 captured（operational）；但 weather-export 在 Open-Meteo
// 失败/超时时后端会走合成兜底正常退出（exitCode 0），此时 ETL stdout 会打印 sourceType=MOCK /
// (--synthetic 合成)（见 import-weather-export.mjs）。保守嗅探 stdout/stderr：出现
// MOCK/synthetic/合成 → synthetic（advisory_only），否则 captured（operational）。
// 这是前端最大努力；正解是 ingest 端点回传 family 级真伪（后续）。
function basisFromResult(r: IngestResult): DataSourceBasis {
  const blob = `${r.stdout}\n${r.stderr}`
  return /MOCK|synthetic|合成/i.test(blob) ? 'synthetic' : 'captured'
}
</script>

<template>
  <div class="ingest-page">
    <header class="page-head">
      <h1>数据摄取管理</h1>
      <p class="lede">触发 ETL 摄取云南现货 / 气象 / 市场经营分析数据，落 capture-raw + capture.sqlite（双写）。</p>
    </header>

    <section class="link-row">
      <RouterLink to="/yygl/import-hub" class="link">← 手录导入（ImportHub）</RouterLink>
      <RouterLink to="/yygl/data-browser" class="link">回放浏览（数据浏览器）→</RouterLink>
      <RouterLink to="/system/schedules" class="link"><Workflow :size="13" /> 定时自动摄取</RouterLink>
    </section>

    <section class="kind-grid">
      <article v-for="meta in KINDS" :key="meta.kind" class="kind-card">
        <div class="kind-head">
          <component :is="meta.icon" :size="18" class="kind-icon" />
          <div class="kind-title">
            <h3>{{ meta.label }}</h3>
            <code class="kind-code">{{ meta.kind }}</code>
          </div>
        </div>
        <p class="kind-desc">{{ meta.desc }}</p>
        <p class="kind-params"><span class="muted">参数：</span>{{ meta.paramsHint }}</p>

        <div class="kind-action">
          <button class="trigger" :disabled="busy[meta.kind]" @click="run(meta)">
            <Loader2 v-if="busy[meta.kind]" :size="14" class="spin" />
            <CloudDownload v-else :size="14" />
            {{ busy[meta.kind] ? '摄取中…' : '立即摄取' }}
          </button>
        </div>

        <div v-if="errMsg[meta.kind]" class="result err">
          ⚠ {{ errMsg[meta.kind] }}
        </div>
        <div v-else-if="last[meta.kind]" class="result" :class="{ ok: last[meta.kind]!.ok, fail: !last[meta.kind]!.ok }">
          <div class="result-head">
            <span>{{ last[meta.kind]!.ok ? (basisFromResult(last[meta.kind]!) === 'synthetic' ? '✓ 摄取完成·合成兜底' : '✓ 摄取成功') : '✗ 摄取失败' }} · exitCode {{ last[meta.kind]!.exitCode }}</span>
            <TrustBadge v-if="last[meta.kind]!.ok" :basis="basisFromResult(last[meta.kind]!)" />
          </div>
          <pre class="stdout">{{ last[meta.kind]!.stdout.slice(-400) }}</pre>
        </div>
      </article>
    </section>

    <section class="note">
      <p class="muted">说明：气象导出默认从 Open-Meteo 拉取真实气象（成功时口径为真实采集、可决策；Open-Meteo 失败走合成兜底时口径为合成、仅供决策支持）；现货导出 / 市场导出 需在服务端提供 <code>dir</code>/<code>file</code>（目录/文件参数）（前端默认留空，端点会返回提示）。真伪按 ETL 输出动态标注（嗅探到模拟或合成数据时降级为仅供决策支持）。</p>
    </section>
  </div>
</template>

<style scoped>
.ingest-page { padding: 18px 22px; max-width: 1180px; margin: 0 auto; }
.page-head h1 { font-size: 22px; font-weight: 600; color: var(--text); margin: 0 0 4px; }
.lede { color: var(--text-soft); font-size: 13.5px; margin: 0 0 14px; }
.link-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; font-size: 12.5px; }
.link { color: var(--primary); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
.link:hover { text-decoration: underline; }
.kind-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.kind-card {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius, 8px);
  padding: 16px; display: flex; flex-direction: column; gap: 8px;
}
.kind-head { display: flex; align-items: center; gap: 10px; }
.kind-icon { color: var(--primary); flex: none; }
.kind-title h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
.kind-code { font-size: 11px; color: var(--muted); font-family: var(--ck-mono, ui-monospace, monospace); }
.kind-desc { font-size: 12.5px; color: var(--text-body); margin: 0; line-height: 1.5; }
.kind-params { font-size: 12px; color: var(--text-soft); margin: 0; }
.muted { color: var(--muted); }
.kind-action { margin-top: 4px; }
.trigger {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  padding: 7px 14px; border-radius: var(--radius-sm, 6px); font-size: 13px; font-weight: 500;
  border: 1px solid var(--primary); color: var(--primary); background: transparent;
  transition: background 0.15s;
}
.trigger:hover:not(:disabled) { background: color-mix(in srgb, var(--primary) 10%, transparent); }
.trigger:disabled { opacity: 0.6; cursor: progress; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.result { margin-top: 6px; padding: 8px 10px; border-radius: var(--radius-sm, 6px); font-size: 12px; border: 1px solid; }
.result.ok { color: var(--success); border-color: color-mix(in srgb, var(--success) 35%, transparent); background: color-mix(in srgb, var(--success) 7%, transparent); }
.result.fail, .result.err { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); background: color-mix(in srgb, var(--danger) 7%, transparent); }
.result-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-weight: 500; }
.stdout { margin: 4px 0 0; font-size: 11px; color: var(--text-soft); font-family: var(--ck-mono, ui-monospace, monospace); white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow: auto; }
.note { margin-top: 18px; font-size: 12px; line-height: 1.6; }
code { font-family: var(--ck-mono, ui-monospace, monospace); font-size: 0.92em; padding: 1px 4px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 14%, transparent); }
</style>
