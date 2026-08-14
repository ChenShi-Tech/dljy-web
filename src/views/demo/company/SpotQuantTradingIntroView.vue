<script setup lang="ts">
import { ArrowLeft, ArrowRight, CheckCircle2, Gauge, LineChart, Lock, ShieldCheck, Zap } from 'lucide-vue-next'
import spotVideo from '../../../assets/login/power-market-login-loop.mp4'
import spotPoster from '../../../assets/login/power-market-quant-dashboard.png'
import story01 from '../../../assets/spot-quant/story-01-market-open.png'
import story02 from '../../../assets/spot-quant/story-02-renewables-enter.png'
import story03 from '../../../assets/spot-quant/story-03-96-point-price.png'
import story04 from '../../../assets/spot-quant/story-04-strategy-lab.png'
import story05 from '../../../assets/spot-quant/story-05-risk-boundary.png'
import story06 from '../../../assets/spot-quant/story-06-login-gateway.png'

const storyScenes = [
  {
    id: 'market-open',
    step: '01',
    kicker: '市场开盘',
    title: '电价开始移动，交易才真正开始',
    lead: '电力现货价格不是一张固定表。它随负荷、网架、天气和新能源出力持续变化。',
    body: '第一步不是下单，而是看见价格如何沿着时间推进。曲线、节点和市场深度共同告诉交易员：今天的风险和机会正在生成。',
    image: story01,
    alt: '深色电力交易大厅中，现货价格曲线和网架节点在大屏上推进',
    caption: '现货价格从静态表格变成连续曲线。',
    points: ['价格曲线开始波动', '网架节点出现约束信号', '市场深度提示流动性']
  },
  {
    id: 'renewables-enter',
    step: '02',
    kicker: '风光储入场',
    title: '风、光、储不是背景，是交易变量',
    lead: '新能源资产的出力波动会改变价格预期，储能则把时间价值带进策略空间。',
    body: '当风电、光伏和储能接入同一张市场视图，交易判断就从“看价格”变成“看资产如何影响价格”。',
    image: story02,
    alt: '风电、光伏和储能资产通过蓝色能量流接入电力交易界面',
    caption: '资产出力进入价格、负荷和储能约束的同一视野。',
    points: ['风电爬坡改变供给', '光伏扰动影响午间价差', '储能提供跨时段选择']
  },
  {
    id: 'price-curve',
    step: '03',
    kicker: '96 点价格',
    title: '一天被切成 96 个交易判断',
    lead: '日前和日内滚动曲线，把一天拆成可比较、可预测、可复盘的价格节奏。',
    body: '量化交易关注的不是单个高价点，而是整条曲线里的形态、拐点、置信区间和可执行窗口。',
    image: story03,
    alt: '电力交易终端中多条价格、负荷和新能源预测曲线沿时间轴展开',
    caption: '曲线形态决定策略节奏，置信区间决定风险预算。',
    points: ['日前曲线建立基线', '日内滚动修正预测', '价差窗口进入候选策略']
  },
  {
    id: 'strategy-lab',
    step: '04',
    kicker: '策略实验',
    title: '把预测变成可以回测的策略',
    lead: '预测本身不是策略。策略需要目标、约束、历史场景和可解释的参数。',
    body: '价格预测、合约头寸、新能源出力和储能约束会被放入同一张实验台，先做回测，再判断是否值得进入业务执行链。',
    image: story04,
    alt: '策略实验界面中多条输入曲线进入 AI 决策模型并输出回测路径',
    caption: '策略实验把行情信号转成可审阅的假设。',
    points: ['定义套利或对冲目标', '写入合约和储能约束', '用历史场景验证收益和回撤']
  },
  {
    id: 'risk-boundary',
    step: '05',
    kicker: '风险边界',
    title: '能赚钱的策略，也要先过风险门',
    lead: '偏差考核、回撤、结算归因和人工审核，是电力交易策略的执行边界。',
    body: '策略执行前需要通过权限、额度、幂等、审计和人工确认，模型输出不能直接等同于交易指令。',
    image: story05,
    alt: '电力交易曲线穿过安全风险门和审计节点后进入结算归因路径',
    caption: '风险门把模型建议和真实执行隔离开。',
    points: ['偏差成本进入风控', '回撤限制策略暴露', '审计和人工确认保留责任边界']
  },
  {
    id: 'login-gateway',
    step: '06',
    kicker: '进入系统',
    title: '进入授权策略实验室',
    lead: '策略实验、账号权限、业务数据和复盘结果在登录后使用。',
    body: '授权用户可进入策略实验、回测、风险复核和业务数据。',
    image: story06,
    alt: '安全入口打开，内部电力交易策略实验室在蓝色数据光层中呈现',
    caption: '登录后进入真实权限范围内的策略实验。',
    points: ['策略实验', '业务数据', '权限与审计']
  }
]
</script>

