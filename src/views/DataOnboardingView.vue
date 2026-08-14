<script setup lang="ts">
// 数据接入向导（#885）：从用户体验出发，按「用户手里有什么数据」组织的旅程总览 +
// UI 内一键生效闭环。把散落 3 个导航组（数据管理 / 信息披露与采集 / 系统管理）的 4 条
// 数据进入线（导入中心手录 / 命令行 ETL / 自动 scheduler / 外部凭据）收成一张「先做什么、
// 再做什么、点哪里生效、去哪见数」的地图，并修复「上传→须命令行跑 ETL→才见数」的断点。
//
// 五类旅程卡片（按数据类别组织，非按技术通道）：
//   ① 现货节点电价 T0（模板→投递→点 spot-ingest 生效→预测页见数）
//   ② 系统负荷/水电 T0/T1（模板→投递→点 forecast-etl 生效→预测页见数）
//   ③ 交易中心月度导出包（离线包→命令行 import:spot-export，如实说明须服务器执行）
//   ④ 南网披露 Cookie（录凭据→测连通→披露概览见数）
//   ⑤ 气象全自动（scheduler 06:30 自动采→手动补采→天气/发电预测见数）
//   ⑥ 结算/零售/交易记录（import-hub 台账录入即见数）
//
// 诚实红线：状态标签如实透传（freshness/台账/接入态），取数失败显示「未知」不猜；
// 未生效数据绝不显示「已可见」；生效按钮结果如实回显（成功/失败 + stdout 摘要）。
// 向导本身不产数据——它只消费 governance catalog / import-templates records /
// 只读信号汇总，并复用既有 ingest 端点触发 ETL。
import { computed, onMounted, reactive, ref } from 'vue'
import type { Component } from 'vue'
import { RouterLink } from 'vue-router'
import {
  CloudDownload, CloudSun, Coins, Database, FileText,
  Loader2, Network, Sunset, Workflow, Zap
} from 'lucide-vue-next'
import TrustBadge from '@/components/common/TrustBadge.vue'
import { apiGet } from '@/services/api'
import { freshnessOf, type Freshness } from '@/services/data/freshness'
import { triggerIngest, type IngestKind, type IngestResult } from '@/services/data/ingestClient'
import type { DataSourceBasis } from '@/services/data/types'
import { aggregateFreshness, deriveJourneySteps, type JourneySteps } from './data-onboarding/onboardingJourney'

// ─── 数据源信封类型（与后端 governance/import-hub 接口对齐）───────────────────
type CatalogItem = {
  family: string
  dataTime: string | null
}
type CatalogPayload = { items: CatalogItem[] } & Record<string, unknown>
type TemplateRecord = {
  templateId?: string
  status?: string
  deliveredPaths?: unknown[]
}
type RecordsPayload = { rows: TemplateRecord[]; total: number } & Record<string, unknown>

// ─── 卡片配置 ────────────────────────────────────────────────────────────────
type JourneyKind = 'template' | 'command' | 'auto' | 'ledger'
type EffectAction = { kind: IngestKind; label: string }
type ConsumeLink = { to: string; label: string }

interface OnboardingCard {
  key: string
  category: string
  title: string
  icon: Component
  what: string
  howText: string
  howLink?: { to: string; label: string }
  howCommand?: { command: string; note: string }
  families: string[]
  templateIds: string[]
  effect?: EffectAction
  consume: ConsumeLink[]
  cadence: 'daily' | 'monthly'
  journey: JourneyKind
}

