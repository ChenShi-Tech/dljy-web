<script setup lang="ts">
// Artifact 渲染样例页（/demo/artifacts，守卫放行免登录）：用 ArtifactRenderer 渲染各类型
// 示例，无需 agent 后端。业务类型采用 agent 实际产出的丰富 schema，用于回归核对解析器容错。
import { provide } from 'vue'
import { parseArtifactBlocks } from '../../utils/artifactBlocks'
import ArtifactRenderer from '../../components/agent/artifacts/ArtifactRenderer.vue'
import { ARTIFACT_CONTEXT } from '../../components/agent/artifacts/context'

provide(ARTIFACT_CONTEXT, { submit: (t: string) => window.alert('表单回传给智能体：\n\n' + t) })

const F = '```'
const SAMPLE = `# 对话框 Artifact 全类型样例

**Markdown** 正文：*斜体*、\`行内码\`、[链接](https://example.com)、任务清单：
- [x] 已完成项
- [ ] 待办项

${F}callout warning 风险提示
偏差考核风险偏高，关注 **14:00–16:00** 时段敞口。
${F}

${F}card 现货申报测算
{"title":"现货申报测算","subtitle":"2026-06-17 日前 · 云南","metrics":[{"label":"出清均价","value":412.5,"unit":"元/MWh","delta":"+3.2%","trend":"up"},{"label":"建议申报电量","value":1200,"unit":"MWh"},{"label":"偏差风险","value":"低","tone":"down"}],"footnote":"基于合成数据，不写生产"}
${F}

${F}dljy-ui 储能投资决策卡
{"component":"StorageDecisionCard","basis":"illustrative","props":{"basis":"illustrative","decision":{"verdict":"adjust","risk_level":"yellow","reason":"峰谷价差可覆盖循环损耗，但投资单价偏高，建议压降 EPC 或等待更高价差窗口。"},"finance":{"irr_pct":8.3,"npv_wan":1260.5,"payback_years":8.7,"annual_revenue_wan":842.5}}}
${F}

${F}dljy-ui 投资财务摘要
{"component":"ProjectFinanceSummary","basis":"illustrative","props":{"formula_version":"investment-assessment.storage.v1","finance":{"total_investment_wan":30000,"equity_investment_wan":6000,"annual_revenue_wan":4200,"dynamic_payback_years":9.6}}}
${F}

${F}dljy-ui 晨报数据可用性（含 missing 缺口）
{"component":"DataQualityPanel","basis":"captured","props":{"mock":false,"items":[{"key":"clearing_da","label":"日前出清价","status":"real","source":"replay"},{"key":"forecast_band","label":"次日价格预测带","status":"forecast","source":"model","note":"非结算依据"},{"key":"position","label":"持仓敞口","status":"mock","source":"synthetic_mock"},{"key":"renewable","label":"新能源出力","status":"missing","source":null,"note":"当日回放缺失"}]}}
${F}

${F}dljy-ui 交易晨报三段式研判
{"component":"MorningBriefSummary","basis":"synthetic","props":{"headline":"今日水电主导、午间承压，晚峰有支撑","verdict":"yellow","meta":{"region_name":"云南","date":"2026-06-29"},"market":"隔夜日前均价 360 元/MWh，较前日 +3%；午间受水电满发压制走低。","strategy":"建议午间压低申报至 60%、晚峰全额，规避午间低价时段。","risk":"关注汛期负价风险与偏差考核敞口（午间段）。"}}
${F}

${F}dljy-ui 次日价格预测带
{"component":"ForecastBandCard","basis":"synthetic","props":{"unit":"元/MWh","band":{"p10":280,"p50":360,"p90":470}}}
${F}

${F}dljy-ui 风险清单
{"component":"RiskChecklist","props":{"thresholds":{"price_cap":1500,"deviation_tolerance_pct":4,"peak_valley_spread":350},"breaches":[{"label":"午间负价风险","level":"warn","detail":"13:00–15:00 水电满发，价格或逼近下限"}],"key_risks":["汛期水电消纳压力可能压低甚至负价"]}}
${F}

${F}dljy-ui 今日交易策略表
{"component":"StrategyTable","props":{"rows":[{"period":"00:00–06:00","action":"低谷增持","basis":"夜间价格低位、负荷低谷"},{"period":"10:00–15:00","action":"压低申报至 60%","basis":"水电满发压价、规避午间低价"},{"period":"19:00–22:00","action":"晚峰全额申报","basis":"晚峰价格高位"}]}}
${F}

${F}json 日前出清价格走势（误用 json 围栏，应自动识别为图表）
{"xAxis":{"type":"category","data":["00:00","04:00","08:00","12:00","16:00","20:00","24:00"]},"yAxis":{"type":"value","name":"元/MWh"},"series":[{"type":"line","smooth":true,"data":[280,220,380,460,420,510,350]}]}
${F}

${F}region-compare 云南 vs 广东现货规则
{"regions":[{"name":"云南","color":"#5470c6","rules":[{"key":"限价区间","value":"0~1500 元/MWh"},{"key":"结算模式","value":"南方区域联合出清+省内结算"},{"key":"新能源申报","value":"报量报价"},{"key":"偏差考核","value":"±5%免考核"},{"key":"价格口径","value":"统一价→节点价过渡期"}]},{"name":"广东","color":"#91cc75","rules":[{"key":"限价区间","value":"-500~1500 元/MWh"},{"key":"结算模式","value":"南方区域联合出清+省内结算"},{"key":"新能源申报","value":"报量报价"},{"key":"偏差考核","value":"±3%免考核"},{"key":"价格口径","value":"用户节点价"}]}]}
${F}

${F}declaration 云南某风电场日前申报草稿
{"date":"2026-06-10","plant":"云南XX风电场(100MW)","strategy":"午后主动压低·规避负价","priceCurve":{"name":"申报报价","unit":"元/MWh","data":[200,190,180,175,170,200,300,380,420,350,290,310,320,300,290,280,260,300,420,480,460,420,380,340]},"annotations":[{"hour":4,"text":"夜间低谷满发","type":"info"},{"hour":10,"text":"水电满发·压至60%","type":"warning"},{"hour":13,"text":"午间最低·仅报40%","type":"critical"},{"hour":19,"text":"晚峰全额申报100%","type":"info"}],"priceCap":1500}
${F}

${F}forecast 云南明日价格预测带
{"time":["00:00","04:00","08:00","12:00","16:00","20:00"],"value":[320,290,400,480,470,410],"lower":[300,270,360,430,440,380],"upper":[345,315,445,540,510,450]}
${F}

${F}storage 云南某储能电站充放计划
{"priceCurve":{"name":"日前出清价","unit":"元/MWh","data":[220,180,290,420,340,280]},"soc":[50,30,55,85,60,45],"charge":[0,30,0,0,0,20],"discharge":[20,0,15,40,15,0]}
${F}

${F}gauge 持仓风险仪表
{"title":"云南电站风控仪表盘","gauges":[{"label":"偏差敞口","value":4.2,"unit":"%","min":0,"max":15,"thresholds":[{"value":5,"color":"#67e0e3"},{"value":10,"color":"#fabe3c"},{"value":15,"color":"#e0625b"}]},{"label":"负价暴露","value":7.5,"unit":"%","min":0,"max":30,"thresholds":[{"value":10,"color":"#67e0e3"},{"value":20,"color":"#fabe3c"},{"value":30,"color":"#e0625b"}]}]}
${F}

${F}clearing 云南日前出清博弈模拟
{"scenarios":[{"name":"基准场景","probability":0.5,"clearingPrice":325,"description":"来水正常·负荷平稳·边际机组为水电","yourBid":{"price":310,"quantity":50,"result":"全中标"},"competitorAnalysis":"水电报价200-280"},{"name":"来水偏丰","probability":0.3,"clearingPrice":260,"description":"来水增20%·火电机组全停","yourBid":{"price":250,"quantity":40,"result":"全中标"},"competitorAnalysis":"水电报价降至180"},{"name":"负荷突增","probability":0.2,"clearingPrice":410,"description":"气温骤升·火电机组启动","yourBid":{"price":400,"quantity":50,"result":"部分中标(35)"},"competitorAnalysis":"火电报价350+"}],"advice":"概率加权出清价约 325 元/MWh。建议按基准场景申报，午间段预留灵活调节空间。"}
${F}

${F}settlement 云南某电站6月结算校核
{"header":["科目","中长期合约","日前现货","实时平衡","合计"],"rows":[{"label":"上网电量(MWh)","values":[5000,1200,200,6400]},{"label":"合约/出清均价(元/MWh)","values":[380,320,280,"—"]},{"label":"电费收入(万元)","values":[190.0,38.4,5.6,234.0]},{"label":"偏差电量(MWh)","values":["—","—","—",-80]},{"label":"偏差考核电费(万元)","values":["—","—","—",-1.2]},{"label":"净收入(万元)","values":[190.0,38.4,5.6,232.8]}],"diffs":[{"row":3,"col":3,"reason":"实际出力高于日前申报+80MWh","color":"#ff4d4f"},{"row":4,"col":3,"reason":"超发偏差8%>免考核5%","color":"#ff4d4f"}],"summary":"本月净收入 232.8 万元，超发偏差考核扣 1.2 万元。"}
${F}

${F}table 机组报价
{"columns":["机组","容量(MW)","报价(元/MWh)"],"rows":[["1号机组",350,420],["2号机组",300,380],["3号机组",600,510]]}
${F}

${F}timeline 决策时间线
{"events":[{"time":"09:00","title":"取价格预测","tone":"up"},{"time":"09:05","title":"凯利仓位评估","desc":"建议仓位 0.18"},{"time":"09:10","title":"等待人工审批","tone":"active"}]}
${F}

${F}cite 引用来源
{"sources":[{"title":"云南电力市场现货交易规则","source":"昆明电力交易中心","date":"2026-05","url":"https://example.com","snippet":"现货市场限价区间为 0~1500 元/MWh。"}]}
${F}

${F}math 出清结算与套利公式
\\[ R_{\\text{net}} = \\sum_{t=1}^{96} P_{\\text{DA},t} \\cdot Q_{\\text{DA},t} - \\text{Fee}_{\\text{偏差考核}} \\]
\\[ \\text{峰谷套利收益} = \\sum (P_{\\text{放}} - P_{\\text{充}}) \\times Q \\times \\eta_{\\text{效率}} \\]
${F}

${F}mermaid 申报决策流程
flowchart LR
  A[取数] --> B[分析行情]
  B --> C{风险超限?}
  C -->|是| D[输出预警]
  C -->|否| E[生成申报草稿]
  E --> F[人工审批]
${F}

${F}jsonview 工具原始返回
{"session":{"id":"sess-abc","scenario":"chat"},"metrics":{"calls":12,"tokens":3400},"tools":["get_clearing_price","calc_kelly_position"],"ok":true}
${F}

${F}python 凯利仓位
def kelly(p, b):
    return max(0.0, (p * (b + 1) - 1) / b)
${F}

${F}html 报价速算器
<div style="font:14px system-ui">
  <input id="p" type="number" value="400"> 元/MWh
  <button onclick="document.getElementById('o').textContent=(document.getElementById('p').value*1.05).toFixed(1)">+5%</button>
  <p>调整后：<b id="o">—</b></p>
</div>
${F}

${F}download 复盘报告
{"files":[{"name":"日度复盘.md","content":"# 复盘日报\\n\\n出清均价 412.5 元/MWh，偏差率 2.1%。","bytes":1280}]}
${F}

${F}form 申报参数
{"fields":[{"name":"date","label":"目标日","type":"text","placeholder":"2026-06-17"},{"name":"risk","label":"风险偏好","type":"select","options":["保守","中性","激进"]},{"name":"note","label":"备注","type":"textarea","placeholder":"可选"}],"submitLabel":"重新测算"}
${F}

${F}heatmap 一周分时电价热力(元/MWh)
{"x":["00","03","06","09","12","15","18","21"],"y":["周一","周二","周三","周四","周五"],"matrix":[[280,240,300,420,460,440,520,360],[290,250,310,430,470,450,530,370],[270,230,290,410,450,430,510,350],[300,260,320,440,480,460,540,380],[310,270,330,450,490,470,550,390]]}
${F}

${F}candlestick 日前电价 K 线(近7日)
{"points":[{"t":"6/06","open":320,"close":345,"low":310,"high":355},{"t":"6/07","open":345,"close":330,"low":322,"high":350},{"t":"6/08","open":330,"close":372,"low":325,"high":380},{"t":"6/09","open":372,"close":360,"low":350,"high":385},{"t":"6/10","open":360,"close":410,"low":355,"high":420},{"t":"6/11","open":410,"close":395,"low":388,"high":418},{"t":"6/12","open":395,"close":430,"low":390,"high":440}],"ma":[3,5],"unit":"元/MWh"}
${F}

${F}waterfall 6月售电收益分解
{"items":[{"label":"电费收入","value":234.0},{"label":"购电成本","value":-150.0},{"label":"输配电费","value":-42.0},{"label":"偏差考核","value":-1.2},{"label":"净收益","type":"total"}],"unit":"万元"}
${F}

${F}sankey 全省电量流向
{"nodes":[{"name":"风电"},{"name":"光伏"},{"name":"水电"},{"name":"主网母线"},{"name":"工业负荷"},{"name":"商业负荷"}],"links":[{"source":"风电","target":"主网母线","value":320},{"source":"光伏","target":"主网母线","value":180},{"source":"水电","target":"主网母线","value":500},{"source":"主网母线","target":"工业负荷","value":700},{"source":"主网母线","target":"商业负荷","value":290}]}
${F}

${F}pie 云南电源结构(%)
{"donut":true,"items":[{"name":"水电","value":62},{"name":"风电","value":14},{"name":"光伏","value":11},{"name":"火电","value":10},{"name":"其他","value":3}]}
${F}

${F}steps 日前申报操作流程
{"steps":[{"title":"拉取日前负荷与新能源预测","status":"done","time":"09:00"},{"title":"生成边际成本申报曲线","status":"done","time":"09:20"},{"title":"风控校验(限价/偏差/敞口)","status":"doing","desc":"当前偏差敞口 4.2%，低于 5% 阈值"},{"title":"人工复核与调整","status":"todo"},{"title":"提交交易中心","status":"todo","time":"14:00 前"}]}
${F}

${F}checklist 申报前合规检查
["交易资质在有效期内","本次申报量未超持仓额度","报价在限价区间 0~1500 内","对手方不在风控黑名单","已留存申报审批记录"]
${F}

${F}diff 申报方案调整 v1→v2
{"before":"目标日: 2026-06-17\\n峰段报价: 0.80 元/kWh\\n谷段报价: 0.30 元/kWh\\n申报容量: 100 MW\\n风险偏好: 中性","after":"目标日: 2026-06-17\\n峰段报价: 0.85 元/kWh\\n谷段报价: 0.30 元/kWh\\n申报容量: 120 MW\\n风险偏好: 激进\\n备注: 晚峰追加 20MW","beforeLabel":"v1 初稿","afterLabel":"v2 终稿"}
${F}
`
const blocks = parseArtifactBlocks(SAMPLE)
</script>

<template>
  <div class="showcase-page">
    <div class="showcase-inner">
      <h1>对话框 Artifact 渲染样例</h1>
      <p class="sub">业务类型采用 agent 实际产出的丰富 schema，共 {{ blocks.length }} 块（无需 agent 后端）· /demo/artifacts</p>
      <ArtifactRenderer :blocks="blocks" />
    </div>
  </div>
</template>

<style scoped>
.showcase-page { min-height: 100vh; background: #f3f4f6; padding: 24px; }
.showcase-inner {
  max-width: 820px; margin: 0 auto; background: #fff;
  border-radius: 12px; padding: 24px 28px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
h1 { font-size: var(--font-20); margin: 0 0 4px; }
.sub { opacity: 0.6; font-size: var(--font-md); margin: 0 0 16px; }
</style>
