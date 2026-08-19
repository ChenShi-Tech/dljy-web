<template>
  <div class="st-root">
    <!-- 顶栏：图名 + 模板/我的编排 + 保存/校验/配置 + 运行 -->
    <header class="st-top">
      <div class="st-top-l">
        <input v-model="graphName" class="st-name" placeholder="未命名编排" />
        <span class="st-meta" v-if="currentId">已保存 · v{{ currentVersion }}</span>
        <span class="st-meta dirty" v-else>未保存</span>
      </div>
      <div class="st-top-r">
        <el-select v-model="pickTemplate" placeholder="复制模板" size="small" class="st-sel"
          @change="onPickTemplate">
          <el-option v-for="t in templates" :key="t.id" :label="t.name" :value="t.id!" />
        </el-select>
        <el-select v-model="pickSaved" placeholder="我的编排" size="small" class="st-sel"
          @change="onPickSaved" @visible-change="(v: boolean) => v && refreshSaved()">
          <el-option v-for="g in savedGraphs" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
        <el-button size="small" type="primary" @click="nlOpen = true">✨ AI 生成</el-button>
        <el-button size="small" @click="newBlank">新建</el-button>
        <el-button size="small" @click="duplicate" :disabled="!hasNodes">复制副本</el-button>
        <el-button size="small" @click="autoLayout" :disabled="!hasNodes">自动布局</el-button>
        <el-button size="small" type="primary" plain @click="save" :loading="saving">保存</el-button>
        <el-button size="small" @click="runValidate" :loading="validating">校验</el-button>
        <el-button size="small" @click="openHistory">运行历史</el-button>
        <el-button size="small" @click="exportJson" :disabled="!hasNodes">导出</el-button>
        <el-button size="small" @click="triggerImport">导入</el-button>
        <input ref="importInput" type="file" accept="application/json,.json" style="display:none" @change="onImportFile" />
        <el-popover placement="bottom-end" :width="290" trigger="click">
          <template #reference>
            <el-button size="small">执行配置</el-button>
          </template>
          <div class="st-cfg">
            <div class="st-cfg-title">执行配置 · 防失控</div>
            <label>递归上限 (recursion_limit)
              <el-input-number v-model="config.recursion_limit" :min="1" :max="2000" size="small" controls-position="right" />
            </label>
            <label>单节点最大迭代 (max_node_visits)
              <el-input-number v-model="config.max_node_visits" :min="1" :max="100" size="small" controls-position="right" />
            </label>
            <label>并发分支软上限 (max_parallel)
              <el-input-number v-model="config.max_parallel" :min="1" :max="64" size="small" controls-position="right" />
            </label>
            <label>节点失败重试 (retry_attempts)
              <el-input-number v-model="config.retry_attempts" :min="1" :max="5" size="small" controls-position="right" />
            </label>
            <p class="st-cfg-tip">循环图请确保「单节点最大迭代」足够小、递归上限足够大，避免 GRAPH_RECURSION_LIMIT。重试用于容数据源/模型抖动。</p>
          </div>
        </el-popover>
        <el-button size="small" type="primary" :disabled="busy || !hasNodes" @click="openRun">运行编排</el-button>
      </div>
    </header>

    <div class="st-main">
      <!-- 左:节点面板 -->
      <aside class="st-palette">
        <div class="st-pal-title">拖拽 / 点击添加节点</div>
        <div v-for="p in PALETTE" :key="p.kind + (p.role || '')" class="st-pal-item"
          draggable="true" @dragstart="onDragStart($event, p)" @click="addFromPalette(p)">
          <span class="st-pal-icon" :class="`pi-${p.kind}`">{{ p.icon }}</span>
          <div class="st-pal-text">
            <div class="st-pal-name">{{ p.name }}</div>
            <div class="st-pal-desc">{{ p.desc }}</div>
          </div>
        </div>
        <div class="st-pal-hint">
          连线：从节点右侧圆点拖到目标节点左侧圆点。<br />
          删除：选中节点/连线后按 Delete。
        </div>
      </aside>

      <!-- 中:画布 -->
      <div class="st-canvas" @drop="onDrop" @dragover.prevent @dragenter.prevent>
        <VueFlow :default-viewport="{ zoom: 0.85 }" :min-zoom="0.2" :max-zoom="2"
          :delete-key-code="['Backspace', 'Delete']" fit-view-on-init
          @node-click="onNodeClick" @edge-click="onEdgeClick" @pane-click="onPaneClick">
          <template #node-studio="props">
            <StudioFlowNode v-bind="props" />
          </template>
          <Background pattern-color="var(--line)" :gap="22" />
          <Controls />
          <MiniMap pannable zoomable />
          <Panel position="top-left" class="st-flow-legend">
            <span class="lg"><i class="d run" />运行中</span>
            <span class="lg"><i class="d done" />已完成</span>
          </Panel>
        </VueFlow>
        <div v-if="!hasNodes" class="st-empty">
          <p>从左侧添加节点，或从顶部「复制模板」开始</p>
          <el-button size="small" type="primary" plain @click="onPickTemplate('tpl_supervisor_chain')">
            复制「多智能体业务链」模板
          </el-button>
        </div>
      </div>

      <!-- 右:检查器(节点/连线配置 + 校验摘要) -->
      <aside class="st-inspector">
        <template v-if="selNode">
          <div class="st-insp-title">节点配置 · {{ kindLabel(selNode.data.kind) }}</div>
          <label class="st-field">名称
            <el-input v-model="selNode.data.label" size="small" @input="syncNode" />
          </label>
          <label v-if="hasRole(selNode.data.kind)" class="st-field">角色
            <el-select v-model="selNode.data.role" size="small" @change="syncNode" style="width:100%">
              <el-option v-for="r in ROLE_META" :key="r.role" :label="`${r.char} ${r.name}`" :value="r.role" />
            </el-select>
          </label>
          <label v-if="hasRole(selNode.data.kind)" class="st-field">模型
            <el-select v-model="selNode.data.modelRef" size="small" clearable filterable
              placeholder="角色默认（在 AI 设置全局配）" @change="syncNode" style="width:100%">
              <el-option v-for="m in availableModels" :key="m.ref" :label="`${m.ref}${m.vision ? ' · 视觉' : ''}`" :value="m.ref" />
            </el-select>
          </label>
          <label v-if="hasTask(selNode.data.kind)" class="st-field">
            {{ selNode.data.kind === 'condition' ? '判定说明' : selNode.data.kind === 'approval' ? '审批问题' : '子任务指令' }}
            <el-input v-model="selNode.data.task" type="textarea" :rows="5" size="small"
              :placeholder="taskPlaceholder(selNode.data.kind)" @input="syncNode" />
          </label>

          <!-- tool 节点:工具选择 + 参数 JSON -->
          <template v-if="selNode.data.kind === 'tool'">
            <label class="st-field">数据工具
              <el-select v-model="selNode.data.tool" filterable size="small" style="width:100%"
                placeholder="选择 L0 数据工具" @change="fillToolArgs">
                <el-option v-for="t in toolCatalog" :key="t.name"
                  :label="`${t.name} · ${t.description}`" :value="t.name" />
              </el-select>
            </label>
            <p v-if="selectedToolMeta" class="st-cfg-tip">参数名：{{ selectedToolMeta.args.join('、') || '无' }}</p>
            <label class="st-field">参数 (JSON)
              <el-input v-model="argsText" type="textarea" :rows="5" size="small" />
            </label>
            <p class="st-cfg-tip">{{ TPL_HINT }}</p>
            <p v-if="argsError" class="st-arg-err">{{ argsError }}</p>
          </template>

          <!-- map 节点:批处理项列表(每行一项) -->
          <template v-if="selNode.data.kind === 'map'">
            <label class="st-field">批处理项 (每行一项)
              <el-input v-model="mapItemsText" type="textarea" :rows="5" size="small"
                placeholder="云南&#10;山西&#10;广东" />
            </label>
            <p class="st-cfg-tip">{{ MAP_ITEM_HINT }}</p>
          </template>

          <div class="st-insp-acts">
            <el-button size="small" @click="duplicateNode">复制节点</el-button>
            <el-button size="small" type="danger" plain @click="deleteSelected">删除节点</el-button>
          </div>
        </template>

        <template v-else-if="selEdge">
          <div class="st-insp-title">连线配置</div>
          <p class="st-insp-sub">{{ edgeEndsLabel(selEdge) }}</p>
          <label class="st-field">分支标签
            <el-input v-model="selEdge.label" size="small" placeholder="条件节点出边的分支名(如:充分/补充)" @input="syncEdgeLabel" />
          </label>
          <p class="st-cfg-tip">仅条件节点的出边需要分支标签，路由判定器据此择路。</p>
          <el-button size="small" type="danger" plain @click="deleteSelected">删除连线</el-button>
        </template>

        <template v-else>
          <div class="st-insp-title">校验与提示</div>
          <div v-if="validation" class="st-valid" :class="{ bad: !validation.ok }">
            <div class="st-valid-row">
              状态：<b>{{ validation.ok ? '✓ 可运行' : '✗ 有阻断错误' }}</b>
            </div>
            <div class="st-valid-row">含循环：{{ validation.has_cycle ? '是' : '否' }} · 估算最坏步数：{{ validation.estimated_max_steps }}</div>
            <div v-if="validation.recommended_recursion_limit > config.recursion_limit" class="st-valid-row warn">
              建议递归上限 ≥ {{ validation.recommended_recursion_limit }}
              <el-button link type="primary" size="small" @click="config.recursion_limit = validation.recommended_recursion_limit">采纳</el-button>
            </div>
            <ul v-if="validation.errors.length" class="st-valid-list err">
              <li v-for="(e, i) in validation.errors" :key="'e' + i">{{ e }}</li>
            </ul>
            <ul v-if="validation.warnings.length" class="st-valid-list warn">
              <li v-for="(w, i) in validation.warnings" :key="'w' + i">{{ w }}</li>
            </ul>
          </div>
          <p v-else class="st-insp-empty">选中节点或连线进行配置；点「校验」检查结构、循环与递归上限。</p>
          <div class="st-stats">
            节点 {{ nodeCount }} · 连线 {{ edgeCount }}
            <span v-if="issueCount" class="st-stats-bad"> · {{ issueCount }} 个阻断问题</span>
          </div>
          <p class="st-insp-empty" style="margin-top:8px">画布节点上的 <b style="color:var(--danger,#dc2626)">!</b> 红标为阻断错误、<b style="color:#d97706">?</b> 黄标为提示,鼠标悬停看原因。</p>
        </template>
      </aside>
    </div>

    <!-- 运行面板(底部抽屉) -->
    <transition name="st-run">
      <section v-if="runOpen" class="st-run">
        <div class="st-run-head">
          <div class="st-run-task">
            <span class="st-tag">运行任务</span>
            <input v-model="task" class="st-task-in" :disabled="busy"
              placeholder="下达总任务,中枢按你编排的图执行(回车运行)…" @keydown.enter="startRun()" />
            <el-button size="small" type="primary" :disabled="busy || !task.trim()" @click="startRun()">
              {{ busy ? '执行中…' : '开始' }}
            </el-button>
            <span class="st-run-prog" v-if="phase !== 'idle'">{{ progText }}</span>
          </div>
          <el-button link size="small" :disabled="!reportText && !Object.keys(nodeOutputs).length"
            @click="exportReport">导出报告</el-button>
          <el-button link size="small" @click="closeRun">收起</el-button>
        </div>

        <div class="st-run-body">
          <!-- 协作纪要 -->
          <div class="st-minutes">
            <div class="st-col-title">执行纪要</div>
            <div v-for="(m, i) in minutes" :key="i" class="st-bubble" :class="m.tone">
              <span class="st-who">{{ m.who }}</span>
              <p>{{ m.text }}</p>
            </div>
            <el-empty v-if="!minutes.length" description="尚无执行记录" :image-size="48" />
          </div>

          <!-- 节点产出 + 报告(markdown) -->
          <div class="st-outputs">
            <div class="st-col-title">节点产出</div>
            <details v-for="(o, nid) in nodeOutputs" :key="nid" class="st-out-card" open>
              <summary>
                {{ o.label }} <i>{{ roleMeta(o.role)?.name || o.role }}</i>
                <el-button link size="small" class="st-copy" @click.prevent="copyText(o.output)">复制</el-button>
              </summary>
              <div class="md" v-html="renderMarkdown(o.output)" />
            </details>

            <div v-if="reportText" class="st-report">
              <div class="st-col-title">汇总报告 · 实时生成</div>
              <div class="md" v-html="renderMarkdown(reportText)" />
            </div>

            <!-- 审批卡 -->
            <div v-if="pendingApproval" class="st-approval">
              <div class="st-appr-title">⚑ 待人工审批</div>
              <p class="st-appr-q">{{ approvalQuestion }}</p>
              <pre class="st-appr-body">{{ approvalSummary }}</pre>
              <div class="st-appr-acts">
                <el-button size="small" type="primary" @click="decideApproval('approve')">批准</el-button>
                <el-button size="small" @click="decideApproval('reject')">驳回</el-button>
              </div>
            </div>

            <div v-if="runError" class="st-error">
              <b>运行出错{{ runErrorCode ? ` (${runErrorCode})` : '' }}：</b>{{ runError }}
              <el-button v-if="runErrorCode === 'GRAPH_RECURSION_LIMIT'" link type="primary" size="small"
                @click="bumpRecursion">提高递归上限并重试</el-button>
            </div>
          </div>
        </div>
      </section>
    </transition>

    <!-- 运行历史抽屉 -->
    <el-drawer v-model="historyOpen" title="运行历史" direction="rtl" size="380px">
      <div v-if="!runHistory.length" class="st-hist-empty">暂无运行记录</div>
      <div v-for="r in runHistory" :key="r.id" class="st-hist-item">
        <div class="st-hist-main" @click="reopenRun(r.id)">
          <div class="st-hist-name">{{ r.graph_name }}
            <span class="st-hist-badge" :class="r.status">{{ r.status === 'error' ? '出错' : '完成' }}</span>
          </div>
          <div class="st-hist-task">{{ r.task || '(无任务描述)' }}</div>
          <div class="st-hist-time">{{ fmtTime(r.created_at) }}</div>
        </div>
        <el-button link type="danger" size="small" @click.stop="removeRun(r.id)">删除</el-button>
      </div>
    </el-drawer>

    <!-- AI 生成编排：自然语言 → GraphSpec → 渲染到画布 -->
    <el-dialog v-model="nlOpen" title="✨ AI 生成编排" width="560px" append-to-body>
      <p class="nl-tip">用一句话描述你想要的工作流，AI 会生成可执行的编排图并渲染到画布，再自由微调。需先在「AI 设置」配置模型密钥。</p>
      <el-input
        v-model="nlText"
        type="textarea"
        :rows="4"
        placeholder="例如：查云南次日现货行情和价格预测（两个分析并行），汇总给申报策略师生成草稿，最后人工审批"
      />
      <div class="nl-egs">
        <span class="nl-eg-label">示例：</span>
        <el-button v-for="(eg, i) in nlExamples" :key="i" link size="small" @click="nlText = eg">{{ eg.slice(0, 16) }}…</el-button>
      </div>
      <template #footer>
        <el-button @click="nlOpen = false">取消</el-button>
        <el-button type="primary" :loading="nlBusy" :disabled="nlText.trim().length < 4" @click="generateFromNl">生成并渲染</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { VueFlow, useVueFlow, Panel, MarkerType, type Connection } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import 'highlight.js/styles/github.css'
