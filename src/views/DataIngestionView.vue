<script setup lang="ts">
// 数据摄取管理页（数据运维工作台 /data-ops/console?panel=ingest）：手动触发摄取（POST /v1/ingest/:kind，
// 经 dataServicePath 改走 /data-svc → data-service :8190，dljy#3251）。
// 链路：本页（手动/自动摄取）→ /yygl/data-browser（回放）。原「手录 CSV → 本页摄取」的市场分析族
// 入口随市场经营分析页下线删除（ChenShi-Tech/dljy#3391）。
// 定时自动摄取在「AI 工作室 → 定时任务」（/system/ai-studio?tab=schedules）。
//
// 版式（dljy#3385）：首屏只留「摄什么 + 关键参数 + 立即摄取」一行一个入口；写入去向、参数口径、
// 兜底行为收进每行的 ⓘ 说明和工具栏的「说明」弹层。会改变结果的提醒（中广核专属）
// 仍以标签常显，不藏进弹层。
import { reactive } from 'vue'
import type { Component } from 'vue'
import { RouterLink } from 'vue-router'
import { CloudDownload, CloudSun, Database, Loader2, Network, Workflow } from 'lucide-vue-next'
import { triggerIngest, type IngestKind, type IngestResult } from '@/services/data/ingestClient'
import InfoPop from './dataops/InfoPop.vue'
import IngestResultBox from './dataops/IngestResultBox.vue'

interface Chip {
  text: string
  tone?: 'warn'
}

interface KindMeta {
  kind: IngestKind
  label: string
  summary: string
  icon: Component
  // 首屏常显的参数/提醒标签
  chips: Chip[]
  // 以下进 ⓘ 说明
  target: string
  notes: string[]
  // 手动触发实际携带的参数（缺省 {} 保持既有 kind 行为）。中广核两个 kind 显式带
  // 回看窗口，上游日前价 D+1~D+2 才发布，单拉「今天」会 404（#2203）。
  params?: Record<string, unknown>
}

interface KindGroup {
  key: string
  title: string
  note: string
  kinds: KindMeta[]
}

// 中广核厂侧 API 是云南现货主力通道，排在前面。
const GROUPS: KindGroup[] = [
  {
    key: 'cgn',
    title: '中广核云南厂侧 API',
    note: '中广核专属 · 写中广核私有库',
    kinds: [
      {
        kind: 'cgn-yunnan-prices',
        label: '中广核云南电价',
        summary: '全网 / 场站节点电价',
        icon: Network,
        chips: [{ text: '回看 3 天' }, { text: '日前' }, { text: '15 分钟' }],
        target: '中广核私有 PostgreSQL（dljy_private）',
        notes: [
          '参数：lookbackDays=3、market=day_ahead、interval=15m。',
          '日前价上游 D+1~D+2 发布，回看窗口内未发布的分区自动跳过。',
          '数据来自中广核厂侧外部 API（数据提供方部署，非电网官方接口）。'
        ],
        params: { lookbackDays: 3, market: 'day_ahead', interval: '15m' }
      },
      {
        kind: 'cgn-yunnan-market',
        label: '中广核云南市场 / 披露',
        summary: '11 条市场曲线 + 26 类公共披露',
        icon: Network,
        chips: [{ text: '回看 3 天' }, { text: '全部资源' }],
        target: '中广核私有 PostgreSQL（dljy_private）',
        notes: [
          '参数：resource=all、lookbackDays=3。',
          '数据来自中广核厂侧外部 API（数据提供方部署，非电网官方接口）。'
        ],
        params: { resource: 'all', lookbackDays: 3 }
      }
    ]
  },
  {
    key: 'public',
    title: '公共数据',
    note: '写各自事实层与 capture 回放层',
    kinds: [
      {
        kind: 'weather-export',
        label: '云南气象',
        summary: 'Open-Meteo 气象要素 + 辐照',
        icon: CloudSun,
        chips: [],
        target: 'yn_meteo / yn_irradiance',
        notes: [
          '无额外参数，自动从 Open-Meteo 拉取真实气象。',
          'Open-Meteo 失败或超时会走合成兜底：结果标「合成兜底」，口径降为仅供决策支持。'
        ]
      },
      {
        kind: 'spot-export',
        label: '云南现货月度导出包',
        summary: '交易中心厂站结算 / 损益 / 主数据',
        icon: Database,
        chips: [{ text: '取最新解压目录' }],
        target: 'yn_node_price 等结算与维度族',
        notes: [
          '自动选用 plant-exports 下最新的解压目录（须含 export_manifest.csv），没有目录时如实报错。',
          '要指定目录，须在服务器命令行执行。'
        ]
      }
    ]
  }
]

// 按 kind 记每个入口的执行态与最近一次结果（未列出的 kind 不渲染、不触发）。
const busy = reactive<Partial<Record<IngestKind, boolean>>>({})
const last = reactive<Partial<Record<IngestKind, IngestResult | null>>>({})
const errMsg = reactive<Partial<Record<IngestKind, string>>>({})

