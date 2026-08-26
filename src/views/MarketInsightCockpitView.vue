<script setup lang="ts">
// 市场洞察驾驶舱（Neon · agent 辅助决策）：把「市场洞察」分散信号聚成一屏 bento。
// 左栏「预检」：fetchMarketInsightBundle 确定性装配 → dljy-ui 组件渲染六区块（不经 LLM，前后端对齐）。
// 每卡「✨AI 解读」：把该 block 作 contextPayload 交右栏 AgentChatPanel 流式解读（B3 选中即问）。
import { computed, ref } from 'vue'
import MarketSnapshotCard from '@/components/agent/dljy-ui/insight/MarketSnapshotCard.vue'
import AnomalyRadarCard from '@/components/agent/dljy-ui/insight/AnomalyRadarCard.vue'
import ElasticityCurveCard from '@/components/agent/dljy-ui/insight/ElasticityCurveCard.vue'
import SpreadArbitrageCard from '@/components/agent/dljy-ui/insight/SpreadArbitrageCard.vue'
import NodePriceHeatCard from '@/components/agent/dljy-ui/insight/NodePriceHeatCard.vue'
import DataQualityPanel from '@/components/agent/dljy-ui/common/DataQualityPanel.vue'
import TrustBadge from '@/components/common/TrustBadge.vue'
import HomeConsoleView from './HomeConsoleView.vue'
import { currentRegion } from '@/services/region/regionContext'
import { PAGE_PROMPT_KEYS } from '@/prompts'
import { fetchMarketInsightBundle, type MarketInsightBundle } from '@/services/market/marketInsightClient'
import { useAiPanel } from '@/composables/useAiPanel'
import { usePageInsight } from '@/composables/usePageInsight'

function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const date = ref(todayISO())
const market = ref<'da' | 'rt'>('da')
const promptKey = PAGE_PROMPT_KEYS.marketInsightCockpit

const bundle = ref<MarketInsightBundle | null>(null)
const loading = ref(false)
const error = ref('')

const blocks = computed(() => (bundle.value?.blocks ?? {}) as Record<string, unknown>)
const basisLabel = computed(() => (bundle.value ? (bundle.value.basis === 'captured' ? '真实采集' : '含模拟/缺失') : ''))