<template>
  <main class="spot-story">
    <nav class="spot-story__top" aria-label="页面导航">
      <a href="/demo/cgn-new-energy"><ArrowLeft :size="16" /> 返回风光储门户</a>
      <a href="/login">登录系统 <ArrowRight :size="16" /></a>
    </nav>

    <section class="spot-story__hero">
      <div class="spot-story__hero-media" aria-hidden="true">
        <img :src="spotPoster" alt="" />
        <video autoplay muted loop playsinline preload="metadata" :poster="spotPoster">
          <source :src="spotVideo" type="video/mp4" />
        </video>
        <div class="spot-story__hero-veil"></div>
      </div>

      <div class="spot-story__hero-inner">
        <div class="spot-story__hero-copy">
          <span class="spot-story__label">连续叙事 · 电力现货量化交易</span>
          <h1>电力现货交易不是按钮，而是一条从价格到风险的决策链</h1>
          <p>
            下滑阅读 6 个分镜：看见价格如何移动，看见风光储如何改变市场，再看见策略为什么必须先实验、再风控、最后进入授权系统。
          </p>
          <div class="spot-story__hero-actions">
            <a class="spot-story__primary" href="#market-open">开始阅读</a>
            <a href="/login">登录系统</a>
          </div>
        </div>

        <aside class="spot-story__hero-panel" aria-label="故事章节">
          <LineChart :size="20" />
          <strong>6 段连续下滑</strong>
          <ol>
            <li v-for="scene in storyScenes" :key="scene.id">
              <a :href="`#${scene.id}`">
                <span>{{ scene.step }}</span>
                {{ scene.kicker }}
              </a>
            </li>
          </ol>
        </aside>
      </div>
    </section>

    <section class="spot-story__flow" aria-label="电力现货量化交易连续故事">
      <aside class="spot-story__rail" aria-label="章节进度">
        <span>故事线</span>
        <a v-for="scene in storyScenes" :key="scene.id" :href="`#${scene.id}`">{{ scene.step }}</a>
      </aside>

      <article
        v-for="(scene, index) in storyScenes"
        :id="scene.id"
        :key="scene.id"
        :class="['spot-story__scene', { 'spot-story__scene--reverse': index % 2 === 1 }]"
        :style="{ '--scene-image': `url(${scene.image})` }"
        :aria-label="scene.alt"
      >
        <div class="spot-story__scene-inner">
          <div class="spot-story__scene-copy">
            <span class="spot-story__scene-step">{{ scene.step }} / 06 · {{ scene.kicker }}</span>
            <h2>{{ scene.title }}</h2>
            <p class="spot-story__scene-lead">{{ scene.lead }}</p>
            <p>{{ scene.body }}</p>
            <ul>
              <li v-for="point in scene.points" :key="point">
                <CheckCircle2 :size="16" />
                <span>{{ point }}</span>
              </li>
            </ul>
            <p class="spot-story__scene-caption">
              <ShieldCheck :size="15" />
              {{ scene.caption }}
            </p>
          </div>
        </div>
      </article>
    </section>

    <section class="spot-story__boundary" aria-label="策略权限与执行边界">
      <div>
        <Gauge :size="22" />
        <h2>策略执行需要权限和审计</h2>
        <p>客户账号、申报、成交、结算明细和收益数据仅在授权范围内使用。</p>
      </div>
      <ul>
        <li><Lock :size="16" /> 策略执行前校验账号、角色和数据范围。</li>
        <li><ShieldCheck :size="16" /> 策略实验保留回测、风控和复盘记录。</li>
        <li><Zap :size="16" /> 交易建议与执行指令保持隔离。</li>
      </ul>
    </section>

    <section class="spot-story__cta">
      <div>
        <h2>进入策略工作流</h2>
        <p>登录后按权限进入申报、复盘、风控复核和业务数据。</p>
      </div>
      <nav aria-label="策略工作流入口">
        <a class="spot-story__primary" href="/login">登录系统</a>
        <a href="/dashboard">已登录进入现货交易驾驶舱 <ArrowRight :size="15" /></a>
      </nav>
    </section>
  </main>
</template>