import { ElMessage } from 'element-plus'
import StudioFlowNode from '@/components/studio/StudioFlowNode.vue'
import { renderMarkdown } from '../utils/markdown'
import {
  fetchTemplates, listGraphs, getGraph, createGraph, updateGraph,
  validateGraph, createGraphRun, fetchToolCatalog, generateGraphFromNl,
  listRuns, getRun, saveRun, deleteRun,
  ROLE_META, roleMeta, DEFAULT_CONFIG,
  type GraphSpec, type GraphSummary, type GraphConfigSpec, type NodeType, type ValidationResult,
  type ToolCatalogItem, type RunSummary
} from '@/services/agent/studioClient'
import { sendAgentMessage, sendAgentApproval, pingAgentService, stopAgentRun, getActiveRun, type AgentEvent } from '@/services/agent/agentClient'
import { getRouting, type RoutingModel } from '@/services/agent/agentConfig'
import { packageRegionSummary } from '@/services/region/regionContext'

const {
  addNodes, addEdges, onConnect, removeNodes, removeEdges,
  updateNodeData, screenToFlowCoordinate, setNodes, setEdges,
  toObject, fitView, nodes: vfNodes, edges: vfEdges
} = useVueFlow()

// ── 画布元信息 ──────────────────────────────────────────────────────────────
const graphName = ref('未命名编排')
const currentId = ref('')
const currentVersion = ref(0)
const config = ref<GraphConfigSpec>({ ...DEFAULT_CONFIG })

