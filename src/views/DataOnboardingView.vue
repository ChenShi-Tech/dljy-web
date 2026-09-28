<script setup lang="ts">
// 数据接入向导（数据运维工作台 /data-ops/console?panel=onboarding；#885 建，#2215 对齐真实通道）：
// 按「用户手里有什么数据」组织的旅程总览 + UI 内一键生效闭环。数据进入线现有五条：
// 中广核厂侧 API 全自动 / 台账与模板手录 / 命令行 ETL / 定时 scheduler / 上传中心，
// 收成一张「先做什么、再做什么、点哪里生效、去哪见数」的地图。
//
// 旅程卡片（按数据类别组织，非按技术通道）：
//   ⓪ 中广核云南厂侧 API 全自动（调度每日自动拉电价/市场曲线/披露→私有 PG→驾驶舱见数）
//   ① 现货节点电价 T0（手录兜底：模板→投递→点 spot-ingest 生效→预测页见数）
//   ② 系统负荷/水电 T0/T1（手录：模板→投递→点 forecast-etl 生效→预测页见数）
//   ③ 交易中心月度导出包（离线包→命令行 import:spot-export，如实说明须服务器执行）
//   ④ 气象全自动（scheduler 06:30 自动采→手动补采→天气/发电预测见数）
//   ⑤ 结算/零售/交易记录（import-hub 台账录入即见数）
// 上传中心（?panel=upload 五步流，Epic #2169 P1）承接结构化 Excel 批量入库。
//
// 版式（dljy#3385）：卡片首屏只留「状态标签 + 五步线 + 操作按钮 + 去哪见数」；是什么、怎么接、
// 状态口径收进卡片右上角 ⓘ 说明，页级口径收进工具栏「说明」。与工作台 tab 重复的面板跳转行已去掉。
//
// 诚实红线：状态标签如实透传（freshness/台账/接入态），取数失败显示「未知」不猜；
// 未生效数据绝不显示「已可见」；生效按钮结果如实回显（成功/失败 + stdout 摘要）。
// 向导本身不产数据，它只消费 governance catalog / import-templates records /
// 只读信号汇总，并复用既有 ingest 端点触发 ETL。
import { onMounted, reactive, ref } from 'vue'
import type { Component } from 'vue'
import { RouterLink } from 'vue-router'
import { CloudDownload, CloudSun, Coins, Copy, Loader2, Network, Sunset, Zap } from 'lucide-vue-next'
import { apiGet } from '@/services/api'
import { freshnessOf, type Freshness } from '@/services/data/freshness'
import { triggerIngest, type IngestKind, type IngestResult } from '@/services/data/ingestClient'
import { deriveJourneySteps, type JourneySteps } from './data-onboarding/onboardingJourney'
import InfoPop from './dataops/InfoPop.vue'
import IngestResultBox from './dataops/IngestResultBox.vue'

// 数据源信封类型（与后端 governance/import-hub 接口对齐）。两个接口都是标准信封 {code, msg, data}，
// 内容在 data 里（与 OpsOverviewPanel 同口径）；曾误读顶层 items/rows，导致卡片状态恒为「未知 / 未上传」（dljy#3385）。
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

// 卡片配置
type JourneyKind = 'template' | 'command' | 'auto' | 'ledger'
type EffectAction = { kind: IngestKind; label: string }
// 站内跳转统一 RouterLink：六页回到主平台后与消费页同属一个 SPA，不再需要整页刷新的 <a>。
type NavLink = { to: string; label: string }

interface OnboardingCard {
  key: string
  category: string
  title: string
  icon: Component
  // 以下三项进卡片 ⓘ 说明
  what: string
  howText: string
  statusNote?: string
  // 自动通道的调度时刻（首屏状态行常显）
  schedule?: string
  // 首屏操作：去哪接（跳转按钮）/ 命令行（常显，note 进说明）/ 一键生效
  actions: NavLink[]
  howCommand?: { command: string; note: string }
  effect?: EffectAction
  families: string[]
  templateIds: string[]
  consume: NavLink[]
  cadence: 'daily' | 'monthly'
  journey: JourneyKind
}

