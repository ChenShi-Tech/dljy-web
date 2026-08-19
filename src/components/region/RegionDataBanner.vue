<script setup lang="ts">
// 地区数据来源提示条，四种互斥状态（不重复堆叠，优先级 无权限 > 演示 > 接口级Mock > 基线回退）：
// 0) 无权限（Sub-2/#518 回放层公司授权闸门 401/403，regionDataStatus.accessDenied）：本页
//    数据为公司私有族（如中广核云南场站结算/损益），当前账号不在数据归属公司的授权集合内——
//    诚实显「无权查看」，绝不显示 mock 假曲线冒充（Sub-4 #520）。
// 1) 演示地区（非真实数据地区，见 regions.ts::isRealDataRegion）：整区无专属真实市场数据接入
//    （含已开通演示地区如四川——仅有演示公司、市场数据严格地区不回退即空；及通用模板），
//    现货等数据为空或按地区画像合成的模拟数据，常显演示提示。
// 2) 真实数据地区某次取数走 mockReplay 合成（响应头 x-data-mock=true）：诚实显「模拟数据」，
//    避免真实数据地区缺某 family 时把合成曲线当真实（#348 P1）。
// 3) 真实数据地区（云南）：仅当某次取数后端回退到基线(山西)数据时显示回退提示。
// 订阅 captured.ts 的 regionDataStatus（来自响应头 x-region-fallback/served/x-data-mock/
// x-data-visibility 与 fetchCaptured 的 401/403 捕获）。
// 措辞只说明「数据地域来源/演示性质/授权状态」，不评价数据质量（遵循项目对预测板块 UI 的约束）。
import { computed } from 'vue'
import { AlertTriangle, FlaskConical, Lock } from 'lucide-vue-next'
import { regionDataStatus } from '@/services/captured'
import { deniedCaptureFamilies } from '@/services/api'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionById, isRealDataRegion } from '@/data/regions'

// 无权限横幅的 opt-in 契约（Sub-4 #520，roborev job146）：消费私有 capture 族的面板
// 传入 `families`（自己经 fetchCaptured 取的私有 family 列表），横幅只在这些 family 之一
// 当前被授权闸门拒绝时显示。不传（公共/普通页面）→ 永不显示无权限态。这让无权限提示严格
// 绑定「你正在看的这块数据」，杜绝全局拒绝状态跨 tab（单路由多 tab 工作台）/跨面板粘滞。
const props = defineProps<{
  families?: readonly string[]
}>()

// 基线数据来源地区，与后端 BASELINE_REGION_ID 对应（现有扁平采集数据即此地区）。
const BASELINE_REGION_ID = 'shanxi'

const baselineLabel = computed(() => getRegionById(BASELINE_REGION_ID).shortName)

// 无权限：本面板声明的私有 family 中至少一个当前被拒（401 未登录会被全局跳登录，
// 实际停留可见的主要是 403 无授权）。优先级最高——被拒时不叠加演示/Mock 提示。
const showAccessDenied = computed(() => {
  const families = props.families
  if (!families || families.length === 0) return false
  if (regionDataStatus.value.accessDenied === null) return false
  return families.some((family) => deniedCaptureFamilies.value.includes(family))
})
// 演示地区：整区无专属真实数据接入，优先显示「演示」提示（已涵盖合成/基线来源）。
const isDemoRegion = computed(() => !isRealDataRegion(currentRegion.value.id))
// 接口级 Mock：真实数据地区某次取数走了 mockReplay 合成（响应头 x-data-mock=true）——
// 例如山西/云南缺某个 family 的真实采集时，诚实标注「模拟数据」，不因地区整体标真实而漏标（#348 P1）。
// 演示地区已由演示横幅统一涵盖，不重复堆叠。
const showMock = computed(() => !isDemoRegion.value && regionDataStatus.value.mock)
// 基线回退提示仅在真实数据地区生效，且不与接口级 Mock 提示堆叠。
const showFallback = computed(() => !isDemoRegion.value && !showMock.value && regionDataStatus.value.fallback)
</script>

<template>
  <div v-if="showAccessDenied" class="region-data-banner region-data-banner--denied">
    <Lock :size="16" class="banner-icon" />
    <span>
      本页数据为<strong>公司私有数据</strong> · 当前账号无权查看（需数据归属公司的访问授权，请联系管理员在「公司授权」中开通）
    </span>
  </div>
  <div v-else-if="isDemoRegion" class="region-data-banner region-data-banner--demo">
    <FlaskConical :size="16" class="banner-icon" />
    <span>
      <strong>{{ currentRegion.shortName }}</strong> 为演示地区 · 本地区暂无专属真实市场数据接入，现货等数据为空或按地区画像合成的模拟数据，仅供演示参考
    </span>
  </div>
  <div v-else-if="showMock" class="region-data-banner region-data-banner--demo">
    <FlaskConical :size="16" class="banner-icon" />
    <span>
      当前 <strong>{{ currentRegion.shortName }}</strong> 部分数据为按地区画像合成的<strong>模拟数据</strong> · 该数据项暂无专属真实采集接入，仅供演示参考
    </span>
  </div>
  <div v-else-if="showFallback" class="region-data-banner">
    <AlertTriangle :size="16" class="banner-icon" />
    <span>
      当前显示 <strong>{{ baselineLabel }}</strong> 基线数据 · {{ currentRegion.shortName }} 专属采集数据接入后将自动切换
    </span>
  </div>
</template>

<style scoped>
.region-data-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 14px;
  border: 1px solid var(--line-faint);
  border-radius: 6px;
  background: var(--panel-sub);
  color: var(--warning);
  font-size: var(--font-md);
  line-height: 1.5;
}

.region-data-banner--demo {
  color: var(--info, var(--primary));
}

/* 无权限态：公司私有数据被授权闸门拒绝（Sub-4 #520），用危险色与演示/回退区分 */
.region-data-banner--denied {
  color: var(--danger, #d03050);
}

.banner-icon {
  flex: 0 0 auto;
}

.region-data-banner strong {
  color: var(--text);
  font-weight: 700;
}
</style>