const templates = ref<GraphSpec[]>([])
const savedGraphs = ref<GraphSummary[]>([])
// 节点级模型覆盖可选的模型清单（来自 AI 设置的路由模型目录）
const availableModels = ref<RoutingModel[]>([])
const pickTemplate = ref('')
const pickSaved = ref('')
// AI 生成编排（自然语言 → GraphSpec）
const nlOpen = ref(false)
const nlText = ref('')
const nlBusy = ref(false)
const nlExamples = [
  '查云南次日现货行情和价格预测（两个分析并行），汇总给申报策略师生成草稿，最后人工审批',
  '并行采集披露公告与查统调负荷，由市场分析师研判后生成复盘报告',
  '对多个目标日做批量行情分析（map 扇出），再统一汇总成决策报告'
]

const nodeCount = computed(() => vfNodes.value.length)
const edgeCount = computed(() => vfEdges.value.length)
const hasNodes = computed(() => vfNodes.value.length > 0)

let nodeSeq = 1
let edgeSeq = 1

// ── 节点面板 ────────────────────────────────────────────────────────────────
type PaletteItem = { kind: NodeType; role?: string; icon: string; name: string; desc: string }
const PALETTE: PaletteItem[] = [
  { kind: 'start', icon: '▶', name: '开始', desc: '流程起点' },
  { kind: 'agent', role: 'market_analyst', icon: '◆', name: '智能体节点', desc: '角色子智能体' },
  { kind: 'tool', icon: '⚙', name: '数据工具', desc: '确定性取数·不耗token' },
  { kind: 'map', role: 'market_analyst', icon: '⛶', name: '动态扇出', desc: '批量并行(Send)' },
  { kind: 'condition', icon: '◇', name: '条件分支', desc: '按上下文择路/循环' },
  { kind: 'approval', icon: '⚑', name: '人工审批', desc: '挂起等待确认' },
  { kind: 'report', role: 'supervisor', icon: '▤', name: '汇总报告', desc: '流式 Markdown 报告' },
  { kind: 'end', icon: '■', name: '结束', desc: '流程终点' }
]

// tool 节点工具目录（挂载时拉取）
const toolCatalog = ref<ToolCatalogItem[]>([])
const selectedToolMeta = computed(() =>
  toolCatalog.value.find((t) => t.name === selNode.value?.data.tool))
// 模板占位提示（用常量避免被 Vue 当成插值）
const TPL_HINT = '字符串参数支持占位: {{task}} {{today}} {{tomorrow}} {{yesterday}} {{week_ago}} {{month}}'
const MAP_ITEM_HINT = '每项用 Send 并行跑一个 worker 子智能体；子任务里用 {{item}} 注入当前项。'

function kindLabel(k: NodeType): string {
  return PALETTE.find((p) => p.kind === k)?.name || k
}
function hasRole(k: NodeType): boolean {
  // condition 的路由判定固定用 supervisor 模型，无需角色选择
  return k === 'agent' || k === 'report' || k === 'map'
}
function hasTask(k: NodeType): boolean {
  return k === 'agent' || k === 'report' || k === 'condition' || k === 'approval' || k === 'map'
}
function taskPlaceholder(k: NodeType): string {
  if (k === 'condition') return '说明判定标准，路由器据此在带标签出边里择一(如:信息充分走『充分』,否则走『补充』)'
  if (k === 'approval') return '向审批人提出的问题(如:申报草稿是否批准提交?)'
  if (k === 'map') return '每个并行项的子任务,用 {{item}} 注入当前项(如:分析{{item}}省现货特征)'
  return '该节点要做什么(留空则用角色默认职责)'
}

function makeNode(p: PaletteItem, pos: { x: number; y: number }) {
  const id = `n_${nodeSeq++}`
  return {
    id,
    type: 'studio',
    position: pos,
    data: {
      kind: p.kind,
      label: p.name === '智能体节点' ? (roleMeta(p.role)?.name ?? '智能体') : p.name,
      role: p.role ?? null,
      task: '',
      tool: null as string | null,
      args: {} as Record<string, unknown>,
      items: [] as unknown[],
      runStatus: '' as const
    }
  }
}

function addFromPalette(p: PaletteItem) {
  const pos = { x: 120 + (nodeSeq % 5) * 60, y: 80 + (nodeSeq % 7) * 50 }
  addNodes(makeNode(p, pos))
}

let dragItem: PaletteItem | null = null
function onDragStart(ev: DragEvent, p: PaletteItem) {
  dragItem = p
  ev.dataTransfer!.effectAllowed = 'move'
}
function onDrop(ev: DragEvent) {
  if (!dragItem) return
  const pos = screenToFlowCoordinate({ x: ev.clientX, y: ev.clientY })
  addNodes(makeNode(dragItem, pos))
  dragItem = null
}

// ── 连线 ────────────────────────────────────────────────────────────────────
onConnect((conn: Connection) => {
  addEdges({
    ...conn,
    id: `e_${edgeSeq++}`,
    label: '',
    markerEnd: MarkerType.ArrowClosed
  })
})

// ── 选中与检查器 ───────────────────────────────────────────────────────────
const selNodeId = ref('')
const selEdgeId = ref('')
const selNode = computed(() => vfNodes.value.find((n) => n.id === selNodeId.value) || null)
const selEdge = computed(() => vfEdges.value.find((e) => e.id === selEdgeId.value) || null)