async function run(meta: KindMeta) {
  busy[meta.kind] = true
  errMsg[meta.kind] = ''
  try {
    last[meta.kind] = await triggerIngest(meta.kind, meta.params ?? {})
  } catch (e) {
    errMsg[meta.kind] = (e as Error).message
  } finally {
    busy[meta.kind] = false
  }
}
</script>

<template>
  <div class="ingest-page">
    <section class="toolbar">
      <span class="muted">手动触发摄取；中广核两项与气象另有每日定时任务。</span>
      <div class="toolbar-actions">
        <RouterLink to="/system/ai-studio?tab=schedules" class="tool-link"><Workflow :size="13" /> 定时任务</RouterLink>
        <RouterLink to="/yygl/data-browser" class="tool-link">回放浏览 →</RouterLink>
        <InfoPop title="数据摄取管理" label="说明" :width="380">
          <ul>
            <li>按钮参数固定，页面上不可改；要指定目录或地区，须在服务器命令行执行。</li>
            <li>结果按 ETL 输出如实回显；嗅探到模拟或合成数据时，真伪标注降为「仅决策支持」。</li>
            <li>中广核两项调用厂侧外部 API（非电网官方接口），写中广核私有库，仅中广核账号可触发。</li>
          </ul>
        </InfoPop>
      </div>
    </section>

    <section v-for="group in GROUPS" :key="group.key" class="group">
      <header class="group-head">
        <h3>{{ group.title }}</h3>
        <span class="muted">{{ group.note }}</span>
      </header>

      <div class="kind-list">
        <article v-for="meta in group.kinds" :key="meta.kind" class="kind-row" :data-kind="meta.kind">
          <component :is="meta.icon" :size="18" class="kind-icon" />
          <div class="kind-main">
            <h4>{{ meta.label }}</h4>
            <p class="kind-summary">{{ meta.summary }}</p>
          </div>
          <div class="kind-chips">
            <span v-for="chip in meta.chips" :key="chip.text" class="chip" :class="chip.tone">{{ chip.text }}</span>
          </div>
          <div class="kind-actions">
            <InfoPop :title="meta.label">
              <p><b>写入</b>：{{ meta.target }}</p>
              <p v-for="note in meta.notes" :key="note">{{ note }}</p>
              <p><b>摄取类型</b>：<code>{{ meta.kind }}</code></p>
            </InfoPop>
            <button class="trigger" type="button" :disabled="busy[meta.kind]" @click="run(meta)">
              <Loader2 v-if="busy[meta.kind]" :size="14" class="spin" />
              <CloudDownload v-else :size="14" />
              {{ busy[meta.kind] ? '摄取中…' : '立即摄取' }}
            </button>
          </div>
          <IngestResultBox
            v-if="errMsg[meta.kind] || last[meta.kind]"
            class="kind-result"
            :result="last[meta.kind]"
            :error="errMsg[meta.kind]"
          />
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ingest-page { max-width: 1180px; display: flex; flex-direction: column; gap: 16px; }
.muted { color: var(--muted); font-size: var(--font-sm); }

.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.toolbar-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: var(--font-12-5); }
.tool-link { color: var(--primary); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
.tool-link:hover { text-decoration: underline; }

.group { display: flex; flex-direction: column; gap: 8px; }
.group-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.group-head h3 { margin: 0; font-size: var(--font-lg); font-weight: 600; color: var(--text); }

.kind-list { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius, 8px); }
.kind-row {
  display: grid; grid-template-columns: 20px minmax(0, 1fr) auto auto; align-items: center;
  column-gap: 14px; row-gap: 8px; padding: 12px 16px;
}
.kind-row + .kind-row { border-top: 1px solid var(--line); }
.kind-icon { color: var(--primary); }
.kind-main h4 { margin: 0; font-size: var(--font-14-5); font-weight: 600; color: var(--text); }
.kind-summary { margin: 2px 0 0; font-size: var(--font-sm); color: var(--text-soft); }
.kind-chips { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.chip {
  font-size: var(--font-xs); padding: 2px 8px; border-radius: 10px; white-space: nowrap;
  color: var(--text-soft); background: color-mix(in srgb, var(--muted) 12%, transparent);
}
.chip.warn { color: var(--warning); background: color-mix(in srgb, var(--warning) 12%, transparent); }
.kind-actions { display: flex; align-items: center; gap: 6px; }
.kind-result { grid-column: 1 / -1; }

.trigger {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap;
  padding: 6px 14px; border-radius: var(--radius-sm, 6px); font-size: var(--font-md); font-weight: 500;
  border: 1px solid var(--primary); color: var(--primary); background: transparent;
  transition: background 0.15s;
}
.trigger:hover:not(:disabled) { background: color-mix(in srgb, var(--primary) 10%, transparent); }
.trigger:disabled { opacity: 0.6; cursor: progress; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 窄屏：标签与按钮换到第二行，标题独占一行不被挤压。 */
@media (max-width: 720px) {
  .kind-row { grid-template-columns: 20px minmax(0, 1fr); }
  .kind-chips { grid-column: 2; justify-content: flex-start; }
  .kind-actions { grid-column: 2; }
}
</style>
