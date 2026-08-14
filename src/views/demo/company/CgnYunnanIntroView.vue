<script setup lang="ts">
import {
  ArrowLeft,
  ArrowRight,
  BatteryCharging,
  ExternalLink,
  Landmark,
  Network,
  ShieldCheck,
  SunMedium
} from 'lucide-vue-next'
import cgnNewEnergyVideo from '../../../assets/company/cgn-new-energy-loop.mp4'
import cgnNewEnergyPoster from '../../../assets/company/cgn-new-energy-poster.png'

const facts = [
  { label: '云南总部', value: '昆明', detail: '公开报道显示总部落地滇池国家旅游度假区' },
  { label: '注册资本', value: '139 亿元', detail: '由 1 亿元增至 139 亿元' },
  { label: '在运及在建', value: '600 万千瓦+', detail: '累计装机规模公开报道口径' },
  { label: '累计投资', value: '400 亿元+', detail: '支撑云南绿色能源项目建设' }
]

const milestones = [
  {
    title: '较早进入云南新能源市场',
    text: '中国能源报公开报道显示，中广核新能源云南分公司于 2010 年进驻云南。到 2017 年上半年，其在云南投运装机达到 110 万千瓦，项目遍布 11 个地州 34 个县区。',
    source: '中国能源报'
  },
  {
    title: '总部与资本平台落地昆明',
    text: '昆明信息港 2026 年 3 月转载报道显示，中广核新能源云南总部落地昆明滇池国家旅游度假区；相关平台引入战略投资者，融资 64.6 亿元。',
    source: '昆明信息港'
  },
  {
    title: '共享储能进入并网阶段',
    text: '新浪财经 2026 年 5 月转载报道，中广核云南元江领航新型共享储能电站全容量并网发电，额定容量 100MW/200MWh。',
    source: '新浪财经'
  },
  {
    title: '保山隆阳光伏项目群开工',
    text: '东方财富转发公开快讯显示，中广核云南保山隆阳区 540MW 光伏项目群规划 10 个光伏场区，投产后预计年发电量约 7.2 亿千瓦时。',
    source: '东方财富'
  }
]

const decisionLinks = [
  { title: '风光储出力预测', text: '把气象、场站出力和储能状态同步到日前与日内预测。' },
  { title: '现货价格联动', text: '围绕 96 点价格曲线评估申报、偏差与回撤风险。' },
  { title: '储能充放电辅助', text: '结合价差、容量约束和调度边界，形成策略候选窗口。' },
  { title: '区域项目视图', text: '按地州、县区、项目类型和资产状态组织新能源版图。' }
]

const sources = [
  {
    label: '中国能源报：中广核新能源云南公司布局与交易报道',
    href: 'https://paper.people.com.cn/zgnyb/html/2017-10/16/content_1811157.htm'
  },
  {
    label: '昆明信息港：中广核新能源云南总部落地昆明',
    href: 'https://www.kunming.cn/news/c/2026-03-09/14023878.shtml'
  },
  {
    label: '新浪财经：元江领航新型共享储能电站全容量并网',
    href: 'https://finance.sina.com.cn/jjxw/2026-05-12/doc-inhxrshk9956061.shtml'
  },
  {
    label: '东方财富：保山隆阳区 540MW 光伏项目群全面开工',
    href: 'https://finance.eastmoney.com/a/202605263749459114.html'
  }
]
</script>

