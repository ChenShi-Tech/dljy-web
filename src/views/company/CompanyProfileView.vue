<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getCurrentUser } from '@/services/auth'
import { hasCompanyAdmin } from '@/services/governance'
import { companyOptions, currentCompany, selectedCompanyId } from '@/services/company/companyContext'
import { fetchProfile, saveProfile } from '@/services/company/companyApi'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'

const canWrite = computed(() => hasCompanyAdmin(getCurrentUser()))

const form = reactive({ contact: '', address: '', businessScope: '' })
const loading = ref(false)

async function reload() {
  loading.value = true
  try {
    const profile = await fetchProfile()
    form.contact = profile?.contact ?? ''
    form.address = profile?.address ?? ''
    form.businessScope = profile?.businessScope ?? ''
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载档案失败')
  } finally {
    loading.value = false
  }
}
onMounted(reload)
watch(selectedCompanyId, reload)

async function save() {
  try {
    await saveProfile({ ...form })
    ElMessage.success('公司档案已保存')
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}
</script>

<template>
  <div class="company-page">
    <h2 class="page-title">公司档案</h2>
    <CompanyScopeBar />

    <el-row :gutter="16">
      <el-col :span="14" :xs="24">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span>{{ currentCompany.name }} · 档案信息</span>
              <el-tag size="small" type="success" effect="plain">公司专属</el-tag>
            </div>
          </template>
          <el-form label-width="100px" v-loading="loading">
            <el-form-item label="公司ID"><el-input :model-value="selectedCompanyId" disabled /></el-form-item>
            <el-form-item label="联系人/电话"><el-input v-model="form.contact" :disabled="!canWrite" /></el-form-item>
            <el-form-item label="办公地址"><el-input v-model="form.address" :disabled="!canWrite" /></el-form-item>
            <el-form-item label="经营范围">
              <el-input v-model="form.businessScope" type="textarea" :rows="4" :disabled="!canWrite" />
            </el-form-item>
            <el-form-item v-if="canWrite">
              <el-button type="primary" @click="save">保存档案</el-button>
            </el-form-item>
            <el-form-item v-else>
              <span class="readonly-hint">只读：当前角色无写入权限</span>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="10" :xs="24">
        <el-card shadow="never">
          <template #header>可见公司</template>
          <el-table :data="companyOptions" border stripe size="small">
            <el-table-column prop="name" label="公司名称" min-width="140" />
            <el-table-column label="层级" width="80">
              <template #default="{ row }">
                <el-tag size="small" :type="row.tier === 'GROUP' ? 'warning' : 'info'" effect="plain">
                  {{ row.tier === 'GROUP' ? '集团' : '公司' }}
                </el-tag>
              </template>
            </el-table-column>
            <template #empty>仅本公司可见。</template>
          </el-table>
          <p class="hint">集团/管理员可在上方切换查看下属公司数据；普通公司用户锁定为本公司。</p>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.company-page { padding: 20px; }
.page-title { margin: 0 0 16px; font-size: 20px; }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.readonly-hint { color: var(--el-text-color-secondary, #909399); font-size: 13px; }
.hint { margin: 10px 0 0; color: var(--el-text-color-secondary, #909399); font-size: 12px; }
</style>
