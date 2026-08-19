<script setup lang="ts">
// 登录后的工作立场选择页（Epic #2193 · #2195）。
// 仅多立场账号可见（单立场账号由路由守卫直接放行）；选择后进入对应立场的工作台。
// 立场允许集合来自服务端下发（见 stanceContext 头注释），本页零推导。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getCurrentUser } from '@/services/auth'
import { canAccessPath, firstAccessiblePath, subjectTypeLabels, type Stance } from '@/services/governance'
import { getCurrentRegionSnapshot } from '@/services/region/regionContext'
import { setActiveStance, stances, stanceKeyOf } from '@/services/stance/stanceContext'
import { isPathAvailableInStance } from '@/services/stance/stanceNavigation'

const route = useRoute()
const router = useRouter()

const user = computed(() => getCurrentUser())

const stanceDescription: Record<string, string> = {
  GROUP: '集团总览视角：跨主体经营汇总与审批',
  GENERATOR: '电源侧视角：出力预测、发电申报、场站台账',
  RETAILER: '售电侧视角：客户负荷、购售电价差、零售结算',
  STORAGE: '储能视角：价差套利、充放计划与 SOC',
  LOAD: '用户侧视角：用电需求曲线与偏差管理',
  TRADER: '交易组合视角：多线申报与组合管理'
}

function labelOf(stance: Stance): string {
  return subjectTypeLabels[stance.subjectType] ?? stance.subjectType
}

function chooseStance(stance: Stance) {
  const key = stanceKeyOf(stance)
  if (!setActiveStance(key)) {
    ElMessage.error('该立场不在当前账号的允许集合内')
    return
  }
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  // 回跳目标须同时过角色与立场可用性（#2196）：发电侧专属深链不带到售电立场去。
  const target = redirect && canAccessPath(redirect, user.value) && isPathAvailableInStance(redirect, stance.subjectType)
    ? redirect
    : firstAccessiblePath(user.value, getCurrentRegionSnapshot().id)
  void router.replace(target)
}
</script>

<template>
  <div class="select-stance-page">
    <div class="stance-panel">
      <h2 class="title">选择工作立场</h2>
      <p class="subtitle">
        当前账号（{{ user.displayName }}）所属主体在交易中心登记了多个市场立场。
        不同立场对应不同的工作台、申报单据与风控口径；进入后可随时在顶栏切换。
      </p>
      <div class="stance-cards">
        <button
          v-for="stance in stances"
          :key="stanceKeyOf(stance)"
          type="button"
          class="stance-card"
          @click="chooseStance(stance)"
        >
          <div class="card-head">
            <span class="stance-name">{{ labelOf(stance) }}</span>
            <el-tag v-if="stance.crossView" size="small" type="warning" effect="plain">切换视角</el-tag>
            <el-tag v-else size="small" type="success" effect="plain">主立场</el-tag>
          </div>
          <div class="stance-subject">{{ stance.subjectName || stance.subjectId || '—' }}</div>
          <div class="stance-desc">{{ stanceDescription[stance.subjectType] ?? '' }}</div>
        </button>
      </div>
      <p class="footnote">立场切换只影响作业视角与申报主体，不改变数据可见范围。</p>
    </div>
  </div>
</template>

<style scoped>
.select-stance-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light, #f5f7fa);
  padding: 24px;
}
.stance-panel {
  width: min(720px, 100%);
  background: var(--el-bg-color, #fff);
  border-radius: 12px;
  box-shadow: var(--el-box-shadow-light, 0 2px 12px rgba(0, 0, 0, 0.08));
  padding: 32px;
}
.title {
  margin: 0 0 8px;
  font-size: var(--font-22);
}
.subtitle {
  margin: 0 0 20px;
  color: var(--el-text-color-secondary, #909399);
  font-size: var(--font-md);
  line-height: 1.6;
}
.stance-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.stance-card {
  text-align: left;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 8px;
  background: var(--el-bg-color, #fff);
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  font: inherit;
}
.stance-card:hover {
  border-color: var(--el-color-primary, #409eff);
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.15);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stance-name {
  font-size: var(--font-16);
  font-weight: 600;
}
.stance-subject {
  margin-top: 6px;
  font-size: var(--font-md);
  color: var(--el-text-color-regular, #606266);
}
.stance-desc {
  margin-top: 8px;
  font-size: var(--font-sm);
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.5;
}
.footnote {
  margin: 20px 0 0;
  font-size: var(--font-sm);
  color: var(--el-text-color-placeholder, #c0c4cc);
}
@media (max-width: 640px) {
  .stance-panel { padding: 20px; }
}
</style>