<template>
  <main class="cgn-yunnan">
    <section class="cgn-yunnan__hero">
      <div class="cgn-yunnan__media" aria-hidden="true">
        <img :src="cgnNewEnergyPoster" alt="" />
        <video autoplay muted loop playsinline preload="metadata" :poster="cgnNewEnergyPoster">
          <source :src="cgnNewEnergyVideo" type="video/mp4" />
        </video>
        <div class="cgn-yunnan__veil"></div>
      </div>

      <nav class="cgn-yunnan__top" aria-label="页面导航">
        <a href="/demo/cgn-new-energy"><ArrowLeft :size="16" /> 返回风光储门户</a>
        <a href="/login">登录系统 <ArrowRight :size="16" /></a>
      </nav>

      <div class="cgn-yunnan__hero-inner">
        <div class="cgn-yunnan__copy">
          <span class="cgn-yunnan__kicker">公开资料摘要</span>
          <h1>中广核云南新能源布局</h1>
          <p>
            基于公开报道整理总部平台、风光储项目、储能并网和区域投资信息。
          </p>
          <div class="cgn-yunnan__actions">
            <a class="cgn-yunnan__action cgn-yunnan__action--primary" href="/login">进入登录系统</a>
            <a class="cgn-yunnan__action" href="/demo/cgn-new-energy">查看动态门户</a>
          </div>
        </div>

        <aside class="cgn-yunnan__facts" aria-label="公开信息要点">
          <div v-for="fact in facts" :key="fact.label">
            <span>{{ fact.label }}</span>
            <strong>{{ fact.value }}</strong>
            <em>{{ fact.detail }}</em>
          </div>
        </aside>
      </div>
    </section>

    <section class="cgn-yunnan__section cgn-yunnan__section--split">
      <div>
        <span class="cgn-yunnan__section-label">区域定位</span>
        <h2>从资源开发走向交易决策</h2>
      </div>
      <p>
        云南新能源项目具备风、光、水、储协同特征。
        系统按项目版图、预测、策略、申报和复盘组织业务入口。
      </p>
    </section>

    <section class="cgn-yunnan__timeline" aria-label="公开信息节点">
      <article v-for="(item, index) in milestones" :key="item.title">
        <span class="cgn-yunnan__timeline-index">{{ index + 1 }}</span>
        <div>
          <strong>{{ item.title }}</strong>
          <p>{{ item.text }}</p>
          <em>{{ item.source }}</em>
        </div>
      </article>
    </section>

    <section class="cgn-yunnan__section">
      <div class="cgn-yunnan__decision-head">
        <div>
          <span class="cgn-yunnan__section-label">系统结合点</span>
          <h2>业务入口</h2>
        </div>
        <p>从公司信息进入登录、策略实验、项目版图和公开资料来源。</p>
      </div>

      <div class="cgn-yunnan__decision-grid">
        <article v-for="(item, index) in decisionLinks" :key="item.title">
          <span class="cgn-yunnan__decision-icon">
            <SunMedium v-if="index === 0" :size="18" />
            <Network v-else-if="index === 1" :size="18" />
            <BatteryCharging v-else-if="index === 2" :size="18" />
            <Landmark v-else :size="18" />
          </span>
          <strong>{{ item.title }}</strong>
          <p>{{ item.text }}</p>
        </article>
      </div>
    </section>

    <section class="cgn-yunnan__sources" aria-label="公开资料来源">
      <div>
        <ShieldCheck :size="18" />
        <span>资料来源</span>
      </div>
      <p>内容根据公开报道整理；业务数据以授权数据源和项目合同为准。</p>
      <ul>
        <li v-for="source in sources" :key="source.href">
          <a :href="source.href" target="_blank" rel="noreferrer">
            {{ source.label }}
            <ExternalLink :size="13" />
          </a>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.cgn-yunnan {
  --yunnan-bg: oklch(0.105 0.028 208);
  --yunnan-panel: oklch(0.155 0.035 205 / 0.76);
  --yunnan-ink: oklch(0.96 0.015 190);
  --yunnan-soft: oklch(0.81 0.034 202);
  --yunnan-muted: oklch(0.68 0.025 205);
  --yunnan-line: oklch(0.78 0.07 185 / 0.22);
  --yunnan-cyan: oklch(0.82 0.13 185);
  --yunnan-green: oklch(0.78 0.16 155);
  min-height: 100vh;
  background: var(--yunnan-bg);
  color: var(--yunnan-ink);
}

.cgn-yunnan__hero {
  position: relative;
  min-height: 100svh;
  overflow: hidden;
  isolation: isolate;
}

