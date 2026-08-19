<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getCurrentUser } from '@/services/auth'
import {
  canSwitchCompany,
  companySelectionEmpty,
  currentCompany,
  selectableCompanies,
  selectedCompanyId,
  setCurrentCompanyId
} from '@/services/company/companyContext'
import { refreshCompanyOptions } from '@/services/company/companyApi'

const user = computed(() => getCurrentUser())
const switchable = computed(() => canSwitchCompany(user.value))
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    await refreshCompanyOptions()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载公司列表失败')
  } finally {
    loading.value = false
  }
})

function onSwitch(value: string) {
  if (!setCurrentCompanyId(value)) {
    ElMessage.warning('无权切换到该公司')
  }
}
</script>

<template>
  <div class="company-scope-bar">
    <div class="scope-info">
      <span class="scope-label">当前公司</span>
      <strong class="scope-name">{{ currentCompany.name }}</strong>
      <el-tag v-if="currentCompany.tier === 'GROUP'" size="small" type="warning" effect="plain">集团</el-tag>
      <el-tag v-else size="small" type="info" effect="plain">公司</el-tag>
    </div>

    <!-- #668 空态：当前地区默认公司不在授权集合（或该地区无授权公司）→ 不自动选公司，提示用户手动选择。
         不静默展示非授权公司数据，服务端 fail-closed 兜底。 -->
    <div v-if="companySelectionEmpty" class="scope-empty">
      <el-tag size="small" type="warning" effect="dark">请选择公司</el-tag>
      <span>当前地区未自动匹配到授权公司，请从下属公司中选择一个。</span>
    </div>

    <div v-if="switchable" class="scope-switch">
      <span class="switch-hint">查看下属公司：</span>
      <el-select
        :model-value="selectedCompanyId"
        :loading="loading"
        :placeholder="companySelectionEmpty ? '请选择公司' : '选择下属公司'"
        size="small"
        style="width: 220px"
        @update:model-value="onSwitch"
      >
        <el-option
          v-for="company in selectableCompanies"
          :key="company.companyId"
          :label="company.name"
          :value="company.companyId"
        />
      </el-select>
    </div>

    <div class="scope-note">
      <el-tag size="small" type="success" effect="plain">公司专属</el-tag>
      <span>数据按公司隔离，仅本公司可见可改；电网侧公共数据另在各分析页共享。</span>
    </div>
  </div>
</template>

<style scoped>
.company-scope-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: var(--el-fill-color-light, #f5f7fa);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
}
.scope-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.scope-label {
  color: var(--el-text-color-secondary, #909399);
  font-size: var(--font-md);
}
.scope-name {
  font-size: var(--font-15);
}
.scope-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}
.switch-hint {
  color: var(--el-text-color-secondary, #909399);
  font-size: var(--font-md);
}
.scope-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-secondary, #909399);
  font-size: var(--font-sm);
}
.scope-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  color: var(--el-text-color-secondary, #909399);
  font-size: var(--font-sm);
}
</style>