// 深链 path 全部核对真实路由（router/index.ts + features/*/routes.ts）。
const CARDS: OnboardingCard[] = [
  {
    // #2215：云南现货数据的主力通道（#2185/#2203 起每日自动）。向导此前只讲手录
    // 那是无 API 通道时代的叙事，必须让自动通道排第一。私有库不在治理 catalog
    // （governance 只覆盖 capture 族），不接 family 新鲜度，也不画五步线（画了只会永远半亮）。
    key: 'cgn-auto',
    category: '全自动 · 云南现货主力通道',
    title: '中广核云南厂侧 API（电价 / 市场曲线 / 披露）',
    icon: Network,
    what: '中广核云南专属厂侧数据 API（数据提供方部署，非电网官方接口）每日自动拉取：全网/场站节点电价（00:20，3 日回看）与 11 条市场曲线 + 26 类公共披露（00:50），写入中广核私有 PostgreSQL。日前价上游 D+1~D+2 发布，回看窗口自动补齐。',
    howText: '数据源接入页保存直连端点与 API Key、联通测试通过且三重启用后，调度任务全自动拉取；手动补拉入口在数据摄取管理页。',
    statusNote: '私有库不在数据治理目录内，本卡不显示新鲜度；新鲜度看交易驾驶舱 / 实时监盘与数据源接入页。',
    schedule: '每日 00:20 拉电价 · 00:50 拉市场曲线与披露',
    actions: [
      { to: '/data-ops/console?panel=data-source', label: '数据源接入' },
      { to: '/data-ops/console?panel=ingest', label: '手动补拉' }
    ],
    families: [],
    templateIds: [],
    consume: [
      { to: '/dashboard', label: '交易驾驶舱' },
      { to: '/xhjy/monitor', label: '实时监盘' }
    ],
    cadence: 'daily',
    journey: 'auto'
  },
  {
    key: 'node-price',
    category: 'T0 · 交易中心口径',
    title: '现货节点电价',
    icon: Network,
    what: '交易中心发布的日前节点电价（DLR），按节点×时段，是价格预测与申报决策的核心输入。',
    howText: '中广核云南集团：节点电价已由厂侧 API 每日自动入库（见首张全自动卡），本卡手录通道仅在无 API 接入时使用——下载 yn-t0-node-price 模板填报上传，校验通过即投递到清单协议目录，再点「一键生效」。',
    actions: [{ to: '/data-ops/console?panel=import-hub', label: '上传模板' }],
    families: ['yn_node_price', 'yn_plant_nodal_price'],
    templateIds: ['yn-t0-node-price'],
    effect: { kind: 'spot-ingest', label: '一键生效' },
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
    howText: '云南负荷/新能源/总出力等市场曲线已随厂侧 API 自动进入中广核私有库（见首张全自动卡）；本卡用于公共清单协议族（yn_system_supply）——下载 yn-t0-system-load（统调负荷）/ yn-t1-hydro（水电出力）模板填报上传，投递到清单协议目录，再点「一键生效」跑预测 ETL。',
    actions: [{ to: '/data-ops/console?panel=import-hub', label: '上传模板' }],
    families: ['yn_system_supply'],
    templateIds: ['yn-t0-system-load', 'yn-t1-hydro'],
    effect: { kind: 'forecast-etl', label: '一键生效' },
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
    actions: [],
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
    statusNote: '输入、校验、落位由定时任务自动完成，五步线前三步常亮；生效与见数看数据新鲜度。',
    schedule: '每日 06:30 定时采集',
    actions: [{ to: '/system/ai-studio?tab=schedules', label: '定时任务' }],
    families: ['yn_meteo', 'yn_irradiance'],
    templateIds: [],
    effect: { kind: 'weather-export', label: '手动补采' },
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
    statusNote: '台账型数据：导入融合台录入并通过校验即进台账见数，无独立新鲜度档，也不走五步线。',
    actions: [{ to: '/data-ops/console?panel=import-hub', label: '去导入融合台录入' }],
    families: [],
    templateIds: [],
    consume: [
      { to: '/data-ops/console?panel=import-hub', label: '导入台账与历史' },
      { to: '/gsgl/trades', label: '历史交易' }
    ],
    cadence: 'daily',
    journey: 'ledger'
  }
]