async function runPrecheck() {
  loading.value = true
  error.value = ''
  try {
    bundle.value = await fetchMarketInsightBundle({
      date: date.value,
      region: currentRegion.value.id,
      region_name: currentRegion.value.name,
      market: market.value
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// 选中即问：把某区块作 contextPayload 交「全局统一 AI 面板」的 agent 模式流式解读
// （驾驶舱不再自带右栏，复用右上角加宽面板，避免两个 AI 入口重叠）。
const { openAgent } = useAiPanel()
const chatPayload = computed(() => ({ region_id: currentRegion.value.id, region_name: currentRegion.value.name }))

function ask(name: string, blockKey: string) {
  openAgent({
    promptKey,
    scenario: 'chat',
    initialQuestion: `请解读本页「${name}」并给出关键判断（数据已在上下文，勿臆造缺失项）`,
    contextPayload: { block_name: name, block: blocks.value[blockKey] ?? null },
    payload: chatPayload.value,
    label: name
  })
}
function askGlobal() {
  openAgent({
    promptKey,
    scenario: 'chat',
    initialQuestion: `请综合解读今日市场态势（${date.value}）：行情 / 弹性 / 价差 / 节点 / 异动，给出三段式判断`,
    contextPayload: { block_name: '市场洞察全局', data_availability: bundle.value?.data_availability ?? null },
    payload: chatPayload.value,
    label: '市场洞察全局'
  })
}

// 右下角悬浮球 = 本页解读入口：本页是按卡片解读，悬浮球接「全局解读」那一支。
const { registerPageInsight } = usePageInsight(promptKey)
registerPageInsight(askGlobal, '市场洞察驾驶舱')
</script>

<template>
  <div class="mic-root">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="市场洞察为回看与解读：数值由后端确定性装配，弹性/价差/预测为分析参考·非结算依据；AI 解读仅供参考，请勿直接作为交易决策依据。"
    />
    <header class="mic-head">
      <div class="mic-title">
        <h2>🛰 市场洞察驾驶舱</h2>
        <span class="mic-sub">{{ currentRegion.name }} · 行情 / 弹性 / 价差 / 节点 / 异动 一屏决策</span>
      </div>
      <div class="mic-ctrl">
        <input v-model="date" type="date" class="mic-date" />
        <div class="mic-seg">
          <button :class="{ on: market === 'da' }" @click="market = 'da'">日前</button>
          <button :class="{ on: market === 'rt' }" @click="market = 'rt'">实时</button>
        </div>
        <TrustBadge v-if="bundle" :basis="bundle.basis" prefix="决策口径" />
        <el-button :loading="loading" @click="runPrecheck">数据预检</el-button>
        <el-button type="primary" :disabled="!bundle" @click="askGlobal">✨ AI 综合解读</el-button>
      </div>
    </header>

    <div class="mic-main">
      <div class="mic-board">
        <section class="mic-overview span-2">
          <header class="mic-sec-head">
            <span class="mic-sec-title">📊 市场概览</span>
            <small>基础指标 · 实时采集：新能源出力 / 平台负荷 / 日均价 / 天气</small>
          </header>
          <HomeConsoleView :embedded="true" />
        </section>
        <div class="mic-sec-head mic-insight-head span-2">
          <span class="mic-sec-title">🛰 深度洞察</span>
          <small>价格弹性 / 价差套利 / 节点热力 / 异动雷达 · 确定性装配（不经 LLM），预检后呈现</small>
        </div>
        <div v-if="error" class="mic-err">数据预检失败：{{ error }}（请确认 agent-backend 已启动）</div>
        <div v-else-if="!bundle" class="mic-empty">
          <p>选择日期与市场后点击<strong>「数据预检」</strong>，一屏 bento 即以
            <strong>市场快照 · 价格弹性 · 价差套利 · 节点热力 · 异动雷达</strong> 确定性呈现（不经 LLM）。</p>
          <p>每张卡右上<strong>「✨AI 解读」</strong>把该区块交给右侧智能体流式研判（选中即问）。</p>
        </div>
        <template v-else>
          <div class="mic-tag" :class="bundle.basis === 'captured' ? 't-real' : 't-mock'">数据口径：{{ basisLabel }}</div>
          <div class="mic-cell span-2">
            <button class="mic-ask" @click="ask('异动雷达', 'anomalies')">✨ AI 解读</button>
            <AnomalyRadarCard :data="blocks" />
          </div>
          <div class="mic-cell span-2">
            <button class="mic-ask" @click="ask('市场快照', 'snapshot')">✨ AI 解读</button>
            <MarketSnapshotCard :data="blocks" />
          </div>
          <div class="mic-cell">
            <button class="mic-ask" @click="ask('价格弹性', 'elasticity')">✨ AI 解读</button>
            <ElasticityCurveCard :data="blocks" />
          </div>
          <div class="mic-cell">
            <button class="mic-ask" @click="ask('日前-实时价差', 'spread')">✨ AI 解读</button>
            <SpreadArbitrageCard :data="blocks" />
          </div>
          <div class="mic-cell span-2">
            <button class="mic-ask" @click="ask('节点电价热力', 'node_price')">✨ AI 解读</button>
            <NodePriceHeatCard :data="blocks" />
          </div>
          <div class="mic-cell span-2">
            <DataQualityPanel :data="bundle" title="数据可用性" :basis="bundle.basis" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mic-root {
  display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0;
  padding: 14px; border-radius: 16px;
  color: var(--text-body); background: var(--bg);
}
.mic-head {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  padding: 14px 18px; border-radius: 14px;
  background: var(--panel); background-image: var(--panel-image);
  border: 1px solid var(--line); box-shadow: var(--shadow);
}
.mic-title h2 { margin: 0; font-size: var(--font-19); color: var(--text); }
.mic-sub { font-size: var(--font-12-5); color: var(--muted); }
.mic-ctrl { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mic-date { padding: 7px 10px; font-size: var(--font-md); border: 1px solid var(--line); border-radius: 8px; background: var(--panel-sub); color: var(--text-body); }
.mic-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.mic-seg button { padding: 7px 13px; font-size: var(--font-12-5); background: transparent; color: var(--muted); border: none; cursor: pointer; }
.mic-seg button.on { background: var(--primary-tint); color: var(--primary); }
.mic-main { flex: 1; min-height: 0; display: flex; gap: 12px; }
.mic-board { flex: 1; min-width: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-content: start; }
.mic-overview { background: var(--panel); background-image: var(--panel-image); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px 4px; }
.mic-sec-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 2px 2px 8px; }
.mic-sec-title { font-size: var(--font-15); font-weight: 600; color: var(--text); }
.mic-sec-head small { font-size: var(--font-sm); color: var(--muted); }
.mic-insight-head { margin-top: 2px; border-top: 1px dashed var(--line); padding-top: 12px; }
.mic-tag { grid-column: 1 / -1; font-size: var(--font-sm); padding: 5px 10px; border-radius: 8px; justify-self: start; }
.mic-tag.t-real { color: var(--success); background: var(--primary-tint); }
.mic-tag.t-mock { color: var(--warning); background: var(--warning-tint); }
.mic-cell { position: relative; min-width: 0; }
.span-2 { grid-column: 1 / -1; }
.mic-ask {
  position: absolute; top: 12px; right: 12px; z-index: 2;
  padding: 3px 10px; font-size: var(--font-11-5); cursor: pointer; white-space: nowrap;
  color: var(--primary); background: var(--primary-tint);
  border: 1px solid var(--primary-tint-border); border-radius: 999px; transition: all .15s;
}
.mic-ask:hover { background: var(--primary-tint); border-color: var(--primary); }
.mic-err { grid-column: 1 / -1; font-size: var(--font-md); color: var(--danger); padding: 14px 16px; background: var(--danger-tint); border: 1px solid var(--danger); border-radius: 12px; }
.mic-empty { grid-column: 1 / -1; padding: 40px 28px; text-align: center; color: var(--muted); font-size: var(--font-lg); line-height: 1.85; }
.mic-empty strong { color: var(--primary); }
/* neon 专属沉浸式：深空渐变 + 标题渐变 + 辉光（仅 neon 主题，其余三主题用纯净主题色）*/
:root[data-theme='neon'] .mic-root {
  background:
    radial-gradient(1200px 700px at 12% -10%, #0d1b3a 0%, rgba(6, 9, 20, 0) 55%),
    radial-gradient(900px 600px at 100% 0%, rgba(176, 38, 255, .14), rgba(6, 9, 20, 0) 50%),
    #04060f;
}
:root[data-theme='neon'] .mic-head { box-shadow: 0 10px 30px rgba(0, 0, 0, .4), inset 0 1px 0 rgba(255, 255, 255, .05); }
:root[data-theme='neon'] .mic-title h2 {
  background: linear-gradient(90deg, #d6f6ff, #8fb6ff); -webkit-background-clip: text; background-clip: text; color: transparent;
}
:root[data-theme='neon'] .mic-ask:hover { box-shadow: 0 0 14px rgba(34, 211, 238, .4); }
:root[data-theme='neon'] .mic-date,
:root[data-theme='arc'] .mic-date { color-scheme: dark; }

@media (max-width: 680px) { .mic-board { grid-template-columns: 1fr; } }
</style>