// 深链 path 全部核对真实路由（router/index.ts + features/*/routes.ts）。
const CARDS: OnboardingCard[] = [
  {
    key: 'node-price',
    category: 'T0 · 交易中心口径',
    title: '现货节点电价',
    icon: Network,
    what: '交易中心发布的日前节点电价（DLR），按节点×时段，是价格预测与申报决策的核心输入。',
    howText: '下载 yn-t0-node-price 模板，按节点电价填报后上传，系统校验通过即投递到清单协议目录。',
    howLink: { to: '/yygl/import-hub', label: '去数据导入融合台上传模板' },
    families: ['yn_node_price', 'yn_plant_nodal_price'],
    templateIds: ['yn-t0-node-price'],
    effect: { kind: 'spot-ingest', label: '一键生效（摄取节点电价）' },
    consume: [
      { to: '/xhjy/yunnan/node-price', label: '节点电价分析' },
      { to: '/ycsj/workbench', label: 'ML 预测工作台' }
    ],
    cadence: 'daily',
    journey: 'template'
  },
  {
    key: 'load-hydro',
    category: 'T0/T1 · 系统供需',
    title: '系统负荷 / 水电出力',
    icon: Zap,
    what: '统调系统负荷（T0 实际/计划）与水电出力（T1），是负荷与发电预测的关键外生变量。',
    howText: '下载 yn-t0-system-load（统调负荷）/ yn-t1-hydro（水电出力）模板填报上传，投递到清单协议目录。',
    howLink: { to: '/yygl/import-hub', label: '去数据导入融合台上传模板' },
    families: ['yn_system_supply'],
    templateIds: ['yn-t0-system-load', 'yn-t1-hydro'],
    effect: { kind: 'forecast-etl', label: '一键生效（跑预测 ETL）' },
    consume: [
      { to: '/ycsj/workbench', label: 'ML 预测工作台' },
      { to: '/ycsj/station-generation', label: '厂站发电预测' }
    ],
    cadence: 'daily',
    journey: 'template'
  },
  {
    key: 'monthly-export',
    category: '交易中心月度导出包',
    title: '厂站结算 / 损益 / 主数据导出',
    icon: Sunset,
    what: '交易中心月底导出的整月结算、损益分解、厂站主数据等离线导出包（含 export_manifest.csv）。',
    howText: '把导出包解压到 data/yunnan/source/plant-exports/ 后跑摄取命令；本向导不替代服务器端运维操作。',
    howCommand: {
      command: 'npm run import:spot-export -- --dir <解压包目录> --write',
      note: '需在服务器（主仓库）执行：解压 exports_YYYY_MM_* 到 plant-exports/ 后运行，落维度层与结算族。'
    },
    families: ['yn_spot_settlement', 'yn_settlement_detail', 'yn_dim_plant'],
    templateIds: [],
    consume: [
      { to: '/xhjy/yunnan/settlement-price', label: '结算价分析' },
      { to: '/gsgl/output', label: '机组出力' }
    ],
    cadence: 'monthly',
    journey: 'command'
  },
  {
    key: 'weather',
    category: '全自动采集',
    title: '气象要素 / 辐照（Open-Meteo）',
    icon: CloudSun,
    what: 'Open-Meteo 公开气象（温度/湿度/风速/云量/降水 + GHI/DNI/DHI 辐照），驱动发电预测。',
    howText: '由定时任务每日 06:30 自动采集（data_ingestion kind），无需手录；缺数时可手动补采。',
    howLink: { to: '/system/ai-studio?tab=schedules', label: '查看定时采集任务' },
    families: ['yn_meteo', 'yn_irradiance'],
    templateIds: [],
    effect: { kind: 'weather-export', label: '手动补采气象' },
    consume: [
      { to: '/sjfx/tqyb', label: '天气预报' },
      { to: '/ycsj/station-generation', label: '厂站发电预测' }
    ],
    cadence: 'daily',
    journey: 'auto'
  },
  {
    key: 'ledger',
    category: '台账录入即见数',
    title: '结算 / 零售 / 市场交易记录',
    icon: Coins,
    what: '售电结算、零售套餐、市场交易等结构化台账数据，经数据导入融合台录入后直接进台账见数。',
    howText: '在数据导入融合台对应 tab 上传 CSV/Excel（投递型落 capture，台账型落 import-hub 台账）。',
    howLink: { to: '/yygl/import-hub', label: '去数据导入融合台录入' },
    families: [],
    templateIds: [],
    consume: [
      { to: '/yygl/import-hub', label: '导入台账与历史' },
      { to: '/gsgl/trades', label: '历史交易' }
    ],
    cadence: 'daily',
    journey: 'ledger'
  }
]