// 状态：三路只读信号
// recordsByTemplate：templateId → 台账行；null = 该模板本轮取数失败，缺键 = 尚未取到。两者都按「未知」展示。
const catalog = ref<CatalogPayload | null>(null)
const recordsByTemplate = ref<Record<string, TemplateRecord[] | null>>({})
const loadErr = ref('')
const loading = ref(false)
// 加载代次：刷新按钮与「生效后重读」可能并发，只认最后一次发起的结果，旧请求晚到不得覆盖。
let loadGen = 0

// 生效按钮：每卡独立 busy / 结果 / 错误（key → ...）
const busy = reactive<Record<string, boolean>>({})
const lastResult = reactive<Record<string, IngestResult | null>>({})
const resultErr = reactive<Record<string, string>>({})
const copied = ref('')

async function loadAll() {
  const gen = ++loadGen
  loading.value = true
  loadErr.value = ''
  try {
    const nextCatalog = (await apiGet<CatalogPayload>('/api/v1/governance/catalog')).data ?? null
    // 拉取所有关联模板的台账记录（import-templates/records 按 templateId 过滤）。
    const templateIds = Array.from(new Set(CARDS.flatMap((c) => c.templateIds)))
    const nextRecords: Record<string, TemplateRecord[] | null> = {}
    await Promise.all(
      templateIds.map(async (tid) => {
        try {
          const res = await apiGet<RecordsPayload>('/api/v1/import-templates/records', { templateId: tid })
          // 信封里没有 rows 数组（形状不符）同样按「未知」处理，不当成「未上传」。
          nextRecords[tid] = Array.isArray(res.data?.rows) ? res.data.rows : null
        } catch {
          // 单个台账取数失败不阻塞整页；该模板状态落「未知」（不能当成「未上传」）。
          nextRecords[tid] = null
        }
      })
    )
    if (gen !== loadGen) return
    catalog.value = nextCatalog
    recordsByTemplate.value = nextRecords
  } catch (e) {
    if (gen !== loadGen) return
    // 本轮失败即作废上一轮快照：不能一边报「状态显示为未知」，一边继续显示上次的「数据新鲜 / 已提交」。
    catalog.value = null
    recordsByTemplate.value = {}
    loadErr.value = (e as Error).message
  } finally {
    if (gen === loadGen) loading.value = false
  }
}

// 状态推导（纯函数消费）
// family → 最新数据时间：catalog.items 里该组 family 最晚的 dataTime（ISO 字符串升序 = 时间升序）。
function familyLatest(families: string[]): string | null {
  const items = catalog.value?.items
  if (!Array.isArray(items) || !families.length) return null
  const times = items
    .filter((it) => families.includes(it.family))
    .map((it) => it.dataTime)
    .filter((t): t is string => Boolean(t))
  return times.length ? times.sort().slice(-1)[0] : null
}

// family → 最新新鲜度：按节律折算最新数据时间。
function familyFreshness(families: string[], cadence: 'daily' | 'monthly'): Freshness {
  const latest = familyLatest(families)
  return latest ? freshnessOf(latest, { cadence }) : 'unknown'
}

// 模板台账信号。任一模板没取到（失败或尚未加载）→ known=false：五步线按未达成处理，进度文案写「状态未知」。
function templateSignals(templateIds: string[]) {
  const lists = templateIds.map((tid) => recordsByTemplate.value[tid])
  const known = lists.every(Array.isArray)
  const rows = lists.flatMap((l) => l ?? [])
  return {
    known,
    hasTemplateRecord: rows.length > 0,
    hasCommitted: rows.some((r) => r.status === 'COMMITTED'),
    hasDelivered: rows.some((r) => Array.isArray(r.deliveredPaths) && r.deliveredPaths.length > 0)
  }
}