function onNodeClick(e: { node: { id: string } }) {
  selNodeId.value = e.node.id
  selEdgeId.value = ''
}
function onEdgeClick(e: { edge: { id: string } }) {
  selEdgeId.value = e.edge.id
  selNodeId.value = ''
}
function onPaneClick() {
  selNodeId.value = ''
  selEdgeId.value = ''
}
// v-model 直接绑定 selNode.data.*，更新即生效;此函数仅触发响应(占位语义清晰)
function syncNode() { /* selNode 为 store 内对象,v-model 已实时生效 */ }
function syncEdgeLabel() { /* selEdge.label 为 store 内对象,v-model 已实时生效 */ }

function edgeEndsLabel(e: { source: string; target: string }): string {
  const s = vfNodes.value.find((n) => n.id === e.source)?.data?.label || e.source
  const t = vfNodes.value.find((n) => n.id === e.target)?.data?.label || e.target
  return `${s} → ${t}`
}

function deleteSelected() {
  if (selNodeId.value) {
    removeNodes(selNodeId.value)
    selNodeId.value = ''
  } else if (selEdgeId.value) {
    removeEdges(selEdgeId.value)
    selEdgeId.value = ''
  }
}

// 复制选中节点(偏移放置,清运行态/校验态)
function duplicateNode() {
  const src = selNode.value
  if (!src) return
  const id = `n_${nodeSeq++}`
  const data = JSON.parse(JSON.stringify({ ...src.data, runStatus: '', issue: '', issueMsg: '' }))
  addNodes({ id, type: 'studio', position: { x: (src.position?.x ?? 0) + 48, y: (src.position?.y ?? 0) + 48 }, data })
  selNodeId.value = id
}

// ── 内联校验:实时把问题标到画布节点(红=阻断/黄=提示),不依赖后端 ──
function computeAndApplyIssues() {
  const ns = vfNodes.value
  const outc: Record<string, number> = {}
  const inc: Record<string, number> = {}
  ns.forEach((n) => { outc[n.id] = 0; inc[n.id] = 0 })
  vfEdges.value.forEach((e) => {
    if (outc[e.source] != null) outc[e.source]++
    if (inc[e.target] != null) inc[e.target]++
  })
  for (const n of ns) {
    const k = n.data.kind as NodeType
    let level: 'error' | 'warn' | '' = ''
    let msg = ''
    if (k === 'start' && outc[n.id] === 0) { level = 'error'; msg = '开始节点未连出任何边' }
    else if (k === 'end' && inc[n.id] === 0) { level = 'warn'; msg = '结束节点无入边,不会到达' }
    else if (k === 'tool' && !n.data.tool) { level = 'error'; msg = '未选择数据工具' }
    else if (k === 'map' && !(Array.isArray(n.data.items) && n.data.items.length)) { level = 'error'; msg = '未配置批处理项(items)' }
    else if ((k === 'agent' || k === 'report') && !n.data.role) { level = 'warn'; msg = '未指定角色,将用默认' }
    else if (k === 'condition' && outc[n.id] < 2) { level = 'warn'; msg = '条件节点出边少于 2 条' }
    else if (k !== 'start' && k !== 'end' && outc[n.id] === 0) { level = 'warn'; msg = '无出边,执行后即结束' }
    if (n.data.issue !== level || n.data.issueMsg !== msg) updateNodeData(n.id, { issue: level, issueMsg: msg })
  }
}
// 监听结构变化(不含 issue 自身,避免回环)实时重算
watch(
  () => vfNodes.value.map((n) => `${n.id}:${n.data.kind}:${n.data.role ?? ''}:${n.data.tool ?? ''}:${(n.data.items as unknown[] | undefined)?.length ?? 0}`).join('|')
    + '#' + vfEdges.value.map((e) => `${e.source}>${e.target}`).join('|'),
  () => computeAndApplyIssues(),
  { flush: 'post' }
)
const issueCount = computed(() => vfNodes.value.filter((n) => n.data.issue === 'error').length)

// ── 模板 / 保存 / 加载 ───────────────────────────────────────────────────────
function specToFlow(spec: GraphSpec) {
  const fnodes = spec.nodes.map((n, i) => ({
    id: n.id,
    type: 'studio',
    position: n.position || { x: 100 + i * 150, y: 120 + (i % 3) * 120 },
    data: {
      kind: n.type, label: n.label || '', role: n.role ?? null, task: n.task || '',
      tool: n.tool ?? null, args: n.args ?? {},
      items: n.type === 'map' ? ((n.args?.items as unknown[]) ?? []) : [],
      modelRef: ((n.data as Record<string, unknown> | undefined)?.model_ref as string) ?? null,
      runStatus: '' as const
    }
  }))
  const fedges = spec.edges.map((e, i) => ({
    id: e.id || `e_${i}`,
    source: e.source,
    target: e.target,
    label: e.label || '',
    markerEnd: MarkerType.ArrowClosed
  }))
  setNodes(fnodes)
  setEdges(fedges)
  // 重置序号到不冲突
  nodeSeq = fnodes.length + 1
  edgeSeq = fedges.length + 1
  selNodeId.value = ''
  selEdgeId.value = ''
  setTimeout(() => fitView({ padding: 0.2 }), 60)
}

function flowToSpec(): GraphSpec {
  const obj = toObject()
  return {
    id: currentId.value || undefined,
    name: graphName.value.trim() || '未命名编排',
    description: '',
    config: { ...config.value },
    nodes: obj.nodes.map((n: any) => ({
      id: n.id,
      type: n.data.kind as NodeType,
      label: n.data.label || '',
      role: hasRole(n.data.kind) ? (n.data.role ?? null) : null,
      task: n.data.task || '',
      tool: n.data.kind === 'tool' ? (n.data.tool ?? null) : null,
      args: n.data.kind === 'tool'
        ? (n.data.args ?? {})
        : n.data.kind === 'map'
          ? { items: n.data.items ?? [] }
          : {},
      // 节点级模型覆盖（工作室「节点配置」选的模型）经 data.model_ref 下传后端
      data: n.data.modelRef ? { model_ref: n.data.modelRef } : {},
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }
    })),
    edges: obj.edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target, label: e.label || '' }))
  }
}

async function loadTemplates() {
  try {
    templates.value = await fetchTemplates()
  } catch {
    /* 后端离线时模板下拉为空,不阻塞 */
  }
}
async function refreshSaved() {
  try {
    savedGraphs.value = await listGraphs()
  } catch {
    /* 忽略 */
  }
}

function onPickTemplate(id: string) {
  const t = templates.value.find((x) => x.id === id)
  if (!t) return
  graphName.value = t.name.replace(/（复制自当前编排）/, '') + ' · 副本'
  currentId.value = ''
  currentVersion.value = 0
  config.value = { ...DEFAULT_CONFIG, ...(t.config || {}) }
  specToFlow(t)
  pickTemplate.value = ''
  validation.value = null
  ElMessage.success('已复制模板到画布，可自由改连线')
}

async function generateFromNl() {
  const desc = nlText.value.trim()
  if (desc.length < 4) return
  nlBusy.value = true
  try {
    const name = graphName.value && graphName.value !== '未命名编排' ? graphName.value : ''
    const r = await generateGraphFromNl(desc, name)
    if (!r.ok || !r.spec) {
      ElMessage.error(`生成失败：${r.msg || '请确认已在「AI 设置」配置模型密钥'}`)
      return
    }
    graphName.value = r.spec.name || 'AI 生成编排'
    currentId.value = ''
    currentVersion.value = 0
    config.value = { ...DEFAULT_CONFIG, ...(r.spec.config || {}) }
    specToFlow(r.spec)
    validation.value = r.validation ?? null
    nlOpen.value = false
    nlText.value = ''
    const warns = r.validation?.warnings?.length ? `，${r.validation.warnings.length} 条提示待确认` : ''
    ElMessage.success(`已生成并渲染到画布${warns}，可自由微调后运行`)
  } catch (e) {
    ElMessage.error(`生成失败：${(e as Error).message}`)
  } finally {
    nlBusy.value = false
  }
}

