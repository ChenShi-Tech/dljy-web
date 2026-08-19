import {
  Gauge,
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
  Table2,
  ListChecks,
  Map as MapIcon,
  Upload
} from 'lucide-vue-next'
import { yunnanTradingNavigation } from '../features/yunnanTrading/navigation'
import { REPORTS_FEATURE_ENABLED } from '../features/reports/config'
import { reportsNavigation } from '../features/reports/navigation'
import { GRID_GEO_FEATURE_ENABLED } from '../features/gridGeo/config'
import { gridGeoNavigation } from '../features/gridGeo/navigation'
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
      { path: '/sjfx/fshq', title: '分时行情', icon: LineChart },
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
    // 排序按交易动线：晨报→申报前体检→（申报/复盘在「现货交易」组）→政策/储能专项→通用对话。
    // 「交易策略实验室」已随 #1799 删除（研究沙盘、示意数据，能力由风控阈值面板与敞口看板承接）。
    // 首项「智能体工作台」为通用对话入口（/ai-agent，带会话历史侧栏、persistHistory），
    // 其余为专项 AgentChatPanel 薄壳，各带独立 promptKey；所有子项 path 与 promptKey 不变（后端白名单 pages.py 不动）。
    // 编排配置类（AI工作流中枢/Dify/LangGraph）已移入「系统管理」，它们是配置工具、非交易员日常动线。
    // 日前竞价空间(/ycsj/jjkj) 已收口进「预测数据回放」hub（SP-4a），改 redirect 保深链。
    // pi PoC 临时入口 `/strategic-qa` `/declaration-checkup` 已从菜单摘除（#1937 阶段一），路由与 governance 授权保留以维持深链可达。
    path: '/ai-copilot',
    title: 'AI 交易助手',
    icon: Bot,
    children: [
      { path: '/ai-agent', title: '智能体工作台', icon: BrainCircuit },
      { path: '/xhjy/morning-brief', title: '交易晨报', icon: FileText },
      { path: '/xhjy/presubmit-check', title: '申报前体检', icon: ShieldCheck },
      { path: '/xhjy/policy-intel', title: '政策情报官', icon: Compass },
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
      // 数据接入向导为数据管理组首项（#885）：从用户体验出发的六类数据旅程总览 + 一键生效闭环，
      // 把散落 3 个导航组的数据进入线收成一张「先做什么、点哪生效、去哪见数」的地图。
      // #2174 P2-2b：管理四页（向导/导入/摄取/治理）迁独立数据运维台，本组只留探查工具。
      { path: '/yygl/data-browser', title: '通用数据浏览器', icon: Table2 }
    ]
  },
  {
    // 数据运维域（#2174 P2-2b）：六管理页已迁独立数据运维台（/ops-console.html），
    // 主前端只留桥接入口；本组仅 ADMIN 可见（adminOnlyRoutes 同口径）。
    path: '/data-ops',
    title: '数据运维',
    icon: Upload,
    children: [
      { path: '/data-ops/console', title: '数据运维台', icon: Upload }
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
          { path: '/xhjy/calibration', title: '地区决策标定', icon: BrainCircuit },
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
      { path: '/system/accounts', title: '用户与权限', icon: Users }
    ]
  }
]
