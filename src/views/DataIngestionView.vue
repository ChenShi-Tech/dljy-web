<script setup lang="ts">
// 数据摄取管理页（数据运维工作台 /data-ops/console?panel=ingest）：手动触发 POST /api/v1/ingest/:kind。
// 链路闭环：?panel=import-hub（手录 CSV）→ 本页（手动/自动摄取）→ /yygl/data-browser（回放）。
// 定时自动摄取在「AI 工作室 → 定时任务」（/system/ai-studio?tab=schedules）。
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
  // 手动触发实际携带的参数（缺省 {} 保持既有 kind 行为）。中广核两个 kind 显式带
  // 回看窗口，上游日前价 D+1~D+2 才发布，单拉「今天」会 404（#2203）。
  params?: Record<string, unknown>
}

const KINDS: KindMeta[] = [
  { kind: 'weather-export', label: '云南气象', desc: 'Open-Meteo 气象要素 + 辐照 → yn_meteo / yn_irradiance', icon: CloudDownload, paramsHint: '无额外参数（自动从 Open-Meteo 拉取）', example: '{}' },
  { kind: 'spot-export', label: '云南现货月度导出包', desc: '交易中心月度导出包：厂站结算 / 损益 / 主数据 → yn_node_price 等', icon: Database, paramsHint: '无参数：自动选用 plant-exports 下最新解压目录（含 export_manifest.csv）；指定目录须服务器命令行', example: '{ }' },
  { kind: 'market-export', label: '市场经营分析（山西目录）', desc: '手录 CSV → market_analysis 公共 7 datasetKey；注意默认 region=shanxi', icon: Sunset, paramsHint: '无参数：默认扫 capture-raw/shanxi/market_analysis/；云南数据须服务器命令行 --region yunnan', example: '{ }' },
  { kind: 'cgn-yunnan-prices', label: '中广核云南电价', desc: '厂侧 API 节点/场站电价 → dljy_private 私有 PG（中广核专属）', icon: Database, paramsHint: 'lookbackDays + market + interval；未发布分区自动跳过', example: '{ "lookbackDays": 3, "market": "day_ahead", "interval": "15m" }', params: { lookbackDays: 3, market: 'day_ahead', interval: '15m' } },
  { kind: 'cgn-yunnan-market', label: '中广核云南市场/披露', desc: '厂侧 API 11 条市场曲线 + 26 类公共披露 → dljy_private 私有 PG（中广核专属）', icon: Sunset, paramsHint: 'resource + lookbackDays（默认回看 3 日）', example: '{ "resource": "all", "lookbackDays": 3 }', params: { resource: 'all', lookbackDays: 3 } }
]

// IngestKind 含 spot-ingest/forecast-etl（#885 向导一键生效），本页 KINDS 展示 5 个摄取入口
// （含中广核两个厂侧 API kind，#2203）；补齐 Record 全部 key 满足类型完整性（未列 kind 不渲染、不触发）。
const busy = reactive<Record<IngestKind, boolean>>({ 'spot-export': false, 'weather-export': false, 'market-export': false, 'spot-ingest': false, 'forecast-etl': false, 'cgn-yunnan-prices': false, 'cgn-yunnan-market': false })
const last = ref<Record<IngestKind, IngestResult | null>>({ 'spot-export': null, 'weather-export': null, 'market-export': null, 'spot-ingest': null, 'forecast-etl': null, 'cgn-yunnan-prices': null, 'cgn-yunnan-market': null })
const errMsg = ref<Record<IngestKind, string>>({ 'spot-export': '', 'weather-export': '', 'market-export': '', 'spot-ingest': '', 'forecast-etl': '', 'cgn-yunnan-prices': '', 'cgn-yunnan-market': '' })

async function run(meta: KindMeta) {
  busy[meta.kind] = true
  errMsg.value[meta.kind] = ''
  try {
    const params = meta.params ?? {}
    last.value[meta.kind] = await triggerIngest(meta.kind, params)
  } catch (e) {
    errMsg.value[meta.kind] = (e as Error).message
  } finally {
    busy[meta.kind] = false
  }
}