async function onPickSaved(id: string) {
  try {
    const rec = await getGraph(id)
    graphName.value = rec.name
    currentId.value = rec.id
    currentVersion.value = rec.version
    config.value = { ...DEFAULT_CONFIG, ...(rec.spec.config || {}) }
    specToFlow(rec.spec)
    validation.value = null
    pickSaved.value = ''
  } catch (e) {
    ElMessage.error(`加载失败：${(e as Error).message}`)
  }
}

function newBlank() {
  graphName.value = '未命名编排'
  currentId.value = ''
  currentVersion.value = 0
  config.value = { ...DEFAULT_CONFIG }
  setNodes([])
  setEdges([])
  nodeSeq = 1
  edgeSeq = 1
  selNodeId.value = ''
  selEdgeId.value = ''
  validation.value = null
}

function duplicate() {
  currentId.value = ''
  currentVersion.value = 0
  graphName.value = graphName.value + ' · 副本'
  ElMessage.success('已转为新副本，保存后生成新图')
}

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    const spec = flowToSpec()
    const rec = currentId.value ? await updateGraph(currentId.value, spec) : await createGraph(spec)
    currentId.value = rec.id
    currentVersion.value = rec.version
    ElMessage.success(`已保存 · v${rec.version}`)
    refreshSaved()
  } catch (e) {
    ElMessage.error(`保存失败：${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}

// ── 校验 ────────────────────────────────────────────────────────────────────
const validation = ref<ValidationResult | null>(null)
const validating = ref(false)
async function runValidate(): Promise<ValidationResult | null> {
  validating.value = true
  try {
    const v = await validateGraph(flowToSpec())
    validation.value = v
    selNodeId.value = ''
    selEdgeId.value = ''
    if (!v.ok) ElMessage.warning('校验发现阻断错误，请按右侧提示修正')
    else if (v.warnings.length) ElMessage.info(`校验通过,有 ${v.warnings.length} 条提示`)
    else ElMessage.success('校验通过')
    return v
  } catch (e) {
    ElMessage.error(`校验失败：${(e as Error).message}`)
    return null
  } finally {
    validating.value = false
  }
}

// ── 运行 ────────────────────────────────────────────────────────────────────
const runOpen = ref(false)
const task = ref('')
const phase = ref<'idle' | 'running' | 'awaiting' | 'done'>('idle')
const busy = computed(() => phase.value === 'running')
const minutes = ref<{ who: string; text: string; tone: string }[]>([])
const nodeOutputs = ref<Record<string, { label: string; role?: string; output: string }>>({})
const nodeMeta = ref<Record<string, { label: string; role?: string }>>({})
const streamingNodes = ref<Record<string, boolean>>({}) // 正在流式(未定稿)的节点
const reportText = ref('')
const runError = ref('')
const runErrorCode = ref('')
const pendingApproval = ref<Record<string, unknown> | null>(null)
const backendOnline = ref(false)

let sessionId = ''
let abort: AbortController | null = null
// 当前后台 run 的 id（sendAgentMessage 的 onRunId 回填）。PR #616 把发消息改成「POST 启动后台
// run + attach 读流」后，切页/卸载/重置只 abort 本地读取不会取消服务端 run——它会继续消耗模型/工具
// 并占住该会话单飞锁。需在 reset/unmount 时显式 stop，与 AgentChatPanel.stop() 对称。
let currentRunId: string | null = null
// 用户主动停止标志：onRunId 回调据此在拿到 runId 时补停（竞态窗口：POST 已发但 x-run-id 未返回）。
let stopping = false

const runTotal = computed(() => vfNodes.value.filter((n) => !['start', 'end'].includes(n.data.kind)).length)
const runDone = computed(() => vfNodes.value.filter((n) => n.data.runStatus === 'done').length)
const progText = computed(() => {
  const c = `${runDone.value}/${runTotal.value} 节点`
  if (phase.value === 'running') return `执行中… ${c}`
  if (phase.value === 'awaiting') return `等待审批 · ${c}`
  if (phase.value === 'done') return `已完成 · ${c}`
  return ''
})
const approvalQuestion = computed(() => String((pendingApproval.value?.question as string) || '请确认是否继续'))
const approvalSummary = computed(() => {
  const s = pendingApproval.value?.summary
  return typeof s === 'string' ? s.slice(0, 1200) : ''
})

function openRun() {
  runOpen.value = true
}
function closeRun() {
  runOpen.value = false
}
function pushMinute(who: string, tone: string, text: string) {
  minutes.value.push({ who, tone, text })
}
function stopBackgroundRun() {
  // 与 AgentChatPanel.stop() 对称：abort 只断本地读取，服务端后台 run 需显式 stop。
  // 主路径：已拿到 runId → 直接 stopAgentRun。竞态兜底：POST 已发但 x-run-id 未返回时
  // currentRunId 仍为 null，延迟查 active-run 补停（onRunId 在 abort 砍掉 headers 时不触发）。
  const sid = sessionId
  const rid = currentRunId
  stopping = true
  if (sid && rid) {
    void stopAgentRun(sid, rid).catch((err) => console.warn('[studio] 停止后台 run 失败', err))
  } else if (sid) {
    window.setTimeout(() => {
      if (!stopping) return // 已开启新一轮，别误杀新 run
      void getActiveRun(sid)
        .then((run) => (run && run.status === 'running' ? stopAgentRun(sid, run.run_id) : undefined))
        .catch(() => undefined)
    }, 600)
  }
}

function resetRun() {
  stopBackgroundRun()
  abort?.abort()
  abort = null
  sessionId = ''
  currentRunId = null
  stopping = false
  minutes.value = []
  nodeOutputs.value = {}
  nodeMeta.value = {}
  streamingNodes.value = {}
  reportText.value = ''
  runError.value = ''
  runErrorCode.value = ''
  pendingApproval.value = null
  // 清节点运行态
  vfNodes.value.forEach((n) => updateNodeData(n.id, { runStatus: '' }))
  vfEdges.value.forEach((e) => (e.animated = false))
}

async function startRun(t?: string) {
  const q = (t ?? task.value).trim()
  if (!q || busy.value) return
  task.value = q
  resetRun()

  if (!backendOnline.value) {
    backendOnline.value = await pingAgentService()
  }
  if (!backendOnline.value) {
    runError.value = '智能体后端未启动（npm run dev:agent-api 并 install:agent-api）。'
    return
  }

  phase.value = 'running'
  pushMinute('调度中枢', 'orch', '已编译编排图，开始按图执行…')
  try {
    const run = await createGraphRun({ spec: flowToSpec(), title: graphName.value })
    sessionId = run.id
    validation.value = run.validation
    abort = new AbortController()
    const myAbort = abort // 捕获本次运行控制器：被重置/停止取代时据此判定
    const region = packageRegionSummary()
    await sendAgentMessage(sessionId, q, onEvent, {
      signal: myAbort.signal,
      payload: region,
      onRunId: (runId) => {
        currentRunId = runId
        // 竞态补偿：用户在 x-run-id 返回前已点停止/切页/卸载 → 拿到 runId 立即补停后台 run。
        if (stopping && sessionId) void stopAgentRun(sessionId, runId).catch(() => undefined)
      }
    })
    if (myAbort.signal.aborted) return // 已被取代：不收尾、不持久化
    finishRun()
  } catch (e) {
    if (abort?.signal.aborted) return // 主动取消不算运行失败
    const msg = (e as Error).message
    runError.value = msg
    if (/recursion/i.test(msg)) runErrorCode.value = 'GRAPH_RECURSION_LIMIT'
    pushMinute('调度中枢', 'orch', `运行失败：${msg}`)
    phase.value = 'done'
  }
}

function onEvent(ev: AgentEvent) {
  if (ev.type === 'node_status') {
    updateNodeData(ev.node, { runStatus: ev.status })
    vfEdges.value.forEach((e) => {
      if (e.target === ev.node) e.animated = ev.status === 'running'
    })
    if (ev.status === 'running') {
      nodeMeta.value[ev.node] = { label: ev.label || ev.node, role: ev.role }
      pushMinute(ev.label || ev.node, 'agent', `▶ ${ev.label || ev.node} 执行中…${ev.note ? '（' + ev.note + '）' : ''}`)
    } else if (ev.note) pushMinute(ev.label || ev.node, 'orch', ev.note)
  } else if (ev.type === 'node_token') {
    // 子智能体思考过程实时流式（定稿前）
    const meta = nodeMeta.value[ev.node] || { label: ev.node }
    const cur = nodeOutputs.value[ev.node]
    if (!cur || !streamingNodes.value[ev.node]) {
      nodeOutputs.value[ev.node] = { label: meta.label, role: meta.role, output: ev.content }
      streamingNodes.value[ev.node] = true
    } else {
      cur.output += ev.content
    }
  } else if (ev.type === 'node_result') {
    // 定稿：用干净最终文本替换流式累积
    nodeOutputs.value[ev.node] = { label: ev.label || ev.node, role: ev.role, output: ev.output }
    streamingNodes.value[ev.node] = false
    pushMinute(ev.label || ev.node, 'agent', summarize(ev.output))
  } else if (ev.type === 'token') {
    reportText.value += ev.content
  } else if (ev.type === 'approval_request') {
    pendingApproval.value = ev.payload
    phase.value = 'awaiting'
    pushMinute('调度中枢', 'orch', '触发人工审批，等待确认…')
  } else if (ev.type === 'error') {
    runError.value = ev.message
    runErrorCode.value = ev.code || ''
    pushMinute('调度中枢', 'orch', `出错：${ev.message}`)
  } else if (ev.type === 'done') {
    /* finishRun 在流结束后统一处理 */
  }
}

function summarize(text: string): string {
  const flat = text.replace(/[#*`>\-]/g, '').replace(/\n+/g, ' ').trim()
  return flat.length > 90 ? flat.slice(0, 90) + '…' : flat
}

