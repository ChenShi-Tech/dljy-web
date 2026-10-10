<script setup lang="ts">
// 市场洞察驾驶舱（agent 辅助决策）：把「市场洞察」分散信号聚成一屏 bento。
// 左栏「预检」：fetchMarketInsightBundle 确定性装配 → dljy-ui 组件渲染六区块（不经 LLM，前后端对齐）。
// 每卡「AI 解读」：把该 block 作 contextPayload 交右栏 AgentChatPanel 流式解读（B3 选中即问）。
import { Sparkles } from 'lucide-vue-next'
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
import { defineAiPage, useAiSidebar } from '@/features/aiSidebar'
import { onRegionChange } from '@/composables/useRegionReload'

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

// 预检请求代次：连点预检/切地区后，晚归的旧响应不得写回 bundle/error/loading。
let precheckSeq = 0

async function runPrecheck() {
  const seq = ++precheckSeq
  loading.value = true
  error.value = ''
  try {
    const result = await fetchMarketInsightBundle({
      date: date.value,
      region: currentRegion.value.id,
      region_name: currentRegion.value.name,
      market: market.value
    })
    if (seq !== precheckSeq) return // 晚归的旧预检：写回会复活已失效的旧地区 bundle
    bundle.value = result
  } catch (e) {
    if (seq !== precheckSeq) return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (seq === precheckSeq) loading.value = false
  }
}

// 切地区后旧地区的预检结果立即失效（KeepAlive 缓存页不重挂载，须显式清空）；
// bundle 是「数据预检」按钮触发的后端重计算，这里只清空回空态，不自动重拉；
// 同时作废在途预检，防止晚归响应把旧地区 bundle 写回来。
onRegionChange(() => {
  precheckSeq += 1
  bundle.value = null
  error.value = ''
})

// 选中即问：单卡解读把该区块作切片交 AI 侧边栏；悬浮球与「AI 综合解读」走全局解读那一支。
// 切片在点击时刻求值，只随发起解读的那一轮下发。
const ai = useAiSidebar()

function ask(name: string, blockKey: string) {
  ai.ask(`请解读本页「${name}」并给出关键判断（数据已在上下文，勿臆造缺失项）`, {
    context: () => ({ block_name: name, block: blocks.value[blockKey] ?? null }),
    label: name,
    promptKey
  })
}

defineAiPage({
  label: '市场洞察驾驶舱',
  promptKey,
  interpret: {
    context: () => ({ block_name: '市场洞察全局', data_availability: bundle.value?.data_availability ?? null }),
    question: () => `请综合解读今日市场态势（${date.value}）：行情 / 弹性 / 价差 / 节点 / 异动，给出三段式判断`
  }
})
function askGlobal() {
  ai.interpret()
}
</script>

<template>
  <div class="mic-root">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="市场洞察为回看与解读：分析参考、非结算依据；AI 解读仅供参考。"
    />
    <header class="mic-head">
      <div class="mic-title">
        <h2>市场洞察驾驶舱</h2>
        <span class="mic-sub">{{ currentRegion.name }} · 行情 / 弹性 / 价差 / 节点 / 异动</span>
      </div>
      <div class="mic-ctrl">
        <input v-model="date" type="date" class="mic-date" />
        <div class="mic-seg">
          <button :class="{ on: market === 'da' }" @click="market = 'da'">日前</button>
          <button :class="{ on: market === 'rt' }" @click="market = 'rt'">实时</button>
        </div>
        <TrustBadge v-if="bundle" :basis="bundle.basis" prefix="决策口径" />
        <el-button :loading="loading" @click="runPrecheck">数据预检</el-button>
        <el-button type="primary" :icon="Sparkles" :disabled="!bundle" @click="askGlobal">AI 综合解读</el-button>
      </div>
    </header>

    <div class="mic-main">
      <div class="mic-board">
        <section class="mic-overview span-2">
          <header class="mic-sec-head">
            <span class="mic-sec-title">市场概览</span>
            <small>基础指标 · 实时采集：新能源出力 / 平台负荷 / 日均价 / 天气</small>
          </header>
          <HomeConsoleView :embedded="true" />
        </section>
        <div class="mic-sec-head mic-insight-head span-2">
          <span class="mic-sec-title">深度洞察</span>
          <small>预检后呈现 · 确定性装配（不经 LLM）</small>
        </div>
        <div v-if="error" class="mic-err">数据预检失败：{{ error }}（请确认 agent-backend 已启动）</div>
        <div v-else-if="!bundle" class="mic-empty">
          <p>选择日期与市场后点击<strong>「数据预检」</strong>，五区块洞察一屏确定性呈现（不经 LLM）；
            每张卡右上<strong>「AI 解读」</strong>可就该区块流式研判。</p>
        </div>
        <template v-else>
          <div class="mic-tag" :class="bundle.basis === 'captured' ? 't-real' : 't-mock'">数据口径：{{ basisLabel }}</div>
          <div class="mic-cell span-2">
            <button class="mic-ask" @click="ask('异动雷达', 'anomalies')"><Sparkles :size="12" /> AI 解读</button>
            <AnomalyRadarCard :data="blocks" />
          </div>
          <div class="mic-cell span-2">
            <button class="mic-ask" @click="ask('市场快照', 'snapshot')"><Sparkles :size="12" /> AI 解读</button>
            <MarketSnapshotCard :data="blocks" />
          </div>
          <div class="mic-cell">
            <button class="mic-ask" @click="ask('价格弹性', 'elasticity')"><Sparkles :size="12" /> AI 解读</button>
            <ElasticityCurveCard :data="blocks" />
          </div>
          <div class="mic-cell">
            <button class="mic-ask" @click="ask('日前-实时价差', 'spread')"><Sparkles :size="12" /> AI 解读</button>
            <SpreadArbitrageCard :data="blocks" />
          </div>
          <div class="mic-cell span-2">
            <button class="mic-ask" @click="ask('节点电价热力', 'node_price')"><Sparkles :size="12" /> AI 解读</button>
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
.mic-ask svg { vertical-align: -2px; margin-right: 3px; }
.mic-err { grid-column: 1 / -1; font-size: var(--font-md); color: var(--danger); padding: 14px 16px; background: var(--danger-tint); border: 1px solid var(--danger); border-radius: 12px; }
.mic-empty { grid-column: 1 / -1; padding: 40px 28px; text-align: center; color: var(--muted); font-size: var(--font-lg); line-height: 1.85; }
.mic-empty strong { color: var(--primary); }
/* 流光专属沉浸式：深空径向微光 + 标题冷白青渐变 + 柔光（仅 flow 主题，其余三主题用纯净主题色）*/
:root[data-theme='flow'] .mic-root {
  background:
    radial-gradient(1200px 700px at 50% -12%, rgba(44, 138, 166, .18), rgba(5, 11, 22, 0) 60%),
    #050b16;
}
:root[data-theme='flow'] .mic-head { box-shadow: 0 10px 28px rgba(1, 6, 14, .55), inset 0 1px 0 rgba(191, 227, 236, .05); }
:root[data-theme='flow'] .mic-title h2 {
  background: linear-gradient(90deg, #e6eff4, #86d8e7); -webkit-background-clip: text; background-clip: text; color: transparent;
}
:root[data-theme='flow'] .mic-ask:hover { box-shadow: 0 0 14px rgba(108, 201, 219, .35); }
:root[data-theme='flow'] .mic-date,
:root[data-theme='arc'] .mic-date { color-scheme: dark; }

@media (max-width: 680px) { .mic-board { grid-template-columns: 1fr; } }
</style>
