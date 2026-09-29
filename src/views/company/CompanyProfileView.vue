<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getCurrentUser } from '@/services/auth'
import { hasCompanyAdmin, subjectTypeLabels, type SubjectType } from '@/services/governance'
import { companyOptions, currentCompany, selectedCompanyId } from '@/services/company/companyContext'
import { fetchCompanySubjectTypes, fetchProfile, saveCompanySubjectTypes, saveProfile } from '@/services/company/companyApi'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'
import { isEntryHidden } from '@/features/platformAdminMigration/registry'
import MigratedToAdminNotice from '@/features/platformAdminMigration/MigratedToAdminNotice.vue'

const canWrite = computed(() => hasCompanyAdmin(getCurrentUser()))
// 注册立场编辑已迁至平台后台（ChenShi-Tech/dljy#3464，内部版）：写入落点是平台全局公司主数据、
// 也是立场切换授权的服务端权威，由平台人员在后台客户详情里处理。内部版立场块恢复只读展示已登记
// 立场（dljy#3518，迁移清单 §3.7）：所有角色可见、不可编辑，读接口未被收窄照常读取，写接口
// saveCompanySubjectTypes 不再调用；「已迁至平台后台」提示只对平台人员渲染（registry 的角色闸门），
// 客户账号只见只读立场。客户交付版不受影响（登记表恒答未迁移，立场块照旧可编辑）。
const registryMigrated = isEntryHidden('subject-registry')

const form = reactive({ contact: '', address: '', businessScope: '' })
const loading = ref(false)
// 注册立场（#2193）：公司在交易中心登记的市场主体类型集合，「本主体既买又卖」的
// 登记处，也是 TRADER/GROUP 账号立场切换授权的服务端权威。仅 BOSS/ADMIN 可改。
const registryLoading = ref(false)
const registry = ref<string[]>([])

const subjectTypeOptions = (Object.keys(subjectTypeLabels) as SubjectType[]).map((t) => ({
  value: t,
  label: subjectTypeLabels[t]
}))

// 内部版只读态的说明去掉编辑指引（「清空即退回单立场」），且不提后台——客户账号不见任何
// 后台路径或提示（AI-06）；只读态只描述立场是什么。
const registryHint = computed(() =>
  registryMigrated
    ? '公司在交易中心登记的市场主体类型。交易组合（TRADER）与集团（GROUP）账号可在登记立场间切换作业视角；其余主体单立场。'
    : '公司在交易中心登记的市场主体类型。交易组合（TRADER）与集团（GROUP）账号可在登记立场间切换作业视角；其余主体单立场。清空即退回单立场。'
)

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
async function reloadRegistry() {
  registryLoading.value = true
  try {
    registry.value = await fetchCompanySubjectTypes(selectedCompanyId.value)
  } catch {
    registry.value = []
  } finally {
    registryLoading.value = false
  }
}
function reloadAll() {
  void reload()
  // 注册立场恢复读取（dljy#3518）：读接口未被后端收窄，所有角色都读；编辑只落平台后台。
  void reloadRegistry()
}
onMounted(reloadAll)
watch(selectedCompanyId, reloadAll)

async function save() {
  try {
    await saveProfile({ ...form })
    ElMessage.success('公司档案已保存')
    await reload()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}

async function saveRegistry() {
  try {
    await saveCompanySubjectTypes(selectedCompanyId.value ?? '', registry.value)
    ElMessage.success('注册立场已保存')
    await reloadRegistry()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存注册立场失败')
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
        <!-- 编辑已迁平台后台（#3464）：提示只对平台人员显示（registry 角色闸门，#3518），
             立场块对所有角色恢复只读展示（迁移清单 §3.7），两者共存而非互斥 -->
        <MigratedToAdminNotice v-if="registryMigrated" :entries="['subject-registry']" />
        <el-card shadow="never" v-loading="registryLoading">
          <template #header>
            <div class="card-head">
              <span>注册立场</span>
              <el-tag size="small" type="warning" effect="plain">交易中心登记</el-tag>
            </div>
          </template>
          <el-select
            v-model="registry"
            multiple
            filterable
            :disabled="!canWrite || registryMigrated"
            placeholder="未登记多立场"
            style="width: 100%"
          >
            <el-option v-for="opt in subjectTypeOptions" :key="opt.value" :value="opt.value" :label="opt.label" />
          </el-select>
          <p class="hint">{{ registryHint }}</p>
          <el-button v-if="canWrite && !registryMigrated" type="primary" size="small" style="margin-top: 8px" @click="saveRegistry">保存注册立场</el-button>
        </el-card>
        <el-card shadow="never" style="margin-top: 16px">
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
.page-title { margin: 0 0 16px; font-size: var(--font-20); }
.card-head { display: flex; align-items: center; justify-content: space-between; }
.readonly-hint { color: var(--el-text-color-secondary, #909399); font-size: var(--font-md); }
.hint { margin: 10px 0 0; color: var(--el-text-color-secondary, #909399); font-size: var(--font-sm); }
/* 迁移提示（仅平台人员渲染）与立场卡片之间留间距；提示不渲染时选择器不命中，客户账号无多余空隙 */
.migrated-notice + .el-card { margin-top: 16px; }
</style>
