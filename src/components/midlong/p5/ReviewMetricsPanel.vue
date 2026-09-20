<script setup lang="ts">
// 复盘指标面板（dljy#3016，MR-01/02/06）：复盘页的实时指标与报告版本冻结快照共用同一渲染。
// 红线：只陈述中长期量价事实——计划完成（P3 口径）、成交量价（同口径分组、不可比分列不排名）、
// 对手方/方式分布（按电量事实分组）、绿电价格组成（310=300+10 不重复加）、未成交/错过窗口/变更/资料缺口
// 明确列出、三种金额分离（无凭证不显示到账、未独立复算）。不出现现货择时收益/套保收益/实际利润等结论。
import MidlongNotice from '../MidlongNotice.vue'
import { fmtAmount, fmtQuantity, fmtRatio } from '@/services/midlong/midlongFormat'
import { PRICE_COMPONENT_LABELS, REVISION_KIND_LABELS, TAX_BASIS_LABELS, TRADE_METHOD_LABELS } from '@/services/midlong/midlongTypes'
import { PLAN_VERIFICATION_STATUS_LABELS } from '@/services/midlong/midlongP3Types'
import { beijingDateTime } from '@/services/midlong/midlongP3Format'
import { greenCompositionLabel, greenUnitLine, recomputeStatusLabel, settlementAmountRows } from '@/services/midlong/midlongP5Format'
import type { ReviewMetrics, ReviewPriceGroupRow } from '@/services/midlong/midlongP5Types'

const props = defineProps<{ metrics: ReviewMetrics }>()

const verificationLabel = (status: string) => PLAN_VERIFICATION_STATUS_LABELS[status as keyof typeof PLAN_VERIFICATION_STATUS_LABELS] ?? status
const remainingText = (row: ReviewMetrics['planCompletion'][number]) =>
  row.remainingPlanQuantity === null ? (row.verificationStatus === 'TARGET_UNKNOWN' ? '目标未确认' : '待核验（不按零计）') : `${fmtQuantity(row.remainingPlanQuantity)} MWh`
const completionText = (row: ReviewMetrics['planCompletion'][number]) =>
  row.completionRate !== null ? fmtRatio(row.completionRate) : (row.verificationStatus === 'TARGET_UNKNOWN' ? '目标未确认' : '待核验（不按零计）')

const groupLabel = (g: ReviewPriceGroupRow) =>
  `${g.currency} · ${TAX_BASIS_LABELS[g.taxBasis as keyof typeof TAX_BASIS_LABELS] ?? g.taxBasis} · ${PRICE_COMPONENT_LABELS[g.priceComponent as keyof typeof PRICE_COMPONENT_LABELS] ?? g.priceComponent}`
const tradeMethodLabel = (key: string) => TRADE_METHOD_LABELS[key as keyof typeof TRADE_METHOD_LABELS] ?? key
const revisionKindLabel = (kind: string) => REVISION_KIND_LABELS[kind as keyof typeof REVISION_KIND_LABELS] ?? kind

const settlementRows = () => settlementAmountRows(props.metrics.settlement)
</script>

