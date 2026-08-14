<script setup lang="ts">
import {
  ArrowRight,
  BatteryCharging,
  ChartSpline,
  Gauge,
  Network,
  ShieldCheck,
  SunMedium,
  Wind
} from 'lucide-vue-next'
import CompanyIntroHero from '../../../components/company/CompanyIntroHero.vue'
import cgnNewEnergyVideo from '../../../assets/company/cgn-new-energy-loop.mp4'
import cgnNewEnergyPoster from '../../../assets/company/cgn-new-energy-poster.png'

const metrics = [
  { label: '资产场景', value: '风光储', detail: '新能源基地、储能与升压站' },
  { label: '交易颗粒度', value: '96 点', detail: '出力、负荷、价格联动分析' },
  { label: '决策链路', value: 'OODA', detail: '预测、风险、申报闭环' }
]

const capabilities = [
  { title: '新能源出力预测', text: '接入风电、光伏和气象特征，形成日前与日内滚动预测。' },
  { title: '储能充放电节奏', text: '结合价格曲线、容量约束和风险边界，辅助配置充放电窗口。' },
  { title: '现货价格联动', text: '把新能源波动、负荷预测和市场出清信号映射到交易策略。' },
  { title: 'AI 决策辅助', text: '以自然语言检索行情、预测、现货申报和策略实验。' }
]

const featureLinks = [
  { label: '登录系统', href: '/login', detail: '账号登录与权限校验', tone: 'primary' as const },
  { label: '了解公司信息', href: '/demo/cgn-yunnan', detail: '中广核云南公开资料' },
  { label: '认识量化交易', href: '/demo/spot-quant-trading', detail: '电力现货策略流程' },
  { label: '风光储门户', href: '/demo/cgn-new-energy', detail: '风光储资产展示' }
]

const operatingModel = [
  { title: '资产接入', text: '汇总风电、光伏、储能、升压站和合同边界，形成可交易资产视图。' },
  { title: '滚动预测', text: '把气象、负荷、出力和现货价格映射为 96 点日前与日内曲线。' },
  { title: '策略实验', text: '建立策略假设、约束和风险预算，完成回测后进入执行评估。' },
  { title: '收益复盘', text: '对比申报、出清、偏差、结算和风险暴露，沉淀下一轮策略参数。' }
]

const assetScenes = [
  { title: '风电基地', detail: '爬坡、切出、预测误差和低价时段风险', icon: 'wind' },
  { title: '光伏矩阵', detail: '午间高出力、云团扰动和限电信号识别', icon: 'solar' },
  { title: '共享储能', detail: '价差窗口、容量约束、充放电收益和偏差对冲', icon: 'battery' },
  { title: '交易组合', detail: '中长期头寸、现货申报、合同曲线和结算复盘', icon: 'network' }
]

const decisionSignals = [
  '日前 96 点价格与负荷预测',
  '新能源出力置信区间',
  '储能 SOC 与充放电窗口',
  '中长期合约曲线缺口',
  '偏差考核与风险预算',
  '出清结果与结算归因'
]
</script>