<style scoped>
.spot-story {
  --story-bg: oklch(0.09 0.028 228);
  --story-ink: oklch(0.96 0.014 196);
  --story-soft: oklch(0.8 0.034 205);
  --story-muted: oklch(0.68 0.026 210);
  --story-line: oklch(0.78 0.08 190 / 0.22);
  --story-panel: oklch(0.135 0.034 220 / 0.78);
  --story-cyan: oklch(0.82 0.13 185);
  --story-green: oklch(0.78 0.16 155);
  --story-amber: oklch(0.84 0.13 82);
  min-height: 100vh;
  background: var(--story-bg);
  color: var(--story-ink);
  scroll-behavior: smooth;
}

.spot-story__top {
  position: fixed;
  z-index: 20;
  top: 0;
  left: 50%;
  width: min(1180px, calc(100% - 48px));
  transform: translateX(-50%);
  padding: 24px 0 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
}

.spot-story__top a,
.spot-story__hero-actions a,
.spot-story__cta a {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--story-line);
  border-radius: 8px;
  padding: 0 14px;
  color: var(--story-ink);
  background: oklch(0.115 0.032 220 / 0.82);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 760;
  pointer-events: auto;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.spot-story__top a:hover,
.spot-story__hero-actions a:hover,
.spot-story__cta a:hover {
  transform: translateY(-2px);
  border-color: oklch(0.82 0.13 185 / 0.48);
}

.spot-story__primary {
  border-color: transparent !important;
  color: oklch(0.14 0.04 190) !important;
  background: linear-gradient(135deg, var(--story-cyan), var(--story-green)) !important;
  box-shadow: 0 18px 46px oklch(0.78 0.16 155 / 0.22);
}

.spot-story__hero {
  position: relative;
  min-height: 100svh;
  overflow: hidden;
  isolation: isolate;
}

.spot-story__hero-media,
.spot-story__hero-media img,
.spot-story__hero-media video,
.spot-story__hero-veil {
  position: absolute;
  inset: 0;
}

.spot-story__hero-media {
  z-index: -2;
  background: var(--story-bg);
}

.spot-story__hero-media img,
.spot-story__hero-media video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.spot-story__hero-media video {
  opacity: 0.72;
}

.spot-story__hero-veil {
  background:
    linear-gradient(90deg, oklch(0.06 0.03 230 / 0.96) 0%, oklch(0.06 0.03 230 / 0.72) 48%, oklch(0.06 0.03 230 / 0.2) 100%),
    linear-gradient(0deg, var(--story-bg) 0%, transparent 44%),
    radial-gradient(circle at 22% 24%, oklch(0.82 0.13 185 / 0.26), transparent 30%);
}

.spot-story__hero-inner {
  width: min(1180px, calc(100% - 48px));
  min-height: 100svh;
  margin: 0 auto;
  padding: clamp(96px, 12vw, 150px) 0 clamp(54px, 7vw, 94px);
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(300px, 0.72fr);
  align-items: center;
  gap: clamp(34px, 7vw, 92px);
}

.spot-story__hero-copy {
  max-width: 820px;
}

.spot-story__label,
.spot-story__scene-step,
.spot-story__rail span {
  color: var(--story-cyan);
  font-size: 0.92rem;
  font-weight: 780;
}

.spot-story h1,
.spot-story h2,
.spot-story p {
  margin: 0;
}

.spot-story h1 {
  max-width: 13ch;
  margin-top: 18px;
  font-size: clamp(3rem, 7vw, 6rem);
  line-height: 0.96;
  letter-spacing: 0;
  text-wrap: balance;
}

.spot-story__hero-copy p {
  max-width: 70ch;
  margin-top: 24px;
  color: var(--story-soft);
  font-size: clamp(1.05rem, 1.55vw, 1.26rem);
  line-height: 1.88;
  text-wrap: pretty;
}

.spot-story__hero-actions,
.spot-story__cta nav {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 34px;
}

.spot-story__hero-panel {
  border: 1px solid var(--story-line);
  border-radius: 8px;
  padding: 22px;
  background:
    radial-gradient(circle at 84% 18%, oklch(0.84 0.13 82 / 0.13), transparent 34%),
    var(--story-panel);
  box-shadow: 0 28px 80px oklch(0 0 0 / 0.32);
}

.spot-story__hero-panel svg {
  color: var(--story-green);
}

.spot-story__hero-panel strong {
  display: block;
  margin-top: 18px;
  color: var(--story-ink);
  font-size: 1.05rem;
}

.spot-story__hero-panel ol {
  display: grid;
  gap: 9px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}

.spot-story__hero-panel a {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--story-soft);
  text-decoration: none;
  line-height: 1.45;
}