// 摄取结果真伪判定（避免把合成兜底误标为可决策）。
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
      <p class="lede">手动触发数据摄取与 ETL：现货月度导出包 / 气象 / 市场分析族写各自事实层与 capture 回放层；中广核云南厂侧 API 两族写中广核私有 PostgreSQL（dljy_private）。</p>
    </header>

    <section class="link-row">
      <RouterLink to="/data-ops/console?panel=import-hub" class="link">← 手录导入（导入融合台）</RouterLink>
      <RouterLink to="/yygl/data-browser" class="link">回放浏览（通用数据浏览器）→</RouterLink>
      <RouterLink to="/system/ai-studio?tab=schedules" class="link"><Workflow :size="13" /> 定时自动摄取（AI 工作室）</RouterLink>
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
      <p class="muted">说明：按钮参数固定（服务端白名单硬编码，不透传请求参数）——现货导出自动选用 plant-exports 最新解压目录（无目录时如实报错，指定目录须服务器命令行）；市场导出默认扫山西目录（region=shanxi），云南数据须服务器命令行 <code>--region yunnan</code>；气象默认从 Open-Meteo 拉取真实气象（失败走合成兜底时口径为合成、仅供决策支持）；中广核两族为真实厂侧外部 API（非电网官方接口），日前价上游 D+1~D+2 发布，回看窗口内未发布分区自动跳过。真伪按 ETL 输出动态标注（嗅探到模拟或合成数据时降级为仅供决策支持）。</p>
    </section>
  </div>
</template>

<style scoped>
.ingest-page { max-width: 1180px; }
.lede { color: var(--text-soft); font-size: var(--font-13-5); margin: 0 0 14px; }
.link-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; font-size: var(--font-12-5); }
.link { color: var(--primary); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
.link:hover { text-decoration: underline; }
.kind-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.kind-card {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius, 8px);
  padding: 16px; display: flex; flex-direction: column; gap: 8px;
}
.kind-head { display: flex; align-items: center; gap: 10px; }
.kind-icon { color: var(--primary); flex: none; }
.kind-title h3 { margin: 0; font-size: var(--font-15); font-weight: 600; color: var(--text); }
.kind-code { font-size: var(--font-xs); color: var(--muted); font-family: var(--ck-mono, ui-monospace, monospace); }
.kind-desc { font-size: var(--font-12-5); color: var(--text-body); margin: 0; line-height: 1.5; }
.kind-params { font-size: var(--font-sm); color: var(--text-soft); margin: 0; }
.muted { color: var(--muted); }
.kind-action { margin-top: 4px; }
.trigger {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  padding: 7px 14px; border-radius: var(--radius-sm, 6px); font-size: var(--font-md); font-weight: 500;
  border: 1px solid var(--primary); color: var(--primary); background: transparent;
  transition: background 0.15s;
}
.trigger:hover:not(:disabled) { background: color-mix(in srgb, var(--primary) 10%, transparent); }
.trigger:disabled { opacity: 0.6; cursor: progress; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.result { margin-top: 6px; padding: 8px 10px; border-radius: var(--radius-sm, 6px); font-size: var(--font-sm); border: 1px solid; }
.result.ok { color: var(--success); border-color: color-mix(in srgb, var(--success) 35%, transparent); background: color-mix(in srgb, var(--success) 7%, transparent); }
.result.fail, .result.err { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); background: color-mix(in srgb, var(--danger) 7%, transparent); }
.result-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-weight: 500; }
.stdout { margin: 4px 0 0; font-size: var(--font-xs); color: var(--text-soft); font-family: var(--ck-mono, ui-monospace, monospace); white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow: auto; }
.note { margin-top: 18px; font-size: var(--font-sm); line-height: 1.6; }
code { font-family: var(--ck-mono, ui-monospace, monospace); font-size: 0.92em; padding: 1px 4px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 14%, transparent); }
</style>