.cgn-yunnan__media,
.cgn-yunnan__media img,
.cgn-yunnan__media video,
.cgn-yunnan__veil {
  position: absolute;
  inset: 0;
}

.cgn-yunnan__media {
  z-index: -2;
  background: var(--yunnan-bg);
}

.cgn-yunnan__media img,
.cgn-yunnan__media video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cgn-yunnan__media video {
  opacity: 0.84;
}

.cgn-yunnan__veil {
  background:
    linear-gradient(90deg, oklch(0.075 0.025 210 / 0.96) 0%, oklch(0.075 0.025 210 / 0.74) 45%, oklch(0.075 0.025 210 / 0.26) 100%),
    linear-gradient(0deg, var(--yunnan-bg) 0%, transparent 42%),
    radial-gradient(circle at 22% 26%, oklch(0.78 0.16 155 / 0.24), transparent 31%);
}

.cgn-yunnan__top {
  position: relative;
  z-index: 1;
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
  padding: 26px 0 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.cgn-yunnan__top a,
.cgn-yunnan__action {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 8px;
  border: 1px solid var(--yunnan-line);
  padding: 0 14px;
  color: var(--yunnan-ink);
  background: oklch(0.12 0.03 210 / 0.55);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 700;
}

.cgn-yunnan__hero-inner {
  width: min(1180px, calc(100% - 48px));
  min-height: calc(100svh - 68px);
  margin: 0 auto;
  padding: clamp(54px, 8vw, 118px) 0 clamp(42px, 6vw, 84px);
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(300px, 0.7fr);
  align-items: center;
  gap: clamp(34px, 7vw, 94px);
}

.cgn-yunnan__copy {
  max-width: 760px;
}

.cgn-yunnan__kicker,
.cgn-yunnan__section-label {
  color: var(--yunnan-cyan);
  font-size: 0.92rem;
  font-weight: 780;
}

.cgn-yunnan h1,
.cgn-yunnan h2,
.cgn-yunnan p {
  margin: 0;
}

.cgn-yunnan h1 {
  max-width: 11ch;
  margin-top: 18px;
  font-size: clamp(3.1rem, 7vw, 6rem);
  line-height: 0.96;
  letter-spacing: 0;
  text-wrap: balance;
}

.cgn-yunnan__copy p {
  max-width: 68ch;
  margin-top: 24px;
  color: var(--yunnan-soft);
  font-size: clamp(1.05rem, 1.5vw, 1.24rem);
  line-height: 1.85;
  text-wrap: pretty;
}

.cgn-yunnan__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 34px;
}

.cgn-yunnan__action--primary {
  border-color: transparent;
  color: oklch(0.14 0.04 190);
  background: linear-gradient(135deg, var(--yunnan-cyan), var(--yunnan-green));
  box-shadow: 0 18px 46px oklch(0.78 0.16 155 / 0.22);
}

.cgn-yunnan__facts {
  display: grid;
  gap: 12px;
}

.cgn-yunnan__facts div {
  border: 1px solid var(--yunnan-line);
  border-radius: 8px;
  padding: 16px;
  background: var(--yunnan-panel);
}

.cgn-yunnan__facts span,
.cgn-yunnan__facts strong,
.cgn-yunnan__facts em {
  display: block;
  font-style: normal;
}

.cgn-yunnan__facts span,
.cgn-yunnan__facts em {
  color: var(--yunnan-muted);
  font-size: 0.8rem;
}

.cgn-yunnan__facts strong {
  margin: 8px 0 5px;
  color: var(--yunnan-ink);
  font-size: clamp(1.7rem, 3vw, 2.4rem);
  line-height: 1;
}

.cgn-yunnan__section,
.cgn-yunnan__timeline,
.cgn-yunnan__sources {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}

.cgn-yunnan__section {
  padding: clamp(54px, 8vw, 96px) 0;
}

.cgn-yunnan__section--split {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(320px, 1.2fr);
  gap: clamp(30px, 6vw, 88px);
}