.spot-story__hero-panel span {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: oklch(0.14 0.04 190);
  background: var(--story-cyan);
  font-size: 0.78rem;
  font-weight: 850;
}

.spot-story__flow {
  position: relative;
  width: 100%;
  margin: 0;
  background: var(--story-bg);
}

.spot-story__rail {
  position: sticky;
  z-index: 4;
  top: 92px;
  width: 68px;
  height: 0;
  min-height: 280px;
  display: grid;
  gap: 10px;
  margin-left: max(20px, calc((100vw - 1180px) / 2 + 6px));
  padding: 12px 0 0;
  transform: translateY(26px);
  pointer-events: none;
}

.spot-story__rail::before {
  content: '';
  position: absolute;
  top: 52px;
  bottom: 16px;
  left: 18px;
  width: 1px;
  background: linear-gradient(180deg, var(--story-cyan), transparent);
}

.spot-story__rail span {
  margin-bottom: 6px;
}

.spot-story__rail a {
  position: relative;
  z-index: 1;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid var(--story-line);
  border-radius: 8px;
  color: var(--story-ink);
  background: var(--story-bg);
  text-decoration: none;
  font-size: 0.82rem;
  font-weight: 820;
  pointer-events: auto;
}

.spot-story__scene {
  position: relative;
  min-height: 100svh;
  display: flex;
  align-items: center;
  overflow: hidden;
  padding: clamp(96px, 11vw, 154px) 0 clamp(76px, 9vw, 126px);
  border-top: 1px solid oklch(0.78 0.08 190 / 0.16);
  background-image: var(--scene-image);
  background-position: center;
  background-size: cover;
  isolation: isolate;
  scroll-margin-top: 82px;
}

.spot-story__scene::before,
.spot-story__scene::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.spot-story__scene::before {
  z-index: -2;
  background:
    linear-gradient(90deg, oklch(0.045 0.025 225 / 0.98) 0%, oklch(0.06 0.032 225 / 0.9) 31%, oklch(0.07 0.034 225 / 0.52) 57%, oklch(0.07 0.034 225 / 0.18) 100%),
    radial-gradient(circle at 18% 42%, oklch(0.82 0.13 185 / 0.18), transparent 28%),
    linear-gradient(0deg, oklch(0.045 0.025 225 / 0.58) 0%, transparent 42%, oklch(0.045 0.025 225 / 0.2) 100%);
}

.spot-story__scene::after {
  z-index: -1;
  opacity: 0.46;
  background:
    linear-gradient(90deg, oklch(0.82 0.13 185 / 0.12) 1px, transparent 1px),
    linear-gradient(0deg, oklch(0.82 0.13 185 / 0.08) 1px, transparent 1px);
  background-size: 88px 88px;
  mask-image: linear-gradient(90deg, black 0%, black 38%, transparent 78%);
}

.spot-story__scene--reverse::before {
  background:
    linear-gradient(270deg, oklch(0.045 0.025 225 / 0.98) 0%, oklch(0.06 0.032 225 / 0.9) 31%, oklch(0.07 0.034 225 / 0.52) 57%, oklch(0.07 0.034 225 / 0.18) 100%),
    radial-gradient(circle at 82% 42%, oklch(0.82 0.13 185 / 0.18), transparent 28%),
    linear-gradient(0deg, oklch(0.045 0.025 225 / 0.58) 0%, transparent 42%, oklch(0.045 0.025 225 / 0.2) 100%);
}

.spot-story__scene--reverse::after {
  mask-image: linear-gradient(270deg, black 0%, black 38%, transparent 78%);
}

.spot-story__scene-inner {
  position: relative;
  z-index: 1;
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
  display: flex;
}

.spot-story__scene--reverse .spot-story__scene-inner {
  justify-content: flex-end;
}

.spot-story__scene-copy {
  max-width: 650px;
  text-shadow: 0 2px 18px oklch(0 0 0 / 0.56);
}

.spot-story__scene h2,
.spot-story__boundary h2,
.spot-story__cta h2 {
  max-width: 13ch;
  margin-top: 12px;
  font-size: clamp(2.15rem, 4.8vw, 4.5rem);
  line-height: 1.02;
  letter-spacing: 0;
  text-wrap: balance;
}

.spot-story__scene-lead {
  margin-top: 22px !important;
  color: oklch(0.9 0.035 195) !important;
  font-size: clamp(1.08rem, 1.6vw, 1.32rem) !important;
  line-height: 1.58 !important;
}

.spot-story__scene-copy p,
.spot-story__boundary p,
.spot-story__cta p {
  max-width: 68ch;
  margin-top: 16px;
  color: var(--story-soft);
  font-size: 1rem;
  line-height: 1.88;
  text-wrap: pretty;
}