// 卡片五步旅程状态。台账型不走五步线；没有可观测 family 的自动通道（中广核私有库）
// 生效/见数永远判不出，画出来只会常年半亮、误导成「未生效」，同样不画。
function stepsFor(card: OnboardingCard): JourneySteps | null {
  if (card.journey === 'ledger') return null
  if (card.journey === 'auto' && !card.families.length) return null
  const fresh = familyFreshness(card.families, card.cadence)
  // 台账没取全时整段按未达成处理（onboardingJourney 的「取数失败不猜」口径），不拿半截信号点亮。
  const s = templateSignals(card.templateIds)
  const steps = deriveJourneySteps({
    hasTemplateRecord: s.known && s.hasTemplateRecord,
    hasCommitted: s.known && s.hasCommitted,
    hasDelivered: s.known && s.hasDelivered,
    freshness: fresh
  })
  // 气象全自动：输入/校验/落位由 scheduler 自动完成，强制点亮；effect/consume 看 freshness。
  if (card.journey === 'auto') {
    return { ...steps, input: 'done', validate: 'done', deliver: 'done' }
  }
  return steps
}

// 卡片右上角的状态标签：有 family 看新鲜度，否则按通道类型给一个如实的类别标签。
function statusTag(card: OnboardingCard): { text: string; tone: string } {
  if (card.journey === 'ledger') return { text: '台账型', tone: 'unknown' }
  if (!card.families.length) return { text: '每日自动', tone: 'unknown' }
  const fresh = familyFreshness(card.families, card.cadence)
  return { text: `数据${freshnessTone[fresh]}`, tone: fresh }
}

// 卡片内的一行补充状态：调度时刻 + 最新数据时间 + 模板上传进度（没有可说的就不显示）。
function statusLine(card: OnboardingCard): string {
  const parts: string[] = card.schedule ? [card.schedule] : []
  const latest = familyLatest(card.families)
  if (latest) parts.push(`最新数据 ${formatDate(latest)}`)
  if (card.templateIds.length) {
    const s = templateSignals(card.templateIds)
    const state = !s.known ? '状态未知' : s.hasCommitted ? '已上传并提交' : s.hasTemplateRecord ? '已上传待提交' : '未上传'
    parts.push(`模板 ${card.templateIds.join(' / ')}：${state}`)
  }
  return parts.join(' · ')
}

function formatDate(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('zh-CN')
}

const STEP_LABELS = ['输入', '校验', '落位', '生效', '见数'] as const
const STEP_KEYS: (keyof JourneySteps)[] = ['input', 'validate', 'deliver', 'effect', 'consume']

// 生效按钮：复用既有 ingest 端点（spot-ingest/forecast-etl/weather-export）；
// 成功后重读目录与台账，让五步线与新鲜度标签跟上刚跑完的 ETL。
async function runEffect(card: OnboardingCard) {
  if (!card.effect) return
  busy[card.key] = true
  resultErr[card.key] = ''
  try {
    const result = await triggerIngest(card.effect.kind, {})
    lastResult[card.key] = result
    if (result.ok) void loadAll()
  } catch (e) {
    resultErr[card.key] = (e as Error).message
  } finally {
    busy[card.key] = false
  }
}