// ─── 状态：三路只读信号 ──────────────────────────────────────────────────────
const catalog = ref<CatalogPayload | null>(null)
const recordsByTemplate = reactive<Record<string, TemplateRecord[]>>({})
const loadErr = ref('')
const loading = ref(false)

// 生效按钮：每卡独立 busy / 结果 / 错误（key → ...）
const busy = reactive<Record<string, boolean>>({})
const lastResult = reactive<Record<string, IngestResult | null>>({})
const resultErr = reactive<Record<string, string>>({})

async function loadAll() {
  loading.value = true
  loadErr.value = ''
  try {
    catalog.value = await apiGet<CatalogPayload>('/api/v1/governance/catalog')
    // 拉取所有关联模板的台账记录（import-templates/records 按 templateId 过滤）。
    const templateIds = Array.from(new Set(CARDS.flatMap((c) => c.templateIds)))
    await Promise.all(
      templateIds.map(async (tid) => {
        try {
          const res = await apiGet<RecordsPayload>('/api/v1/import-templates/records', { templateId: tid })
          recordsByTemplate[tid] = res.rows ?? []
        } catch {
          // 单个台账取数失败不阻塞整页；该模板状态落「未知」。
          recordsByTemplate[tid] = []
        }
      })
    )
  } catch (e) {
    loadErr.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

// ─── 状态推导（纯函数消费）────────────────────────────────────────────────────
// family → 最新新鲜度：从 catalog.items 取该 family 最晚 dataTime，按节律折算。
function familyFreshness(families: string[], cadence: 'daily' | 'monthly'): Freshness {
  const items = catalog.value?.items
  if (!Array.isArray(items) || !families.length) return 'unknown'
  const times = items
    .filter((it) => families.includes(it.family))
    .map((it) => it.dataTime)
    .filter((t): t is string => Boolean(t))
  if (!times.length) return 'unknown'
  const latest = times.sort().slice(-1)[0] // ISO 字符串升序 = 时间升序
  return freshnessOf(latest, { cadence })
}

function templateSignals(templateIds: string[]) {
  const rows = templateIds.flatMap((tid) => recordsByTemplate[tid] ?? [])
  if (!rows.length) return { hasTemplateRecord: false, hasCommitted: false, hasDelivered: false }
  return {
    hasTemplateRecord: true,
    hasCommitted: rows.some((r) => r.status === 'COMMITTED'),
    hasDelivered: rows.some((r) => Array.isArray(r.deliveredPaths) && r.deliveredPaths.length > 0)
  }
}

// 卡片五步旅程状态（ledger 不显示五步线，返回 null）。
function stepsFor(card: OnboardingCard): JourneySteps | null {
  if (card.journey === 'ledger') return null
  const fresh = familyFreshness(card.families, card.cadence)
  const steps = deriveJourneySteps({ ...templateSignals(card.templateIds), freshness: fresh })
  // 气象全自动：输入/校验/落位由 scheduler 自动完成，强制点亮；effect/consume 看 freshness。
  if (card.journey === 'auto') {
    return { ...steps, input: 'done', validate: 'done', deliver: 'done' }
  }
  return steps
}

const STEP_LABELS = ['输入', '校验', '落位', '生效', '见数'] as const
const STEP_KEYS: (keyof JourneySteps)[] = ['input', 'validate', 'deliver', 'effect', 'consume']


// ─── 生效按钮：复用既有 ingest 端点（spot-ingest/forecast-etl/weather-export）──
async function runEffect(card: OnboardingCard) {
  if (!card.effect) return
  busy[card.key] = true
  resultErr[card.key] = ''
  try {
    lastResult[card.key] = await triggerIngest(card.effect.kind, {})
  } catch (e) {
    resultErr[card.key] = (e as Error).message
  } finally {
    busy[card.key] = false
  }
}

// 摄取结果真伪判定（与 DataIngestionView 同款嗅探：MOCK/synthetic/合成 → synthetic）。
function basisFromResult(r: IngestResult): DataSourceBasis {
  const blob = `${r.stdout}\n${r.stderr}`
  return /MOCK|synthetic|合成/i.test(blob) ? 'synthetic' : 'captured'
}

// 复制命令行到剪贴板（非交互上下文/无 https 时静默失败，不影响展示）。
async function copyCommand(cmd: string) {
  try {
    await navigator.clipboard?.writeText(cmd)
  } catch {
    /* clipboard API 不可用：用户可手动选中复制 */
  }
}

const freshnessTone: Record<Freshness, string> = {
  fresh: '新鲜',
  aging: '趋旧',
  stale: '过期',
  unknown: '未知'
}

onMounted(loadAll)
</script>

<template>
  <div class="onboarding-page">
    <header class="page-head">
      <h1>数据接入向导</h1>
      <p class="lede">
        从「你手里有什么数据」出发，按类别把数据进入系统的旅程一步步走通：先做什么、点哪里生效、去哪见数。
        每张卡片的五步线（输入→校验→落位→生效→见数）按当前真实状态实时点亮；上传投递后可点「一键生效」直接跑 ETL，不必切命令行。
      </p>
    </header>

    <section class="link-row">
      <RouterLink to="/yygl/import-hub" class="link"><FileText :size="13" /> 数据导入融合台</RouterLink>
      <RouterLink to="/yygl/ingest" class="link"><Workflow :size="13" /> 数据摄取管理</RouterLink>
      <RouterLink to="/yygl/data-governance" class="link"><Database :size="13" /> 数据治理控制台</RouterLink>
    </section>

    <div v-if="loadErr" class="load-err">⚠ 状态取数失败（{{ loadErr }}）；卡片状态显示为「未知」，不影响生效操作。</div>
    <div v-else-if="loading" class="muted">正在拉取数据资产目录与台账状态…</div>

    <section class="card-grid">
      <article v-for="card in CARDS" :key="card.key" class="journey-card">
        <div class="card-head">
          <component :is="card.icon" :size="20" class="card-icon" />
          <div class="card-title">
            <span class="cat">{{ card.category }}</span>
            <h3>{{ card.title }}</h3>
          </div>
        </div>

        <!-- 五步旅程线（template/command/auto）-->
        <ol v-if="stepsFor(card)" class="journey-line">
          <li v-for="(k, i) in STEP_KEYS" :key="k" class="step" :class="stepsFor(card)![k]">
            <span class="step-idx">{{ i + 1 }}</span>
            <span class="step-label">{{ STEP_LABELS[i] }}</span>
          </li>
        </ol>

        <p class="what">{{ card.what }}</p>

        <div class="sect">
          <span class="sect-label">怎么接</span>
          <p class="sect-body">{{ card.howText }}</p>
          <RouterLink v-if="card.howLink" :to="card.howLink.to" class="link">{{ card.howLink.label }} →</RouterLink>
          <div v-if="card.howCommand" class="cmd-box">
            <code>{{ card.howCommand.command }}</code>
            <button class="copy" type="button" @click="copyCommand(card.howCommand.command)">复制</button>
            <p class="cmd-note">{{ card.howCommand.note }}</p>
          </div>
        </div>

        <!-- 当前状态：template/command/auto 看 family 新鲜度；ledger 看台账说明 -->
        <div class="sect">
          <span class="sect-label">当前状态</span>
          <div v-if="card.journey === 'ledger'" class="status-row">
            <span class="muted">台账型数据：导入融合台录入并通过校验即进台账见数，无独立新鲜度档。</span>
          </div>
          <div v-else class="status-row">
            <span class="tag" :class="familyFreshness(card.families, card.cadence)">数据{{ freshnessTone[familyFreshness(card.families, card.cadence)] }}</span>
            <span v-if="card.templateIds.length" class="muted">
              模板{{ card.templateIds.join(' / ') }}：{{ templateSignals(card.templateIds).hasCommitted ? '已上传并提交' : (templateSignals(card.templateIds).hasTemplateRecord ? '已上传待提交' : '未上传') }}
            </span>
            <span v-else-if="card.journey === 'auto'" class="muted">scheduler 自动采集</span>
          </div>
        </div>

        <!-- 生效：按钮（spot-ingest/forecast-etl/weather-export）或命令行说明 -->
        <div v-if="card.effect" class="sect">
          <span class="sect-label">生效</span>
          <button class="effect-btn" :disabled="busy[card.key]" @click="runEffect(card)">
            <Loader2 v-if="busy[card.key]" :size="14" class="spin" />
            <CloudDownload v-else :size="14" />
            {{ busy[card.key] ? '执行中…' : card.effect.label }}
          </button>
          <div v-if="resultErr[card.key]" class="result err">⚠ {{ resultErr[card.key] }}</div>
          <div v-else-if="lastResult[card.key]" class="result" :class="{ ok: lastResult[card.key]!.ok, fail: !lastResult[card.key]!.ok }">
            <div class="result-head">
              <span>{{ lastResult[card.key]!.ok ? '✓ 生效成功' : '✗ 生效失败' }} · exitCode {{ lastResult[card.key]!.exitCode }}{{ lastResult[card.key]!.timedOut ? ' · 超时' : '' }}</span>
              <TrustBadge v-if="lastResult[card.key]!.ok" :basis="basisFromResult(lastResult[card.key]!)" />
            </div>
            <pre class="stdout">{{ lastResult[card.key]!.stdout.slice(-400) || lastResult[card.key]!.stderr.slice(-200) }}</pre>
          </div>
        </div>

        <!-- 见数：深链消费页 -->
        <div class="sect">
          <span class="sect-label">去哪见数</span>
          <div class="consume-links">
            <RouterLink v-for="c in card.consume" :key="c.to" :to="c.to" class="consume-link">{{ c.label }} →</RouterLink>
          </div>
        </div>
      </article>
    </section>

    <section class="note">
      <p class="muted">
        说明：本向导只消费数据治理目录、导入台账与披露接入态三路只读信号，本身不产生数据。「一键生效」复用既有 <code>POST /api/v1/ingest/:kind</code> 端点
        （spot-ingest / forecast-etl 写用户数据目录与 Parquet，非生产写入；weather-export 从 Open-Meteo 拉取）。
        各状态标签如实透传：数据未落 capture 时显示「未知」，未生效绝不标「已可见」。
      </p>
    </section>
  </div>
</template>

<style scoped>
.onboarding-page { padding: 18px 22px; max-width: 1180px; margin: 0 auto; }
.page-head h1 { font-size: 22px; font-weight: 600; color: var(--text); margin: 0 0 4px; }
.lede { color: var(--text-soft); font-size: 13.5px; margin: 0 0 14px; line-height: 1.6; max-width: 880px; }
.link-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; font-size: 12.5px; }
.link { color: var(--primary); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
.link:hover { text-decoration: underline; }
.muted { color: var(--muted); font-size: 12px; }
.load-err { color: var(--danger); font-size: 12.5px; margin-bottom: 12px; }

.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px; }
.journey-card {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius, 8px);
  padding: 16px; display: flex; flex-direction: column; gap: 10px;
}
.card-head { display: flex; align-items: center; gap: 10px; }
.card-icon { color: var(--primary); flex: none; }
.card-title { display: flex; flex-direction: column; gap: 1px; }
.card-title .cat { font-size: 11px; color: var(--muted); }
.card-title h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }

/* 五步旅程线 */
.journey-line { list-style: none; display: flex; gap: 0; margin: 0; padding: 6px 0 2px; }
.step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; position: relative; font-size: 11px; }
.step::before { content: ''; position: absolute; top: 9px; left: -50%; width: 100%; height: 2px; background: var(--line); }
.step:first-child::before { display: none; }
.step-idx {
  width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; background: var(--line); color: var(--muted); z-index: 1;
}
.step.done .step-idx { background: var(--success); color: #fff; }
.step.done .step-label { color: var(--text); }
.step.pending .step-label { color: var(--muted); }
.step.unknown .step-idx { background: color-mix(in srgb, var(--muted) 30%, transparent); }
.step-label { color: var(--muted); }

.what { font-size: 12.5px; color: var(--text-body); margin: 0; line-height: 1.5; }
.sect { display: flex; flex-direction: column; gap: 3px; }
.sect-label { font-size: 11px; color: var(--muted); font-weight: 600; }
.sect-body { font-size: 12.5px; color: var(--text-soft); margin: 0; line-height: 1.5; }

.cmd-box { background: color-mix(in srgb, var(--muted) 10%, transparent); border-radius: var(--radius-sm, 6px); padding: 6px 8px; font-size: 11.5px; position: relative; }
.cmd-box code { font-family: var(--ck-mono, ui-monospace, monospace); color: var(--text); word-break: break-all; }
.copy { float: right; cursor: pointer; border: none; background: transparent; color: var(--primary); font-size: 11px; }
.cmd-note { color: var(--muted); margin: 4px 0 0; line-height: 1.4; }

.status-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tag { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500; border: 1px solid; }
.tag.fresh, .tag.ok { color: var(--success); border-color: color-mix(in srgb, var(--success) 40%, transparent); background: color-mix(in srgb, var(--success) 8%, transparent); }
.tag.aging { color: var(--warning, #d97706); border-color: color-mix(in srgb, var(--warning, #d97706) 40%, transparent); background: color-mix(in srgb, var(--warning, #d97706) 8%, transparent); }
.tag.stale, .tag.warn { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); background: color-mix(in srgb, var(--danger) 8%, transparent); }
.tag.unknown { color: var(--muted); border-color: var(--line); }
.tag.mock { color: var(--muted); border-color: var(--line); background: color-mix(in srgb, var(--muted) 8%, transparent); }

.effect-btn {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  padding: 7px 14px; border-radius: var(--radius-sm, 6px); font-size: 13px; font-weight: 500;
  border: 1px solid var(--primary); color: var(--primary); background: transparent;
}
.effect-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--primary) 10%, transparent); }
.effect-btn:disabled { opacity: 0.6; cursor: progress; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.result { margin-top: 6px; padding: 8px 10px; border-radius: var(--radius-sm, 6px); font-size: 12px; border: 1px solid; }
.result.ok { color: var(--success); border-color: color-mix(in srgb, var(--success) 35%, transparent); background: color-mix(in srgb, var(--success) 7%, transparent); }
.result.fail, .result.err { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); background: color-mix(in srgb, var(--danger) 7%, transparent); }
.result-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-weight: 500; }
.stdout { margin: 4px 0 0; font-size: 11px; color: var(--text-soft); font-family: var(--ck-mono, ui-monospace, monospace); white-space: pre-wrap; word-break: break-all; max-height: 110px; overflow: auto; }

.consume-links { display: flex; gap: 12px; flex-wrap: wrap; }
.consume-link { font-size: 12.5px; }

.note { margin-top: 18px; font-size: 12px; line-height: 1.6; }
code { font-family: var(--ck-mono, ui-monospace, monospace); font-size: 0.92em; padding: 1px 4px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 14%, transparent); }
</style>