.spot-story__scene-copy ul,
.spot-story__boundary ul {
  display: grid;
  gap: 10px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
}

.spot-story__scene-copy li,
.spot-story__boundary li {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 10px;
  align-items: start;
  color: var(--story-soft);
  line-height: 1.65;
}

.spot-story__scene-copy li svg,
.spot-story__boundary li svg {
  margin-top: 5px;
  color: var(--story-green);
}

.spot-story__scene-caption {
  width: fit-content;
  max-width: min(100%, 620px) !important;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid oklch(0.78 0.08 190 / 0.26);
  border-radius: 8px;
  padding: 9px 12px;
  color: var(--story-ink) !important;
  background: oklch(0.065 0.026 220 / 0.68);
  box-shadow: 0 16px 52px oklch(0 0 0 / 0.28);
  font-size: 0.82rem;
  line-height: 1.45;
  backdrop-filter: blur(10px);
}

.spot-story__scene-caption svg {
  flex: 0 0 auto;
  color: var(--story-cyan);
}

.spot-story__boundary,
.spot-story__cta {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
  border-top: 1px solid oklch(0.78 0.08 190 / 0.18);
}

.spot-story__boundary {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(340px, 1.1fr);
  gap: clamp(30px, 6vw, 88px);
  padding: clamp(54px, 8vw, 96px) 0;
}

.spot-story__boundary > div > svg,
.spot-story__cta nav svg {
  color: var(--story-green);
}

.spot-story__boundary h2,
.spot-story__cta h2 {
  max-width: 16ch;
  font-size: clamp(1.9rem, 3.6vw, 3rem);
}

.spot-story__boundary li {
  border-bottom: 1px solid oklch(0.78 0.08 190 / 0.14);
  padding-bottom: 12px;
}

.spot-story__cta {
  display: flex;
  justify-content: space-between;
  gap: 28px;
  align-items: center;
  padding: clamp(44px, 7vw, 84px) 0 clamp(58px, 9vw, 110px);
}

.spot-story__cta nav {
  justify-content: flex-end;
}

@media (max-width: 1180px) {
  .spot-story__rail {
    display: none;
  }
}

@media (max-width: 960px) {
  .spot-story__hero-inner,
  .spot-story__boundary {
    grid-template-columns: 1fr;
  }

  .spot-story__scene {
    background-position: 58% center;
  }

  .spot-story__scene--reverse {
    background-position: 42% center;
  }

  .spot-story__scene--reverse .spot-story__scene-inner {
    justify-content: flex-start;
  }

  .spot-story__cta {
    align-items: flex-start;
    flex-direction: column;
  }

  .spot-story__cta nav {
    justify-content: flex-start;
  }
}

@media (max-width: 620px) {
  .spot-story__top,
  .spot-story__hero-inner,
  .spot-story__scene-inner,
  .spot-story__boundary,
  .spot-story__cta {
    width: min(100% - 32px, 1180px);
  }

  .spot-story__top {
    position: absolute;
    flex-direction: column;
    align-items: stretch;
  }

  .spot-story h1 {
    font-size: clamp(2.45rem, 15vw, 4rem);
  }

  .spot-story__hero-inner {
    padding-top: 140px;
  }

  .spot-story__hero-panel {
    padding: 18px;
  }

  .spot-story__scene {
    min-height: 94svh;
    align-items: flex-end;
    padding: 136px 0 54px;
    background-position: center;
  }

  .spot-story__scene::before,
  .spot-story__scene--reverse::before {
    background:
      linear-gradient(0deg, oklch(0.045 0.025 225 / 0.98) 0%, oklch(0.05 0.028 225 / 0.94) 42%, oklch(0.055 0.03 225 / 0.56) 74%, oklch(0.055 0.03 225 / 0.28) 100%),
      radial-gradient(circle at 50% 46%, oklch(0.82 0.13 185 / 0.16), transparent 34%);
  }

  .spot-story__scene::after,
  .spot-story__scene--reverse::after {
    mask-image: linear-gradient(0deg, black 0%, black 55%, transparent 100%);
  }

  .spot-story__scene h2 {
    font-size: clamp(2rem, 11vw, 3.2rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spot-story,
  .spot-story * {
    scroll-behavior: auto !important;
    animation: none !important;
    transition-duration: 0.01ms !important;
  }

  .spot-story__hero-media video {
    display: none;
  }
}

@media (max-width: 768px) {
  .spot-story__hero-inner { grid-template-columns: 1fr; }
}
</style>
