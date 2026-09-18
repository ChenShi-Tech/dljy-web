import {
  Gauge,
  FileSliders,
  Coins,
  CalendarRange,
  LineChart,
  ChartSpline,
  Bot,
  Network,
  FileText,
  Calculator,
  ShieldCheck,
  Users,
  Compass,
  CloudSun,
  BrainCircuit,
  Building2,
  Factory,
  Database,
  FileChartColumn,
  ChartColumn,
  Table2,
  ListChecks,
  Map as MapIcon,
  Wrench
} from 'lucide-vue-next'
import { yunnanTradingNavigation } from '../features/yunnanTrading/navigation'
import { REPORTS_FEATURE_ENABLED } from '../features/reports/config'
import { reportsNavigation } from '../features/reports/navigation'
import { GRID_GEO_FEATURE_ENABLED } from '../features/gridGeo/config'
import { gridGeoNavigation } from '../features/gridGeo/navigation'
import { listInsightNavigation } from '@/services/region/insightWorkspace'
import type { SubjectType } from '@/services/governance'

// 冻结下架（简化 IA·PR-A）：演示/静态占位分组默认从侧边栏摘除（代码与路由保留、深链可达），
// 需要演示时在 .env.local 置 1 恢复显示。
const CALCULATORS_NAV_ENABLED = import.meta.env.VITE_ENABLE_CALCULATORS_NAV === '1'
const REGION_COMMON_NAV_ENABLED = import.meta.env.VITE_ENABLE_REGION_COMMON_NAV === '1'

export type NavItem = {
  path: string
  title: string
  icon: object
  regionIds?: string[]
  children?: NavItem[]
  // 演示能力标记：菜单分组/子项渲染「演示」标签，提示该域为 demo-only（不再投开发）。
  demo?: boolean
  // 立场亲和（#2193 · #2196）：该页面属于哪个市场立场的专属工作台。缺省 = 共享
  // （发电/售电/储能全立场可见）；组合/集团视角（TRADER/GROUP）恒全可见。
  // 只做叶子级标注，分组内常混排共享与专属页（如公司管理：台账属发电、合同共享）。
  stanceAffinity?: SubjectType[]
  // #2991：在这些地区只从菜单摘除入口（filterNavigationForUser 生效），不影响路由可达
  // 与权限——旧链接/收藏深链仍可直接访问，由页面自身显示可解释的降级说明。
  // 与 regionIds（显式圈定可见地区）互补：regionIds 是「只在哪些地区显示」，
  // hiddenInRegionIds 是「只在哪些地区隐藏」。
  hiddenInRegionIds?: string[]
}