<template>
  <div class="p5-metrics" data-test="review-metrics">
    <div class="p5-muted">
      计算口径：{{ metrics.caliber.positions }}；{{ metrics.caliber.priceGroups }}；{{ metrics.caliber.amounts }}。
      覆盖 {{ metrics.view === 'AS_OF' ? `asOf=${beijingDateTime(metrics.asOf)}` : '当前视图' }}；
      输入引用：合同 {{ metrics.inputs.contracts }} · 计划 {{ metrics.inputs.plans }} · 成交确认 {{ metrics.inputs.confirmations }} · 账单 {{ metrics.inputs.bills }}。
    </div>
    <MidlongNotice v-for="notice in metrics.notices" :key="notice" tone="info">{{ notice }}</MidlongNotice>

    <div class="p5-section">
      <h4>计划完成（P3 计划口径，只读）</h4>
      <el-table v-if="metrics.planCompletion.length" :data="metrics.planCompletion" border size="small">
        <el-table-column label="计划" min-width="160"><template #default="{ row }">#{{ row.planId }} {{ row.periodKey }}（{{ row.periodType === 'YEAR' ? '年度' : '月度' }}）<template v-if="row.subjectName"> · {{ row.subjectName }}</template></template></el-table-column>
        <el-table-column label="确认版本" width="90" align="center"><template #default="{ row }">{{ row.confirmedRevisionNo === null ? '未确认' : `v${row.confirmedRevisionNo}` }}</template></el-table-column>
        <el-table-column label="目标(MWh)" width="110" align="right"><template #default="{ row }">{{ fmtQuantity(row.targetQuantity) }}</template></el-table-column>
        <el-table-column label="已售(MWh)" width="110" align="right"><template #default="{ row }">{{ fmtQuantity(row.knownSoldQuantity) }}{{ row.soldComplete ? '' : '（下限）' }}</template></el-table-column>
        <el-table-column label="剩余待售(MWh)" width="130" align="right"><template #default="{ row }">{{ remainingText(row) }}</template></el-table-column>
        <el-table-column label="完成率" width="100" align="right"><template #default="{ row }">{{ completionText(row) }}</template></el-table-column>
        <el-table-column label="核验" width="90"><template #default="{ row }"><el-tag size="small" :type="row.verificationStatus === 'VERIFIED' ? 'success' : 'info'" effect="plain">{{ verificationLabel(row.verificationStatus) }}</el-tag></template></el-table-column>
        <el-table-column label="超计划" width="80" align="center"><template #default="{ row }"><el-tag v-if="row.overPlan" size="small" type="warning">超计划</el-tag><span v-else class="p5-muted">—</span></template></el-table-column>
        <template #empty>该月无确认目标（计划完成显示为空，不按零计）。</template>
      </el-table>
      <div v-else class="p5-muted">该月无确认目标（计划完成显示为空，不按零计）。</div>
    </div>

    <div class="p5-section">
      <h4>成交量价（P1 持仓口径，同口径分组）</h4>
      <div class="p5-row">
        正式分解 {{ fmtQuantity(metrics.tradedVolumePrice.formalQuantity) }} MWh · {{ metrics.tradedVolumePrice.contractCount }} 份合同
        <el-tag v-if="metrics.tradedVolumePrice.incomplete" size="small" type="warning">另有未分解</el-tag>
        <span class="p5-muted">已知价格电量 {{ fmtQuantity(metrics.tradedVolumePrice.price.knownPriceQuantity) }} MWh · 未知价格电量 {{ fmtQuantity(metrics.tradedVolumePrice.price.unknownPriceQuantity) }} MWh</span>
      </div>
      <el-table :data="metrics.tradedVolumePrice.price.groups" border size="small" data-test="price-groups">
        <el-table-column label="口径分组" min-width="220"><template #default="{ row }">{{ groupLabel(row) }}</template></el-table-column>
        <el-table-column label="已知价格电量(MWh)" width="150" align="right"><template #default="{ row }">{{ fmtQuantity(row.knownQuantity) }}</template></el-table-column>
        <el-table-column label="名义金额(元)" width="130" align="right"><template #default="{ row }">{{ fmtAmount(row.notionalAmount) }}</template></el-table-column>
        <el-table-column label="分组均价(元/MWh)" width="140" align="right"><template #default="{ row }">{{ row.averagePrice === null ? '无已知价格' : fmtQuantity(row.averagePrice) }}</template></el-table-column>
        <template #empty>该月无持仓。</template>
      </el-table>
      <div v-if="!metrics.tradedVolumePrice.price.comparable" class="p5-warn" data-test="price-not-comparable">{{ metrics.tradedVolumePrice.price.rankingNotice ?? '口径不可比：分组分列展示，不生成统一均价与排名。' }}</div>
      <div v-else-if="metrics.tradedVolumePrice.price.averagePrice !== null" class="p5-muted">
        单一可比分组：汇总均价 {{ fmtQuantity(metrics.tradedVolumePrice.price.averagePrice) }} 元/MWh，名义金额 {{ fmtAmount(metrics.tradedVolumePrice.price.notionalAmount) }} 元。
      </div>
    </div>

    <div class="p5-columns">
      <div class="p5-section">
        <h4>对手方分布（按电量事实分组）</h4>
        <el-table :data="metrics.counterpartyDistribution.rows" border size="small">
          <el-table-column label="对手方" min-width="140"><template #default="{ row }">{{ row.known ? row.key : `${row.key}（未登记）` }}</template></el-table-column>
          <el-table-column label="电量(MWh)" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
          <el-table-column label="合同数" width="80" align="right"><template #default="{ row }">{{ row.contractCount }}</template></el-table-column>
          <template #empty>该月无持仓。</template>
        </el-table>
      </div>
      <div class="p5-section">
        <h4>交易方式分布（按电量事实分组）</h4>
        <el-table :data="metrics.tradeMethodDistribution.rows" border size="small">
          <el-table-column label="方式" min-width="140"><template #default="{ row }">{{ row.known ? tradeMethodLabel(row.key) : '未知' }}</template></el-table-column>
          <el-table-column label="电量(MWh)" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
          <el-table-column label="合同数" width="80" align="right"><template #default="{ row }">{{ row.contractCount }}</template></el-table-column>
          <template #empty>该月无持仓。</template>
        </el-table>
      </div>
    </div>

    <div class="p5-section">
      <h4>绿电价格组成（MR-06）</h4>
      <template v-if="metrics.green.rows.length">
        <div v-for="row in metrics.green.rows" :key="row.contractId" class="p5-green" :data-test="`green-row-${row.contractId}`">
          <b>{{ row.contractName ?? `合同 #${row.contractId}` }}</b>（{{ row.externalContractNo ?? '编号待补' }} v{{ row.revisionNo }} · {{ greenCompositionLabel(row.composition) }}）
          <span class="p5-num">{{ greenUnitLine(row) }}</span>
          <span class="p5-num">电量 {{ fmtQuantity(row.quantity) }} MWh · 名义 {{ row.notionalAmount === null ? '未知' : `${fmtAmount(row.notionalAmount)} 元` }}（{{ row.currency }}）</span>
          <span v-for="gap in row.gaps" :key="gap" class="p5-warn">{{ gap }}</span>
        </div>
        <MidlongNotice v-if="metrics.green.notice" tone="info">{{ metrics.green.notice }}</MidlongNotice>
      </template>
      <div v-else class="p5-muted">该月无绿电合同持仓。</div>
      <MidlongNotice v-if="metrics.green.gaps.length" tone="warn" data-test="green-gaps">资料缺口：{{ metrics.green.gaps.map((g) => `合同 #${g.contractId} ${g.gap}`).join('；') }}</MidlongNotice>
    </div>

    <div class="p5-columns">
      <div class="p5-section">
        <h4>未成交（方案终态）</h4>
        <el-table :data="metrics.untraded.rows" border size="small">
          <el-table-column label="方案" width="80"><template #default="{ row }">#{{ row.proposalId }}</template></el-table-column>
          <el-table-column label="终态" width="90"><template #default="{ row }">{{ row.status }}</template></el-table-column>
          <el-table-column label="该月电量(MWh)" width="130" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantity) }}</template></el-table-column>
          <el-table-column label="负责人" min-width="100"><template #default="{ row }">{{ row.ownerName ?? '—' }}</template></el-table-column>
          <template #empty>无未成交方案。</template>
        </el-table>
      </div>
      <div class="p5-section">
        <h4>错过窗口（截止已过且未登记提交）</h4>
        <el-table :data="metrics.missedWindows.rows" border size="small">
          <el-table-column label="方案" width="80"><template #default="{ row }">#{{ row.proposalId }}</template></el-table-column>
          <el-table-column label="公告截止" min-width="150"><template #default="{ row }">{{ row.declarationClosesAt ? beijingDateTime(row.declarationClosesAt) : '未知' }}<template v-if="row.announcementName"> · {{ row.announcementName }}</template></template></el-table-column>
          <el-table-column label="该月电量(MWh)" width="120" align="right"><template #default="{ row }">{{ fmtQuantity(row.quantityInMonth) }}</template></el-table-column>
          <template #empty>无错过窗口。</template>
        </el-table>
      </div>
    </div>

    <div class="p5-section">
      <h4>变更统计（作用于该交割月）</h4>
      <div v-if="metrics.changes.rows.length" class="p5-row">
        <el-tag v-for="(count, kind) in metrics.changes.countByKind" :key="kind" size="small" effect="plain" :type="count > 0 ? 'warning' : 'info'">{{ revisionKindLabel(String(kind)) }} {{ count }}</el-tag>
      </div>
      <el-table :data="metrics.changes.rows" border size="small">
        <el-table-column label="合同" min-width="160"><template #default="{ row }"><router-link :to="`/zcqjy/contracts/${row.contractId}`" class="p5-link" @click.stop>合同 #{{ row.contractId }}</router-link></template></el-table-column>
        <el-table-column label="版本" width="80"><template #default="{ row }">v{{ row.revisionNo }} {{ revisionKindLabel(row.revisionKind) }}</template></el-table-column>
        <el-table-column label="登记时间" width="160"><template #default="{ row }">{{ beijingDateTime(row.recordedAt) }}</template></el-table-column>
        <el-table-column label="原因" min-width="180"><template #default="{ row }">{{ row.changeReason ?? '—' }}<template v-if="!row.scopeLocated">（未定位到该月，按全局列出）</template></template></el-table-column>
        <template #empty>该月无变更版本。</template>
      </el-table>
    </div>

    <div class="p5-section">
      <h4>资料缺口</h4>
      <div class="p5-row" data-test="data-gaps">
        <el-tag type="warning" size="small" effect="plain">未分解合同 {{ metrics.dataGaps.unallocatedContractCount }} 份 / {{ fmtQuantity(metrics.dataGaps.unallocatedQuantity) }} MWh</el-tag>
        <el-tag type="warning" size="small" effect="plain">未知价格电量 {{ fmtQuantity(metrics.dataGaps.unknownPriceQuantity) }} MWh</el-tag>
        <el-tag v-if="metrics.excluded.draftCount || metrics.excluded.pendingVerificationCount || metrics.excluded.voidedCount" type="info" size="small" effect="plain">
          排除在持仓外：草稿 {{ metrics.excluded.draftCount }} · 待核验 {{ metrics.excluded.pendingVerificationCount }} · 已作废 {{ metrics.excluded.voidedCount }}
        </el-tag>
      </div>
      <div v-if="metrics.dataGaps.contracts.length" class="p5-muted">
        合同质量缺口：{{ metrics.dataGaps.contracts.map((c) => `合同 #${c.contractId}（${c.flags.join('、')}）`).join('；') }}
      </div>
    </div>

    <div class="p5-section">
      <h4>三种金额（含义不同，不可相加或互相替代）</h4>
      <el-table :data="settlementRows()" border size="small" data-test="settlement-amounts">
        <el-table-column label="金额" min-width="150"><template #default="{ row }"><b>{{ row.title }}</b></template></el-table-column>
        <el-table-column label="数值" min-width="180"><template #default="{ row }"><span :data-test="`settlement-${row.key}`">{{ row.amountText }}</span></template></el-table-column>
        <el-table-column label="来源" min-width="200"><template #default="{ row }">{{ row.sourceLabel }}</template></el-table-column>
        <el-table-column label="覆盖" width="100"><template #default="{ row }">{{ row.coverageText }}</template></el-table-column>
        <el-table-column label="说明" min-width="200"><template #default="{ row }">{{ row.extra }}</template></el-table-column>
      </el-table>
      <div class="p5-muted" data-test="recompute-status">{{ recomputeStatusLabel(metrics.settlement.independentlyRecomputed) }}（{{ metrics.settlement.notice }}）</div>
    </div>
  </div>
</template>

<style scoped>
.p5-metrics { display: flex; flex-direction: column; gap: 12px; }
.p5-section { border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.p5-section h4 { margin: 0; font-size: var(--font-md); }
.p5-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.p5-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: var(--font-md); }
.p5-green { display: flex; flex-direction: column; gap: 2px; font-size: var(--font-md); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; }
.p5-num { font-variant-numeric: tabular-nums; font-size: var(--font-sm); color: var(--muted); }
.p5-muted { color: var(--muted); font-size: var(--font-sm); }
.p5-warn { color: var(--warning); font-size: var(--font-md); }
.p5-link { color: var(--accent); text-decoration: none; }
@media (max-width: 1100px) { .p5-columns { grid-template-columns: 1fr; } }
</style>
