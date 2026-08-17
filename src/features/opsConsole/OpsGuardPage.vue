<template>
  <el-result
    :icon="reason === 'forbidden' ? 'warning' : 'info'"
    :title="reason === 'forbidden' ? '无权访问数据运维台' : '请先登录主平台'"
    :sub-title="subTitle"
  >
    <template #extra>
      <el-button type="primary" @click="goLogin">前往主平台登录</el-button>
    </template>
  </el-result>
</template>

<script setup lang="ts">
// 运维台门禁引导页：未登录/非 ADMIN·BOSS 时的诚实拦截（身份根在平台，本台不复刻登录）。
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const reason = computed(() => String(route.query.reason ?? 'unauthenticated'))
const subTitle = computed(() => reason.value === 'forbidden'
  ? '数据管理操作面仅对系统管理员（ADMIN/BOSS）开放；如需数据管理权限请联系管理员在主平台授权。'
  : '数据运维台与主平台共享登录态——在主平台登录后回到本页即可使用（浏览器同一地址）。')

function goLogin() {
  window.location.href = '/?redirect=' + encodeURIComponent('/ops-console.html')
}
</script>