// 按交易工作流组织的菜单（信息架构重构，见 docs/agent-harness/主题与信息架构规划.md §2）。
// 重要约定：子项 path 全部保持真实路由不变（权限按子项路径前缀匹配）；
// 顶级分组 path 为合成路径，仅作菜单分组标识，不对应路由。
export const navigation: NavItem[] = [
  {
    // 工作流：市场发生了什么（回看与解读）
    path: '/insight',
    title: '市场洞察',
    icon: ChartSpline,
    children: [
      { path: '/insight/cockpit', title: '市场洞察驾驶舱', icon: Gauge },
      // #2991：云南没有撮合分时行情来源（sdpt_fshq 为山西三德私有族），菜单在云南隐藏；
      // 路由保持可达（degraded），直接访问由 FshqView 显示可解释降级卡 + 价格分析入口。
      { path: '/sjfx/fshq', title: '分时行情', icon: LineChart, hiddenInRegionIds: ['yunnan'] },
      { path: '/sjfx/zrsjg', title: '价格分析', icon: ChartSpline },
      { path: '/sjfx/zcqxhdl', title: '出清现货电量分析', icon: LineChart },
      { path: '/sjfx/zrxgx', title: '现货价格×新能源', icon: ChartSpline, stanceAffinity: ['GENERATOR'] },
      { path: '/sjfx/zrxgx2', title: '现货价格×统调负荷', icon: ChartSpline },
      { path: '/sjfx/actualLoad', title: '逐日系统负荷', icon: LineChart },
      { path: '/sjfx/singleZsjfx', title: '综合数据分析', icon: ChartSpline },
      { path: '/sjfx/market-ops', title: '市场经营分析', icon: ChartSpline },
      // 云南专属真实页 fold 入市场洞察（切云南才现）
      // price-output-linkage 已并入云南交易工作台 tab（父 Issue #456），市场洞察外层不再单列
      { path: '/xhjy/yunnan/node-price', title: '节点电价分析', icon: Network, regionIds: ['yunnan'], stanceAffinity: ['GENERATOR'] },
      { path: '/xhjy/yunnan/settlement-price', title: '结算价分析', icon: Coins, regionIds: ['yunnan'] }
    ]
  },
  ...(GRID_GEO_FEATURE_ENABLED ? [gridGeoNavigation] : []),
  {
    // 工作流：现货交易执行
    path: '/spot-trading',
    title: '现货交易',
    icon: LineChart,
    children: [
      // 现货交易旗舰首页（现货交易分组首位）：全国通用层(日程条/价格主图/风控/披露/报价方案/智能体任务)
      // + 云南增强层(身份区域 hero + 分组 tab + 7 panel)。原云南交易工作台 /xhjy/yunnan 已并入此页
      // （身份区域 + 全部 7 tab 迁入；旧 /xhjy/yunnan 及 11 个 alias 子路径 redirect 到 /dashboard?tab=，深链不丢）。
      { path: '/dashboard', title: '现货交易驾驶舱', icon: Gauge },
      // 交易员一日作业台：v1.0 日常运营七步单页承载（晨会复盘→早间分析→方向判断→申报执行→出清分析→补仓→日报收尾），
      // 各步产出串成一条链、步骤切换只发生在页内。早间分析/放行清单/储能计划/决策日志等旧独立页已并入。
      { path: '/xhjy/trading-day', title: '一日作业台', icon: ListChecks },
      { path: '/xhjy/monitor', title: '实时监盘', icon: LineChart },
      { path: '/xhjy/zrqsb', title: '日前上报', icon: FileText, stanceAffinity: ['GENERATOR'] },
      { path: '/xhjy/zptqx', title: '日前电量预估', icon: ChartSpline },
      { path: '/xhjy/desk', title: '申报工作台', icon: Bot },
      { path: '/xhjy/approvals', title: '申报审批队列', icon: FileText },
      { path: '/xhjy/review', title: '复盘中心', icon: ChartSpline },
      { path: '/xhjy/risk-center', title: '风控阈值面板', icon: Gauge },
      // 云南交易工作台侧栏入口已移除（其功能并入首位「现货交易驾驶舱」/dashboard）。
      // yunnanTradingNavigation 现为 null，此 spread 展开为空数组；保留注入点以便回滚恢复独立入口。
      ...(yunnanTradingNavigation ? [yunnanTradingNavigation] : [])
    ]
  },
  {
    // 工作流：中长期交易执行
    path: '/medium-long-term-trading',
    title: '中长期交易',
    icon: CalendarRange,
    children: [
      // 云南中长期售电 P1（dljy#2939）：合同与月度持仓；P2/P3 入口在下方，复盘未交付不出现空壳菜单。
      { path: '/zcqjy/contracts', title: '售电合同', icon: FileText },
      { path: '/zcqjy/positions', title: '月度持仓', icon: ChartColumn },
      // 云南中长期售电 P2（dljy#2971）：分时分解与场站分配已交付。
      { path: '/zcqjy/positions/intervals', title: '分时持仓', icon: ChartSpline },
      { path: '/zcqjy/positions/stations', title: '场站维度持仓', icon: Factory },
      // 云南中长期售电 P3（dljy#2973）：售电目标与方案、交易公告日历与提交登记已交付；与敞口/交易月历分开，不引入现货或预测口径。
      { path: '/zcqjy/plans', title: '售电计划', icon: ListChecks },
      { path: '/zcqjy/execution', title: '交易执行', icon: Compass },
      { path: '/zcqjy/adjustments', title: '合同调整', icon: FileSliders },
      { path: '/zcqjy/zccljk', title: '中长期持仓监控', icon: Gauge },
      { path: '/zcqjy/exposure', title: '中长期敞口看板', icon: Gauge },
      { path: '/zcqjy/zfsdjy', title: '中长期分时段交易', icon: ChartSpline },
      { path: '/zcqjy/zjyap', title: '交易月历', icon: CalendarRange },
      { path: '/sjxh/zjzzt', title: '省间中长期电量计划', icon: Network }
    ]
  },
  {
    // 工作流：明天会怎样（前瞻输入）— 决策链路起点，紧随公司管理
    path: '/forecast',
    title: '预测数据',
    icon: Compass,
    children: [
      // 五个预测页面由单一预测中心的一级 tab 承载；旧路径仍以 redirect 保持可访问。
      { path: '/ycsj/center', title: '预测中心', icon: BrainCircuit }
    ]
  },
  {
    // 工作流：AI 交易助手（简化 IA·PR-B），原「智能实验室」+「智能 Copilot」两组并一组，只收敛入口、功能零删减。
    // 「交易策略实验室」已随 #1799 删除（研究沙盘、示意数据，能力由风控阈值面板与敞口看板承接）。
    //
    // **六个对话入口已合并进 `/ai-agent`（主仓 #2023/#2237）**：交易晨报 / 申报前体检 /
    // 政策情报官 / 战略问答 / 申报体检原本各是一个 AgentChatPanel 薄壳，差异只有「scenario +
    // 页面提示 key + 启动问 + 挂件」四项，现由 `services/agent/workbenchEntries.ts` 声明、
    // 工作台顶部切换。五条旧路径改 redirect 带 `?entry=` 保深链（外部书签与审批卡里的绝对
    // URL 不失效）。
    // 储能投资收益测算**不合并**：它不是对话壳而是 6 步状态机工作台（本地公式预览 + 套利/MILP +
    // 投资评估独立落库 + 三页互链），对话只是其中一步，壳承载不了其余五步。
    // 编排配置类（AI工作流中枢/Dify/LangGraph）已移入「系统管理」，它们是配置工具、非交易员日常动线。
    // 日前竞价空间(/ycsj/jjkj) 已收口进「预测数据回放」hub（SP-4a），改 redirect 保深链。
    path: '/ai-copilot',
    title: 'AI 交易助手',
    icon: Bot,
    children: [
      { path: '/ai-agent', title: '智能体工作台', icon: BrainCircuit },
      { path: '/xhjy/storage-copilot', title: '储能投资收益测算', icon: Calculator }
    ]
  },
  {
    path: '/gsgl',
    title: '公司管理',
    icon: Building2,
    children: [
      { path: '/gsgl/overview', title: '经营总览大屏', icon: Gauge },
      { path: '/gsgl/profile', title: '公司档案', icon: Building2 },
      { path: '/gsgl/assets', title: '场站机组台账', icon: Factory, stanceAffinity: ['GENERATOR'] },
      { path: '/gsgl/output', title: '机组出力', icon: ChartSpline, stanceAffinity: ['GENERATOR'] },
      { path: '/gsgl/trades', title: '历史交易', icon: CalendarRange },
      { path: '/gsgl/contracts', title: '合同管理', icon: FileText },
      { path: '/gsgl/report-workshop', title: '报告工坊', icon: FileChartColumn },
      ...(REPORTS_FEATURE_ENABLED ? [reportsNavigation] : [])
    ]
  },
  // 冻结下架：离线计算器组默认摘除（VITE_ENABLE_CALCULATORS_NAV=1 恢复；路由保留深链可达）。
  // 条件展开会让字面量丢失上下文类型（stanceAffinity 退化成 string[]），故显式标 NavItem[]。
  ...(CALCULATORS_NAV_ENABLED
    ? ([{
        // 离线计算器（投资 + 电价合并）
        path: '/calculators',
        title: '测算工具',
        icon: Calculator,
        children: [
          { path: '/tzcs/wind-solar', title: '新能源资产测算', icon: Calculator, stanceAffinity: ['GENERATOR'] },
          { path: '/tzcs/truck-charging', title: '重卡充换电测算', icon: Calculator },
          { path: '/djcs/retail-price', title: '售电电价测算', icon: Calculator, stanceAffinity: ['RETAILER'] },
          { path: '/djcs/interprovincial-price', title: '跨省跨区电价', icon: Calculator }
        ]
      }] as NavItem[])
    : []),
  {
    // 横向工具域：数据动作链（手录 → 自动摄取 → 回放探查），对标「测算工具」收口范式。
    // 子项 path 全不变（RBAC 按 /yygl 前缀匹配，零影响）；data-browser 从市场洞察迁入
    // （修订 IA §2.2：它是探查工具，非市场洞察内容页）。
    path: '/data-mgmt',
    title: '数据管理',
    icon: Database,
    children: [
      // 数据运维工作台：上传中心 / 导入融合台 / 接入向导 / 摄取管理 / 治理控制台 / 数据源接入
      // 六页 + 运维总览的单页 tab 入口（原独立控制台收回主平台，见 DataOpsConsoleView 头注）。
      // 仅 ADMIN/BOSS 可见（governance.adminOnlyRoutes 同口径），其余角色本组只看到浏览器。
      { path: '/data-ops/console', title: '数据运维工作台', icon: Wrench },
      { path: '/yygl/data-browser', title: '通用数据浏览器', icon: Table2 }
    ]
  },
  {
    // 后台事务与资料
    path: '/operations',
    title: '运营与资料',
    icon: Network,
    children: [
      { path: '/yygl/ops', title: '运营中枢', icon: Network },
      { path: '/sdzl/zptwd', title: '交易平台文档', icon: FileText }
    ]
  },
  // 冻结下架：地区通用静态组默认摘除（VITE_ENABLE_REGION_COMMON_NAV=1 恢复）。三条路由保留：
  // /sdzl/region-rules 仍是路由守卫地区不匹配的兜底落地页，/xhjy/region|calibration 深链与 governance 授权组不变。
  ...(REGION_COMMON_NAV_ENABLED
    ? [{
        // 地区通用入口（跨地区可见，无 regionIds）：现货概览 / 决策标定 / 规则体系。
        // 顶级分组 path 为合成路径，仅作菜单分组标识；子项 path 为真实路由。
        path: '/region-common',
        title: '地区通用',
        icon: MapIcon,
        children: [
          { path: '/xhjy/region', title: '地区现货概览', icon: LineChart },
          { path: '/sdzl/region-rules', title: '地区规则体系', icon: Network }
        ]
      }]
    : []),
  {
    // 长周期背景参考
    path: '/environment',
    title: '环境参考',
    icon: CloudSun,
    children: [
      { path: '/sjfx/tqyb', title: '天气预报', icon: CloudSun },
      { path: '/sjfx/jieqi', title: '24节气', icon: CalendarRange },
      { path: '/sjfx/elninolanina', title: '厄尔尼诺拉尼娜', icon: ChartSpline }
    ]
  },
  {
    path: '/system',
    title: '系统管理',
    icon: ShieldCheck,
    children: [
      // AI 工作室：技能/子智能体/Dify 工作流/高级编排/定时任务五页 tab 化合并（原分散于本组与
      // 「智能实验室」组；「AI工作流中枢」作为它们的导航壳被 tab 栏取代，已删）。
      { path: '/system/ai-studio', title: 'AI 工作室', icon: Bot },
      // 用户与权限：账号目录、登录会话与权限矩阵 tab 化合并。
      { path: '/system/accounts', title: '用户与权限', icon: Users },
      // 推理模型管理（dljy#2465）：南洋推理服务的唯一管理面，ADMIN/BOSS 可见
      { path: '/system/models', title: '推理模型管理', icon: BrainCircuit }
    ]
  }
]

// 市场洞察地区工作区导航装配（dljy#2995 阶段 A）
// ----------------------------------------------------------------------------
// 纯函数：当某地区已启用「装配型」洞察工作区且有已交付页时，把「市场洞察」分组
// （path '/insight'）的直接子项原位替换为工作区 delivered 页；其余任何情况（未注册、
// 开关未启用、兼容型登记、已启用但无已交付页）都保持现有 children 原样。
// 替换后的 children 仍走 filterNavigationForUser / filterNavigationForStance 过滤链，
// 权限与立场过滤逻辑不变；其他分组永不触碰。
export function applyInsightWorkspaceNavigation(items: NavItem[], regionId: string): NavItem[] {
  const entries = listInsightNavigation(regionId)
  if (!entries) return items
  return items.map((item) => {
    if (item.path !== '/insight' || !item.children) return item
    // InsightNavEntry 与 NavItem 必填字段（path/title/icon）结构兼容，icon 由内核按页 id 提供
    const children: NavItem[] = entries.map((entry) => ({ ...entry }))
    return { ...item, children }
  })
}