function finishRun() {
  if (pendingApproval.value) return // 等审批续流
  phase.value = 'done'
  vfEdges.value.forEach((e) => (e.animated = false))
  pushMinute('调度中枢', 'orch', '编排执行完成。')
  persistRun()
}

// 运行结束自动留存到历史（best-effort，不阻塞）
async function persistRun() {
  if (!reportText.value && !Object.keys(nodeOutputs.value).length) return
  try {
    await saveRun({
      graph_id: currentId.value || null,
      graph_name: graphName.value,
      task: task.value,
      status: runError.value ? 'error' : 'done',
      report: reportText.value,
      outputs: nodeOutputs.value
    })
  } catch {
    /* 留存失败不影响运行 */
  }
}

async function decideApproval(action: 'approve' | 'reject') {
  if (!pendingApproval.value || !sessionId) return
  pendingApproval.value = null
  phase.value = 'running'
  pushMinute('调度中枢', 'orch', action === 'approve' ? '已批准，继续执行。' : '已驳回。')
  try {
    abort = new AbortController()
    await sendAgentApproval(sessionId, action, onEvent, {
      signal: abort.signal,
      onRunId: (runId) => {
        currentRunId = runId
        if (stopping && sessionId) void stopAgentRun(sessionId, runId).catch(() => undefined)
      }
    })
    finishRun()
  } catch (e) {
    pushMinute('调度中枢', 'orch', `审批续流失败：${(e as Error).message}`)
    finishRun()
  }
}

function bumpRecursion() {
  const rec = validation.value?.recommended_recursion_limit
  config.value.recursion_limit = Math.max(config.value.recursion_limit * 2, rec || config.value.recursion_limit + 40)
  ElMessage.success(`递归上限已调高到 ${config.value.recursion_limit}，可重新运行`)
}

// ── tool 节点参数 JSON 编辑 ─────────────────────────────────────────────────
const argsError = ref('')
const argsText = computed<string>({
  get() {
    const a = selNode.value?.data.args
    return a && Object.keys(a).length ? JSON.stringify(a, null, 2) : '{}'
  },
  set(v: string) {
    if (!selNode.value) return
    try {
      const parsed = v.trim() ? JSON.parse(v) : {}
      if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('需为对象')
      selNode.value.data.args = parsed
      argsError.value = ''
    } catch (e) {
      argsError.value = `JSON 格式错误：${(e as Error).message}`
    }
  }
})
function fillToolArgs() {
  // 选工具后用其参数名预填空模板，便于填写
  if (!selNode.value || !selectedToolMeta.value) return
  const cur = selNode.value.data.args || {}
  const next: Record<string, unknown> = { ...cur }
  for (const a of selectedToolMeta.value.args) if (!(a in next)) next[a] = ''
  selNode.value.data.args = next
}

// ── map 节点 items 编辑（每行一项） ─────────────────────────────────────────
const mapItemsText = computed<string>({
  get() {
    const items = selNode.value?.data.items
    return Array.isArray(items) ? items.map((x) => String(x)).join('\n') : ''
  },
  set(v: string) {
    if (!selNode.value) return
    selNode.value.data.items = v
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  }
})

// ── 自动布局（按从开始节点的层级横向排布） ───────────────────────────────────
function autoLayout() {
  const ns = vfNodes.value
  const es = vfEdges.value
  if (!ns.length) return
  const adj: Record<string, string[]> = {}
  const indeg: Record<string, number> = {}
  ns.forEach((n) => { adj[n.id] = []; indeg[n.id] = 0 })
  es.forEach((e) => { if (adj[e.source]) { adj[e.source].push(e.target); indeg[e.target] = (indeg[e.target] || 0) + 1 } })
  // 层级 = 从起点的最长路径（Kahn 拓扑 + 取 max 深度，回边忽略）
  const depth: Record<string, number> = {}
  ns.forEach((n) => (depth[n.id] = 0))
  const queue = ns.filter((n) => indeg[n.id] === 0).map((n) => n.id)
  const seen = new Set<string>()
  const indegCopy = { ...indeg }
  while (queue.length) {
    const u = queue.shift()!
    if (seen.has(u)) continue
    seen.add(u)
    for (const v of adj[u] || []) {
      depth[v] = Math.max(depth[v], depth[u] + 1)
      indegCopy[v] -= 1
      if (indegCopy[v] <= 0) queue.push(v)
    }
  }
  const byLayer: Record<number, string[]> = {}
  ns.forEach((n) => { const d = depth[n.id] || 0; (byLayer[d] ||= []).push(n.id) })
  const COL = 220, ROW = 130
  ns.forEach((n) => {
    const d = depth[n.id] || 0
    const idx = byLayer[d].indexOf(n.id)
    n.position = { x: 80 + d * COL, y: 80 + idx * ROW }
  })
  setTimeout(() => fitView({ padding: 0.2 }), 60)
  ElMessage.success('已自动布局')
}

