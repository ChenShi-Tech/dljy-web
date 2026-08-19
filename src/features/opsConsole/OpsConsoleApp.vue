<template>
  <el-container class="ops-shell">
    <el-aside width="200px" class="ops-aside">
      <div class="ops-brand">
        <h1>数据运维台</h1>
        <p>电力交易辅助决策支持系统</p>
      </div>
      <el-menu :default-active="activePath" router class="ops-menu">
        <el-menu-item v-for="page in OPS_PAGES" :key="page.path" :index="page.path">
          {{ page.title }}
        </el-menu-item>
      </el-menu>
      <div class="ops-aside-footer">
        <a href="/" class="ops-back">← 返回主平台</a>
      </div>
    </el-aside>
    <el-container>
      <el-header class="ops-header">
        <span class="ops-title">{{ pageTitle }}</span>
        <span class="ops-user" v-if="userName">{{ userName }} · {{ userRole }}</span>
      </el-header>
      <el-main class="ops-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
// 数据运维台壳（#2174 P2-2b）：独立控制台布局，侧栏六页 + 头部当前用户 + 回主平台。
// 纯壳层：业务全在六页组件内（自主前端 views/ 原样复用，零改动迁移）。
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { getCurrentUser } from '@/services/auth'
import { OPS_PAGES } from './opsRouter'

const route = useRoute()
const activePath = computed(() => route.path)
const pageTitle = computed(() => OPS_PAGES.find((p) => p.path === route.path)?.title ?? '数据运维台')
const user = computed(() => getCurrentUser())
const userName = computed(() => user.value?.displayName ?? user.value?.username ?? '')
const userRole = computed(() => user.value?.role ?? '')
</script>

<style scoped>
.ops-shell { height: 100vh; }
.ops-aside { display: flex; flex-direction: column; border-right: 1px solid var(--el-border-color-light); background: var(--el-bg-color); }
.ops-brand { padding: 16px 16px 10px; }
.ops-brand h1 { margin: 0; font-size: 17px; }
.ops-brand p { margin: 4px 0 0; font-size: 11px; color: var(--el-text-color-secondary); }
.ops-menu { flex: 1; border-right: none; }
.ops-aside-footer { padding: 12px 16px; border-top: 1px solid var(--el-border-color-lighter); }
.ops-back { font-size: 12px; color: var(--el-color-primary); text-decoration: none; }
.ops-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--el-border-color-light); }
.ops-title { font-size: 15px; font-weight: 600; }
.ops-user { font-size: 12px; color: var(--el-text-color-secondary); }
.ops-main { background: var(--el-fill-color-lighter); overflow: auto; }
</style>