<template>
  <main class="cgn-brand-page">
    <CompanyIntroHero
      :video-src="cgnNewEnergyVideo"
      :poster-src="cgnNewEnergyPoster"
      brand-name="中广核新能源"
      brand-subtitle="CGN New Energy · 风光储交易辅助决策"
      title="让新能源资产接入电力交易决策"
      subtitle="从风、光、储到现货市场，把资产运行、出力预测和交易策略放进同一条决策链。"
      description="展示风光储资产、现货交易信号和 AI 决策入口。"
      :metrics="metrics"
      :capabilities="capabilities"
      :feature-links="featureLinks"
    />

    <section class="cgn-brand-page__section cgn-brand-page__section--split">
      <div>
        <span class="cgn-brand-page__label">风光储门户</span>
        <h2>把新能源资产变成交易决策输入</h2>
      </div>
      <p>
        风、光、储会影响现货价格、偏差考核、中长期头寸和结算收益。
        资产场景、交易信号、公司信息和系统入口集中展示。
      </p>
    </section>

    <section class="cgn-brand-page__rail" aria-label="风光储交易决策链">
      <article v-for="(item, index) in operatingModel" :key="item.title">
        <span>{{ index + 1 }}</span>
        <strong>{{ item.title }}</strong>
        <p>{{ item.text }}</p>
      </article>
    </section>

    <section class="cgn-brand-page__asset-band">
      <div class="cgn-brand-page__asset-copy">
        <span class="cgn-brand-page__label">资产场景</span>
        <h2>风光储资产接入交易视图</h2>
        <p>
          风电、光伏、储能和交易组合按资产场景组织，聚焦出力预测、价格联动、偏差控制和结算复盘。
        </p>
        <a href="/demo/spot-quant-trading">
          了解电力现货量化交易
          <ArrowRight :size="17" />
        </a>
      </div>

      <div class="cgn-brand-page__asset-grid">
        <article v-for="(scene, index) in assetScenes" :key="scene.title">
          <span class="cgn-brand-page__asset-icon">
            <Wind v-if="scene.icon === 'wind'" :size="18" />
            <SunMedium v-else-if="scene.icon === 'solar'" :size="18" />
            <BatteryCharging v-else-if="scene.icon === 'battery'" :size="18" />
            <Network v-else :size="18" />
          </span>
          <strong>{{ scene.title }}</strong>
          <p>{{ scene.detail }}</p>
          <em>{{ String(index + 1).padStart(2, '0') }}</em>
        </article>
      </div>
    </section>

    <section class="cgn-brand-page__signals" aria-label="交易决策信号">
      <div class="cgn-brand-page__signal-panel">
        <ChartSpline :size="22" />
        <h2>交易决策看六类信号</h2>
        <p>系统重点关注价格、出力、储能、合约、偏差和结算六类信号。</p>
      </div>
      <ul>
        <li v-for="signal in decisionSignals" :key="signal">
          <ShieldCheck :size="16" />
          <span>{{ signal }}</span>
        </li>
      </ul>
    </section>

    <section class="cgn-brand-page__cta">
      <div>
        <Gauge :size="22" />
        <h2>查看量化交易流程</h2>
        <p>了解价格、资产、策略和风险边界后，可登录进入授权工作台。</p>
      </div>
      <nav aria-label="门户后续入口">
        <a class="cgn-brand-page__cta-primary" href="/demo/spot-quant-trading">查看量化交易介绍</a>
        <a href="/login">登录系统</a>
      </nav>
    </section>
  </main>
</template>

<style scoped>
.cgn-brand-page {
  min-height: 100vh;
  background: oklch(0.1 0.026 210);
  color: oklch(0.96 0.015 190);
}

.cgn-brand-page__section,
.cgn-brand-page__rail,
.cgn-brand-page__asset-band,
.cgn-brand-page__signals,
.cgn-brand-page__cta {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}

.cgn-brand-page__section {
  padding: clamp(54px, 8vw, 96px) 0;
}

.cgn-brand-page__section--split {
  display: grid;
  grid-template-columns: minmax(260px, 0.85fr) minmax(320px, 1.15fr);
  gap: clamp(30px, 6vw, 86px);
}

.cgn-brand-page__label {
  color: oklch(0.82 0.13 185);
  font-size: 0.92rem;
  font-weight: 780;
}

.cgn-brand-page h2,
.cgn-brand-page p {
  margin: 0;
}

.cgn-brand-page h2 {
  max-width: 13ch;
  margin-top: 12px;
  font-size: clamp(2.1rem, 4.6vw, 4rem);
  line-height: 1.02;
  letter-spacing: 0;
  text-wrap: balance;
}

.cgn-brand-page__section--split > p,
.cgn-brand-page__asset-copy p,
.cgn-brand-page__signal-panel p,
.cgn-brand-page__cta p {
  color: oklch(0.8 0.034 202);
  font-size: 1rem;
  line-height: 1.9;
  text-wrap: pretty;
}

.cgn-brand-page__rail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid oklch(0.78 0.07 185 / 0.24);
  border-bottom: 1px solid oklch(0.78 0.07 185 / 0.18);
}

.cgn-brand-page__rail article {
  min-height: 224px;
  padding: 24px 22px;
  border-right: 1px solid oklch(0.78 0.07 185 / 0.16);
}

.cgn-brand-page__rail article:last-child {
  border-right: 0;
}

.cgn-brand-page__rail span,
.cgn-brand-page__asset-grid em {
  color: oklch(0.78 0.16 155);
  font-size: 0.86rem;
  font-weight: 800;
}

.cgn-brand-page__rail strong,
.cgn-brand-page__asset-grid strong {
  display: block;
  margin-top: 42px;
  color: oklch(0.96 0.015 190);
  font-size: 1.08rem;
}

.cgn-brand-page__rail p,
.cgn-brand-page__asset-grid p {
  margin-top: 10px;
  color: oklch(0.72 0.026 205);
  font-size: 0.92rem;
  line-height: 1.75;
}

.cgn-brand-page__asset-band {
  display: grid;
  grid-template-columns: minmax(300px, 0.82fr) minmax(360px, 1.18fr);
  gap: clamp(32px, 6vw, 88px);
  align-items: center;
  padding: clamp(70px, 10vw, 126px) 0;
}