// ── 导出 / 导入 JSON ────────────────────────────────────────────────────────
function exportJson() {
  const spec = flowToSpec()
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(graphName.value || 'orchestration').replace(/\s+/g, '_')}.json`
  a.click()
  URL.revokeObjectURL(url)
}
const importInput = ref<HTMLInputElement>()
function triggerImport() {
  importInput.value?.click()
}
function onImportFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const spec = JSON.parse(String(reader.result)) as GraphSpec
      if (!Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) throw new Error('缺少 nodes/edges')
      graphName.value = spec.name || '导入的编排'
      currentId.value = ''
      currentVersion.value = 0
      config.value = { ...DEFAULT_CONFIG, ...(spec.config || {}) }
      specToFlow(spec)
      validation.value = null
      ElMessage.success('已导入编排图')
    } catch (e) {
      ElMessage.error(`导入失败：${(e as Error).message}`)
    }
  }
  reader.readAsText(file)
  ;(ev.target as HTMLInputElement).value = ''
}

// ── 报告 / 产出导出 ─────────────────────────────────────────────────────────
function exportReport() {
  const parts: string[] = [`# ${graphName.value} · 运行报告`, '', `> 任务：${task.value || '(无)'}`, '']
  for (const o of Object.values(nodeOutputs.value)) {
    parts.push(`## ${o.label}`, '', o.output, '')
  }
  if (reportText.value) parts.push('## 汇总报告', '', reportText.value)
  const blob = new Blob([parts.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(graphName.value || 'report').replace(/\s+/g, '_')}_报告.md`
  a.click()
  URL.revokeObjectURL(url)
}
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败,请手动选择')
  }
}

// ── 运行历史 ────────────────────────────────────────────────────────────────
const historyOpen = ref(false)
const runHistory = ref<RunSummary[]>([])
async function openHistory() {
  historyOpen.value = true
  try {
    runHistory.value = await listRuns(50)
  } catch (e) {
    ElMessage.error(`加载历史失败：${(e as Error).message}`)
  }
}
async function reopenRun(id: string) {
  try {
    const rec = await getRun(id)
    runOpen.value = true
    historyOpen.value = false
    phase.value = 'done'
    minutes.value = [{ who: '历史回看', tone: 'orch', text: `任务：${rec.task}` }]
    nodeOutputs.value = rec.outputs || {}
    reportText.value = rec.report || ''
    pendingApproval.value = null
    runError.value = ''
    ElMessage.success('已载入历史运行结果')
  } catch (e) {
    ElMessage.error(`载入失败：${(e as Error).message}`)
  }
}
async function removeRun(id: string) {
  try {
    await deleteRun(id)
    runHistory.value = runHistory.value.filter((r) => r.id !== id)
  } catch (e) {
    ElMessage.error(`删除失败：${(e as Error).message}`)
  }
}
function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}

// ── 生命周期 ───────────────────────────────────────────────────────────────
onMounted(async () => {
  getRouting().then((r) => { availableModels.value = r.models }).catch(() => { /* 后端离线时无模型列表，节点用角色默认 */ })
  await loadTemplates()
  await refreshSaved()
  try {
    toolCatalog.value = await fetchToolCatalog()
  } catch {
    /* 后端离线时工具下拉为空 */
  }
  backendOnline.value = await pingAgentService()
  // 首次进入:若有业务链模板,自动复制一份方便上手
  if (templates.value.length && !hasNodes.value) {
    onPickTemplate('tpl_supervisor_chain')
  }
})
onBeforeUnmount(() => {
  // 卸载（切页）时显式停止后台 run：PR #616 后 abort 只断读流，服务端 run 会继续跑并占住
  // 会话单飞锁，工作室又没有 attach 恢复路径——不补停会卡住该会话直到自然结束。
  stopBackgroundRun()
  abort?.abort()
})
</script>

<style scoped>
.st-root {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 64px);
  background: var(--bg);
  color: var(--text);
  box-sizing: border-box;
}

/* 顶栏 */
.st-top {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  background: var(--panel-image), var(--panel);
  border-bottom: 1px solid var(--line);
}
.st-top-l { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.st-name {
  font-size: var(--font-16);
  font-weight: 600;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 4px 8px;
  font-family: inherit;
  outline: none;
  max-width: 320px;
}
.st-name:hover, .st-name:focus { border-color: var(--line); background: var(--panel-sub); }
.st-meta { font-size: var(--font-11-5); color: var(--muted); }
.st-meta.dirty { color: var(--accent); }
.st-top-r { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.st-sel { width: 132px; }

.st-cfg { display: flex; flex-direction: column; gap: 10px; }
.st-cfg-title { font-size: var(--font-md); font-weight: 600; color: var(--text); }
.st-cfg label { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-sm); color: var(--text-body); }
.st-cfg-tip { font-size: var(--font-xs); color: var(--muted); line-height: 1.6; margin: 2px 0 0; }

/* 主区 */
.st-main { flex: 1; min-height: 0; display: grid; grid-template-columns: 196px 1fr 296px; }

.st-palette {
  border-right: 1px solid var(--line);
  padding: 12px 10px;
  overflow: auto;
  background: var(--panel-image), var(--panel);
}
.st-pal-title { font-size: var(--font-sm); font-weight: 600; color: var(--muted); margin-bottom: 10px; letter-spacing: 0.5px; }
.st-pal-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  margin-bottom: 8px;
  border: 1px solid var(--line);
  border-radius: 9px;
  cursor: grab;
  background: var(--panel-sub);
  transition: border-color 0.15s, transform 0.15s;
}
.st-pal-item:hover { border-color: var(--primary); transform: translateY(-1px); }
.st-pal-item:active { cursor: grabbing; }
.st-pal-icon {
  flex: none; width: 28px; height: 28px; display: grid; place-items: center;
  border-radius: 7px; font-size: var(--font-lg); background: var(--primary-tint); color: var(--primary);
  font-family: var(--font-display);
}
.pi-condition { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
.pi-approval { background: color-mix(in srgb, #d97706 18%, transparent); color: #d97706; }
.pi-start, .pi-end { background: var(--surface-hover); color: var(--muted); }
.st-pal-text { min-width: 0; }
.st-pal-name { font-size: var(--font-12-5); font-weight: 600; color: var(--text); }
.st-pal-desc { font-size: var(--font-10-5); color: var(--muted); }
.st-pal-hint { margin-top: 14px; font-size: var(--font-xs); color: var(--muted); line-height: 1.7; }

/* 画布 */
.st-canvas { position: relative; min-width: 0; background: var(--bg); }
.st-canvas :deep(.vue-flow__edge-text) { font-size: var(--font-xs); fill: var(--text-body); }
.st-canvas :deep(.vue-flow__edge-textbg) { fill: var(--panel); }
.st-canvas :deep(.vue-flow__edge-path) { stroke: var(--line); stroke-width: 1.5; }
.st-canvas :deep(.vue-flow__edge.animated .vue-flow__edge-path) { stroke: var(--primary); }
.st-canvas :deep(.vue-flow__edge.selected .vue-flow__edge-path) { stroke: var(--primary); stroke-width: 2; }
.st-flow-legend { display: flex; gap: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 5px 10px; font-size: var(--font-xs); color: var(--muted); }
.st-flow-legend .lg { display: inline-flex; align-items: center; gap: 5px; }
.st-flow-legend .d { width: 8px; height: 8px; border-radius: 50%; }
.st-flow-legend .d.run { background: var(--primary); }
.st-flow-legend .d.done { background: var(--success); }
.st-empty {
  position: absolute; inset: 0; display: flex; flex-direction: column; gap: 12px;
  align-items: center; justify-content: center; color: var(--muted); pointer-events: none;
}
.st-empty * { pointer-events: auto; }

/* 检查器 */
.st-inspector {
  border-left: 1px solid var(--line);
  padding: 14px;
  overflow: auto;
  background: var(--panel-image), var(--panel);
}
.st-insp-title { font-size: var(--font-md); font-weight: 600; color: var(--text); margin-bottom: 12px; }
.st-insp-sub { font-size: var(--font-sm); color: var(--muted); margin: 0 0 10px; }
.st-insp-empty { font-size: var(--font-sm); color: var(--muted); line-height: 1.7; }
.st-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; font-size: var(--font-sm); color: var(--text-body); }
.st-stats { margin-top: 14px; font-size: var(--font-11-5); color: var(--muted); }
.st-stats-bad { color: var(--danger, #dc2626); font-weight: 600; }
.st-insp-acts { display: flex; gap: 8px; }

.st-valid { font-size: var(--font-sm); color: var(--text-body); }
.st-valid-row { margin-bottom: 6px; }
.st-valid-row.warn { color: var(--accent); }
.st-valid-list { margin: 8px 0; padding-left: 16px; font-size: var(--font-11-5); line-height: 1.6; }
.st-valid-list.err li { color: var(--danger, #dc2626); }
.st-valid-list.warn li { color: var(--accent); }
.st-arg-err { font-size: var(--font-11-5); color: var(--danger, #dc2626); margin: 4px 0 0; }

/* 运行历史抽屉 */
.st-hist-empty { color: var(--muted); font-size: var(--font-md); padding: 20px 0; text-align: center; }
.st-hist-item { display: flex; align-items: flex-start; gap: 8px; padding: 10px 8px; border-bottom: 1px solid var(--line-faint); }
.st-hist-main { flex: 1; min-width: 0; cursor: pointer; }
.st-hist-name { font-size: var(--font-md); font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px; }
.st-hist-badge { font-size: var(--font-10); padding: 1px 6px; border-radius: 4px; background: var(--primary-tint); color: var(--primary); font-weight: 400; }
.st-hist-badge.error { background: color-mix(in srgb, #dc2626 12%, transparent); color: #dc2626; }
.st-hist-task { font-size: var(--font-sm); color: var(--text-body); margin: 3px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-hist-time { font-size: var(--font-xs); color: var(--muted); }

/* 运行面板 */
.st-run {
  flex: none;
  height: 320px;
  border-top: 1px solid var(--primary);
  background: var(--panel-image), var(--panel);
  display: flex;
  flex-direction: column;
}
.st-run-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line-faint); }
.st-run-task { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.st-tag { flex: none; font-size: var(--font-sm); color: var(--ai-btn-fg); background: var(--primary); padding: 4px 10px; border-radius: 5px; letter-spacing: 1px; }
.st-task-in { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 6px; background: var(--panel-sub); padding: 7px 10px; font-size: var(--font-md); color: var(--text); outline: none; font-family: inherit; }
.st-run-prog { flex: none; font-size: var(--font-sm); color: var(--muted); }

.st-run-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 300px 1fr; gap: 0; }
.st-minutes { overflow: auto; padding: 12px 14px; border-right: 1px solid var(--line-faint); display: flex; flex-direction: column; gap: 8px; }
.st-col-title { font-size: var(--font-sm); font-weight: 600; color: var(--muted); letter-spacing: 0.5px; margin-bottom: 4px; }
.st-bubble { padding: 8px 11px; border-radius: 9px; background: var(--panel-sub); border: 1px solid var(--line-faint); }
.st-bubble .st-who { font-size: var(--font-11-5); font-weight: 600; color: var(--text); }
.st-bubble p { margin: 3px 0 0; font-size: var(--font-sm); line-height: 1.6; color: var(--text-body); }
.st-bubble.orch { border-color: var(--primary-tint-border); }

.st-outputs { overflow: auto; padding: 12px 16px; }
.st-out-card { margin-bottom: 10px; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
.st-out-card summary { cursor: pointer; padding: 8px 12px; font-size: var(--font-12-5); font-weight: 600; color: var(--text); background: var(--panel-sub); }
.st-out-card summary i { font-style: normal; font-weight: 400; color: var(--muted); font-size: var(--font-xs); margin-left: 6px; }
.st-out-card summary .st-copy { float: right; }
.st-out-card .md { padding: 10px 12px; }
.st-report { margin-top: 12px; padding: 14px; border: 1px solid var(--primary); border-radius: 10px; background: var(--primary-tint); }

.st-approval { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--accent); border-radius: 9px; background: var(--primary-tint); }
.st-appr-title { font-size: var(--font-12-5); font-weight: 600; color: var(--accent); }
.st-appr-q { font-size: var(--font-12-5); color: var(--text); margin: 6px 0; }
.st-appr-body { font-size: var(--font-xs); white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow: auto; color: var(--text-body); background: var(--panel); border-radius: 6px; padding: 8px; margin: 0 0 10px; }
.st-appr-acts { display: flex; gap: 10px; }

.st-error { margin-top: 12px; padding: 10px 14px; border: 1px solid var(--danger, #dc2626); border-radius: 9px; background: color-mix(in srgb, #dc2626 8%, transparent); font-size: var(--font-12-5); color: var(--text-body); }

/* markdown 容器 */
.md { font-size: var(--font-md); line-height: 1.75; color: var(--text-body); word-break: break-word; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) { font-size: var(--font-lg); margin: 12px 0 6px; color: var(--text); font-weight: 600; }
.md :deep(p) { margin: 6px 0; }
.md :deep(ul), .md :deep(ol) { padding-left: 20px; margin: 6px 0; }
.md :deep(li) { margin: 3px 0; }
.md :deep(table) { width: 100%; border-collapse: collapse; font-size: var(--font-sm); margin: 8px 0; }
.md :deep(th), .md :deep(td) { padding: 6px 9px; border: 1px solid var(--line-faint); text-align: left; }
.md :deep(th) { background: var(--panel-sub); color: var(--muted); font-weight: 600; }
.md :deep(code) { background: var(--surface-hover); padding: 1px 5px; border-radius: 4px; font-size: var(--font-sm); }
.md :deep(pre) { background: var(--panel-sub); border: 1px solid var(--line-faint); border-radius: 8px; padding: 10px 12px; overflow: auto; margin: 8px 0; }
.md :deep(pre code) { background: none; padding: 0; }
.md :deep(blockquote) { border-left: 3px solid var(--primary); padding-left: 12px; margin: 8px 0; color: var(--muted); }
.md :deep(a) { color: var(--primary); }
.md :deep(.md-task) { margin-right: 4px; }

.st-run-enter-active, .st-run-leave-active { transition: height 0.25s ease, opacity 0.25s; overflow: hidden; }
.st-run-enter-from, .st-run-leave-to { height: 0; opacity: 0; }

@media (max-width: 1180px) {
  .st-main { grid-template-columns: 170px 1fr 240px; }
  .st-run-body { grid-template-columns: 1fr; }
  .st-minutes { display: none; }
}

@media (max-width: 768px) {
  .st-main { grid-template-columns: 1fr; }
  .st-palette { border-right: 0; border-bottom: 1px solid var(--line); }
  .st-inspector { border-left: 0; border-top: 1px solid var(--line); }
}

/* AI 生成编排对话框 */
.nl-tip { margin: 0 0 12px; font-size: var(--font-12-5); line-height: 1.6; color: var(--el-text-color-secondary); }
.nl-egs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 10px; }
.nl-eg-label { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
</style>