.cgn-yunnan h2 {
  max-width: 12ch;
  margin-top: 13px;
  font-size: clamp(2.15rem, 4.6vw, 4rem);
  line-height: 1.02;
  letter-spacing: 0;
  text-wrap: balance;
}

.cgn-yunnan__section--split > p,
.cgn-yunnan__decision-head p,
.cgn-yunnan__sources p {
  color: var(--yunnan-soft);
  font-size: 1rem;
  line-height: 1.9;
  text-wrap: pretty;
}

.cgn-yunnan__timeline {
  display: grid;
  gap: 12px;
  padding-bottom: clamp(34px, 6vw, 70px);
}

.cgn-yunnan__timeline article {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 18px;
  border-top: 1px solid var(--yunnan-line);
  padding: 20px 0 10px;
}

.cgn-yunnan__timeline-index {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: oklch(0.14 0.04 190);
  background: var(--yunnan-cyan);
  font-weight: 800;
}

.cgn-yunnan__timeline strong {
  display: block;
  font-size: 1.05rem;
}

.cgn-yunnan__timeline p {
  margin-top: 8px;
  color: var(--yunnan-soft);
  line-height: 1.82;
}

.cgn-yunnan__timeline em {
  display: inline-flex;
  margin-top: 10px;
  color: var(--yunnan-green);
  font-size: 0.82rem;
  font-style: normal;
}

.cgn-yunnan__decision-head {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 32px;
}

.cgn-yunnan__decision-head p {
  max-width: 48ch;
}

.cgn-yunnan__decision-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
  margin-top: 34px;
}

.cgn-yunnan__decision-grid article {
  border: 1px solid var(--yunnan-line);
  border-radius: 8px;
  padding: 18px;
  background: oklch(0.14 0.033 210 / 0.68);
}

.cgn-yunnan__decision-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--yunnan-cyan);
  background: oklch(0.82 0.13 185 / 0.12);
}

.cgn-yunnan__decision-grid strong {
  display: block;
  margin-top: 16px;
}

.cgn-yunnan__decision-grid p {
  margin-top: 8px;
  color: var(--yunnan-muted);
  font-size: 0.92rem;
  line-height: 1.75;
}

.cgn-yunnan__sources {
  border-top: 1px solid var(--yunnan-line);
  padding: 28px 0 44px;
}

.cgn-yunnan__sources > div {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--yunnan-cyan);
  font-weight: 760;
}

.cgn-yunnan__sources p {
  max-width: 72ch;
  margin-top: 10px;
}

.cgn-yunnan__sources ul {
  display: grid;
  gap: 8px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}

.cgn-yunnan__sources a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--yunnan-ink);
  text-decoration: none;
}

.cgn-yunnan__sources a:hover {
  color: var(--yunnan-cyan);
}

@media (max-width: 900px) {
  .cgn-yunnan__hero-inner,
  .cgn-yunnan__section--split,
  .cgn-yunnan__decision-head {
    grid-template-columns: 1fr;
  }

  .cgn-yunnan__hero-inner {
    align-items: start;
  }

  .cgn-yunnan__decision-head {
    display: grid;
    align-items: start;
  }
}

@media (max-width: 620px) {
  .cgn-yunnan__top,
  .cgn-yunnan__hero-inner,
  .cgn-yunnan__section,
  .cgn-yunnan__timeline,
  .cgn-yunnan__sources {
    width: min(100% - 32px, 1180px);
  }

  .cgn-yunnan__top {
    flex-direction: column;
    align-items: stretch;
  }

  .cgn-yunnan h1 {
    font-size: clamp(2.55rem, 16vw, 4rem);
  }

  .cgn-yunnan__facts {
    grid-template-columns: 1fr;
  }

  .cgn-yunnan__timeline article {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cgn-yunnan__media video {
    display: none;
  }
}

@media (max-width: 768px) {
  .cgn-yunnan__hero-inner { grid-template-columns: 1fr; }
  .cgn-yunnan__section--split { grid-template-columns: 1fr; }
  .cgn-yunnan__decision-grid { grid-template-columns: 1fr; }
}
</style>