.cgn-brand-page__asset-copy a,
.cgn-brand-page__cta a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  border: 1px solid oklch(0.78 0.07 185 / 0.24);
  padding: 0 16px;
  color: oklch(0.96 0.015 190);
  background: oklch(0.14 0.035 210 / 0.62);
  text-decoration: none;
  font-weight: 760;
}

.cgn-brand-page__asset-copy a {
  margin-top: 30px;
}

.cgn-brand-page__asset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.cgn-brand-page__asset-grid article {
  position: relative;
  min-height: 220px;
  border: 1px solid oklch(0.78 0.07 185 / 0.2);
  border-radius: 8px;
  padding: 18px;
  overflow: hidden;
  background:
    radial-gradient(circle at 86% 14%, oklch(0.82 0.13 185 / 0.14), transparent 36%),
    oklch(0.14 0.033 210 / 0.72);
}

.cgn-brand-page__asset-grid em {
  position: absolute;
  right: 18px;
  bottom: 16px;
  font-style: normal;
  color: oklch(0.82 0.13 185 / 0.42);
  font-size: 2.4rem;
  line-height: 1;
}

.cgn-brand-page__asset-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: oklch(0.82 0.13 185);
  background: oklch(0.82 0.13 185 / 0.12);
}

.cgn-brand-page__signals {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(340px, 1.1fr);
  gap: clamp(28px, 6vw, 86px);
  align-items: start;
  border-top: 1px solid oklch(0.78 0.07 185 / 0.2);
  padding: clamp(54px, 8vw, 96px) 0;
}

.cgn-brand-page__signal-panel {
  position: sticky;
  top: 24px;
}

.cgn-brand-page__signal-panel svg,
.cgn-brand-page__cta svg {
  color: oklch(0.78 0.16 155);
}

.cgn-brand-page__signals ul {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.cgn-brand-page__signals li {
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid oklch(0.78 0.07 185 / 0.18);
  border-radius: 8px;
  padding: 14px 16px;
  color: oklch(0.9 0.022 195);
  background: oklch(0.13 0.032 210 / 0.62);
}

.cgn-brand-page__signals li svg {
  flex: 0 0 auto;
  color: oklch(0.82 0.13 185);
}

.cgn-brand-page__cta {
  display: flex;
  justify-content: space-between;
  gap: 28px;
  align-items: center;
  border-top: 1px solid oklch(0.78 0.07 185 / 0.2);
  padding: clamp(44px, 7vw, 84px) 0 clamp(58px, 9vw, 110px);
}

.cgn-brand-page__cta h2 {
  max-width: 16ch;
  font-size: clamp(1.9rem, 3.6vw, 3rem);
}

.cgn-brand-page__cta p {
  max-width: 68ch;
  margin-top: 14px;
}

.cgn-brand-page__cta nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.cgn-brand-page__cta .cgn-brand-page__cta-primary {
  border-color: transparent;
  color: oklch(0.14 0.04 190);
  background: linear-gradient(135deg, oklch(0.82 0.13 185), oklch(0.78 0.16 155));
}

@media (max-width: 900px) {
  .cgn-brand-page__section--split,
  .cgn-brand-page__asset-band,
  .cgn-brand-page__signals {
    grid-template-columns: 1fr;
  }

  .cgn-brand-page__rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cgn-brand-page__rail article:nth-child(2) {
    border-right: 0;
  }

  .cgn-brand-page__signal-panel {
    position: static;
  }

  .cgn-brand-page__cta {
    align-items: flex-start;
    flex-direction: column;
  }

  .cgn-brand-page__cta nav {
    justify-content: flex-start;
  }
}

@media (max-width: 620px) {
  .cgn-brand-page__section,
  .cgn-brand-page__rail,
  .cgn-brand-page__asset-band,
  .cgn-brand-page__signals,
  .cgn-brand-page__cta {
    width: min(100% - 32px, 1180px);
  }

  .cgn-brand-page__rail,
  .cgn-brand-page__asset-grid {
    grid-template-columns: 1fr;
  }

  .cgn-brand-page__rail article {
    min-height: auto;
    border-right: 0;
    padding: 22px 0;
  }

  .cgn-brand-page__rail strong {
    margin-top: 18px;
  }

  .cgn-brand-page__asset-grid article {
    min-height: 190px;
  }
}

@media (max-width: 768px) {
  .cgn-brand-page__section--split { grid-template-columns: 1fr; }
  .cgn-brand-page__asset-band { grid-template-columns: 1fr; }
  .cgn-brand-page__rail { grid-template-columns: 1fr; }
}
</style>
