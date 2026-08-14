<script setup lang="ts">
// 非云南地区访问 /dashboard 融合页时,云南现货数据区的降级空态卡。
// 融合页本身全地区可达(日程/主图/快捷任务全地区),仅七模块数据区(节点电价/损益/结算)
// 仅云南有真实数据。本卡诚实标注「仅云南试点」+ 给替代入口,不伪装有数据、不强阻断。
import { useRouter } from 'vue-router'
import { Gauge, ArrowRight } from 'lucide-vue-next'
import { currentRegion } from '@/services/region/regionContext'

const router = useRouter()
</script>

<template>
  <section class="panel region-locked">
    <div class="head">
      <Gauge :size="16" />
      <h3>现货数据驾驶舱 · 云南试点</h3>
      <el-tag type="info" size="small">仅云南</el-tag>
    </div>
    <p class="muted">
      当前地区为 <b>{{ currentRegion.name }}</b>,节点电价热力场、损益归因瀑布、申报偏差体检、
      持仓敞口等真实现货数据仅在<b>云南</b>地区试点。上方交易日程、价格主图与智能体快捷任务全地区可用。
    </p>
    <div class="actions">
      <button class="action" @click="router.push('/xhjy/region')">
        查看 {{ currentRegion.name }} 现货概览 <ArrowRight :size="13" />
      </button>
      <button class="action ghost" @click="router.push('/sdzl/region-rules')">
        地区规则体系 <ArrowRight :size="13" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.region-locked {
  padding: 16px 18px;
  border: 1px dashed var(--line);
  border-radius: 10px;
  background: var(--panel);
}
.region-locked .head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--primary);
}
.region-locked .head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
.region-locked .muted {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 12px;
}
.region-locked .muted b {
  color: var(--text);
  font-weight: 600;
}
.region-locked .actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.region-locked .action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  font-size: 13px;
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  transition: all 0.15s ease;
}
.region-locked .action:hover {
  background: var(--primary);
  color: #fff;
}
.region-locked .action.ghost {
  border-color: var(--line);
  color: var(--text);
}
.region-locked .action.ghost:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: transparent;
}
</style>