// 复制命令行到剪贴板（非交互上下文/无 https 时静默失败，不影响展示）。
async function copyCommand(card: OnboardingCard) {
  if (!card.howCommand) return
  try {
    await navigator.clipboard?.writeText(card.howCommand.command)
    copied.value = card.key
    setTimeout(() => {
      if (copied.value === card.key) copied.value = ''
    }, 1500)
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
    <section class="toolbar">
      <div class="toolbar-status">
        <span v-if="loadErr" class="load-err">⚠ 状态取数失败（{{ loadErr }}），卡片状态显示为「未知」，不影响操作</span>
        <span v-else-if="loading" class="muted">正在读取数据目录与台账状态…</span>
        <span v-else class="legend muted">
          <i class="legend-dot done" />已完成
          <i class="legend-dot" />未达成
          <span class="legend-steps">输入 → 校验 → 落位 → 生效 → 见数</span>
        </span>
      </div>
      <div class="toolbar-actions">
        <el-button size="small" :loading="loading" @click="loadAll">刷新状态</el-button>
        <InfoPop title="数据接入向导" label="说明" :width="400">
          <ul>
            <li>按「手里有什么数据」分类，每张卡片回答：怎么接、点哪里生效、去哪见数。</li>
            <li>云南现货主力数据由中广核厂侧 API 每日自动入库（首张卡）；手录模板、月度导出包、台账等通道按需使用。</li>
            <li>五步线与新鲜度按数据目录、导入台账的真实状态点亮：取数失败显示「未知」，未生效绝不标已可见。</li>
            <li>「一键生效」复用 <code>POST /api/v1/ingest/:kind</code>：spot-ingest / forecast-etl 写用户数据目录与 Parquet（非生产写入），weather-export 从 Open-Meteo 拉取。中广核厂侧 API 的手动补拉在「数据摄取管理」。</li>
            <li>向导只读数据治理目录与导入台账，本身不产生数据。</li>
          </ul>
        </InfoPop>
      </div>
    </section>

    <section class="card-grid">
      <article v-for="card in CARDS" :key="card.key" class="journey-card" :data-card="card.key">
        <header class="card-head">
          <component :is="card.icon" :size="20" class="card-icon" />
          <div class="card-title">
            <span class="cat">{{ card.category }}</span>
            <h3>{{ card.title }}</h3>
          </div>
          <span class="tag" :class="statusTag(card).tone">{{ statusTag(card).text }}</span>
          <InfoPop :title="card.title">
            <p><b>是什么</b>：{{ card.what }}</p>
            <p><b>怎么接</b>：{{ card.howText }}</p>
            <p v-if="card.howCommand"><b>命令说明</b>：{{ card.howCommand.note }}</p>
            <p v-if="card.statusNote"><b>状态口径</b>：{{ card.statusNote }}</p>
          </InfoPop>
        </header>

        <!-- 五步旅程线（template/command/气象 auto）-->
        <ol v-if="stepsFor(card)" class="journey-line">
          <li v-for="(k, i) in STEP_KEYS" :key="k" class="step" :class="stepsFor(card)![k]">
            <span class="step-idx">{{ i + 1 }}</span>
            <span class="step-label">{{ STEP_LABELS[i] }}</span>
          </li>
        </ol>

        <p v-if="statusLine(card)" class="status-line">{{ statusLine(card) }}</p>

        <div v-if="card.howCommand" class="cmd-box">
          <code>{{ card.howCommand.command }}</code>
          <button class="copy" type="button" @click="copyCommand(card)">
            <Copy :size="12" /> {{ copied === card.key ? '已复制' : '复制' }}
          </button>
        </div>

        <footer class="card-foot">
          <div v-if="card.actions.length || card.effect" class="card-actions">
            <RouterLink v-for="a in card.actions" :key="a.to" :to="a.to" class="action-link">{{ a.label }} →</RouterLink>
            <button v-if="card.effect" class="effect-btn" type="button" :disabled="busy[card.key]" @click="runEffect(card)">
              <Loader2 v-if="busy[card.key]" :size="14" class="spin" />
              <CloudDownload v-else :size="14" />
              {{ busy[card.key] ? '执行中…' : card.effect.label }}
            </button>
          </div>
          <IngestResultBox
            v-if="resultErr[card.key] || lastResult[card.key]"
            :result="lastResult[card.key]"
            :error="resultErr[card.key]"
            verb="生效"
          />
          <div class="consume">
            <span class="consume-label">见数</span>
            <RouterLink v-for="c in card.consume" :key="c.to" :to="c.to" class="consume-link">{{ c.label }}</RouterLink>
          </div>
        </footer>
      </article>
    </section>
  </div>
</template>

<style scoped>
.onboarding-page { max-width: 1180px; display: flex; flex-direction: column; gap: 14px; }
.muted { color: var(--muted); font-size: var(--font-sm); }
.load-err { color: var(--danger); font-size: var(--font-sm); }

.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.toolbar-actions { display: flex; align-items: center; gap: 10px; }
.legend { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.legend-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--line); display: inline-block; margin-left: 4px; }
.legend-dot:first-child { margin-left: 0; }
.legend-dot.done { background: var(--success); }
.legend-steps { margin-left: 10px; }

.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 14px; }
.journey-card {
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius, 8px);
  padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;
}
.card-head { display: flex; align-items: flex-start; gap: 10px; }
.card-icon { color: var(--primary); flex: none; margin-top: 6px; }
.card-title { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.card-title .cat { font-size: var(--font-xs); color: var(--muted); }
.card-title h3 { margin: 0; font-size: var(--font-15); font-weight: 600; color: var(--text); line-height: 1.4; }

/* 五步旅程线 */
.journey-line { list-style: none; display: flex; gap: 0; margin: 0; padding: 2px 0; }
.step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; position: relative; font-size: var(--font-xs); }
.step::before { content: ''; position: absolute; top: 9px; left: -50%; width: 100%; height: 2px; background: var(--line); }
.step:first-child::before { display: none; }
.step-idx {
  width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-size: var(--font-xs); font-weight: 600; background: var(--line); color: var(--muted); z-index: 1;
}
.step.done .step-idx { background: var(--success); color: #fff; }
.step.done .step-label { color: var(--text); }
.step.pending .step-label { color: var(--muted); }
.step.unknown .step-idx { background: color-mix(in srgb, var(--muted) 30%, transparent); }
.step-label { color: var(--muted); }

.status-line { margin: 0; font-size: var(--font-sm); color: var(--text-soft); }

.tag { flex: none; font-size: var(--font-xs); padding: 2px 8px; border-radius: 10px; font-weight: 500; border: 1px solid; white-space: nowrap; margin-top: 2px; }
.tag.fresh { color: var(--success); border-color: color-mix(in srgb, var(--success) 40%, transparent); background: color-mix(in srgb, var(--success) 8%, transparent); }
.tag.aging { color: var(--warning, #d97706); border-color: color-mix(in srgb, var(--warning, #d97706) 40%, transparent); background: color-mix(in srgb, var(--warning, #d97706) 8%, transparent); }
.tag.stale { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); background: color-mix(in srgb, var(--danger) 8%, transparent); }
.tag.unknown { color: var(--muted); border-color: var(--line); }

.cmd-box {
  display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm, 6px);
  background: color-mix(in srgb, var(--muted) 10%, transparent); font-size: var(--font-11-5);
}
.cmd-box code { flex: 1; font-family: var(--ck-mono, ui-monospace, monospace); color: var(--text); overflow-wrap: anywhere; }
.copy {
  flex: none; display: inline-flex; align-items: center; gap: 3px; cursor: pointer; border: none;
  background: transparent; color: var(--primary); font-size: var(--font-xs); padding: 0;
}

/* 操作与见数压在卡片底部：同一行卡片高度不一时按钮也对齐。 */
.card-foot { margin-top: auto; display: flex; flex-direction: column; gap: 10px; }
.card-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.action-link, .effect-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--radius-sm, 6px);
  font-size: var(--font-md); font-weight: 500; text-decoration: none; white-space: nowrap;
  border: 1px solid var(--primary); transition: background 0.15s;
}
/* 跳转用浅底主色、生效用描边：不用实心主色白字——arc/flow 主题的青色主色上白字对比度不够。 */
.action-link { color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); border-color: color-mix(in srgb, var(--primary) 40%, transparent); }
.action-link:hover { background: color-mix(in srgb, var(--primary) 20%, transparent); }
.effect-btn { cursor: pointer; color: var(--primary); background: transparent; }
.effect-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--primary) 10%, transparent); }
.effect-btn:disabled { opacity: 0.6; cursor: progress; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.consume {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding-top: 8px;
  border-top: 1px dashed var(--line); font-size: var(--font-12-5);
}
.consume-label { color: var(--muted); font-size: var(--font-xs); font-weight: 600; }
.consume-link { color: var(--primary); text-decoration: none; }
.consume-link:hover { text-decoration: underline; }
</style>
