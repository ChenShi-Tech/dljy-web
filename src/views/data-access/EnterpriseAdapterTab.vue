<script setup lang="ts">
// 数据源接入 · 企业自建通道 tab（Epic #1893 / Issue #1896）。
//
// 与「电网官方平台」并列的通道类型：企业方自建接口向本平台透传数据。
// 首个实例是中广核云南自建透传——它是云南唯一的真实实时数据来源（非电网官方接口）。
// 本 tab 只收编其配置入口，**不动其取数与幂等台账逻辑**（Epic #1893 边界）。
import { Building2 } from 'lucide-vue-next'
import CgnYunnanDataSourceCard from '@/components/CgnYunnanDataSourceCard.vue'
</script>

<template>
  <div class="enterprise-tab">
    <div class="tab-intro">
      <Building2 :size="16" aria-hidden="true" />
      <span>企业方自建的数据转接接口。与电网官方开放平台并列——当官方未提供接口、或企业方有更直接的内部数据源时走这一类。</span>
    </div>
    <CgnYunnanDataSourceCard />
  </div>
</template>

<style scoped>
.enterprise-tab { display: flex; flex-direction: column; gap: 16px; }
.tab-intro { display: flex; align-items: flex-start; gap: 8px; padding: 12px 14px; border-radius: 10px; background: var(--el-fill-color-light); font-size: var(--font-12-5); line-height: 1.7; color: var(--el-text-color-secondary); }
.tab-intro svg { flex-shrink: 0; margin-top: 2px; }
</style>
