// ============================================================================
// S2 晨间数据核验：八源验签、完整率与三态门禁
// ----------------------------------------------------------------------------
// 手册 0.2 节的数据可信度分级（A 实测 / B 官方预测 / C 自建模型 / D 估算沿用）与本仓
// 既有的「成熟度分级」讲的是同一件事的两个侧面，此处合并为**一套三态门禁**：
//
//   【可申报】能进申报单据 · 【可参考】只能辅助判断 · 【仅展示】连判断都不该依赖
//
// 为什么必须是门禁而不是标签：标签靠人自觉，门禁在提交路径上拦。手册 R4 规则表最后
// 一行明写「数据为 D 级 / 系统降级 → 偏置强制归零」——那是一条可执行的约束，不是提示。
//
// 与 Mock 标注红线天然合流：标了 `mock:true` 的数据一律落「仅展示」，从机制上保证
// 演示数据永远进不了申报。
// ============================================================================
export const CREDIBILITY_LABEL = {
    A: 'A 实测',
    B: 'B 官方预测',
    C: 'C 自建模型',
    D: 'D 估算/沿用'
};
export const CREDIBILITY_NOTE = {
    A: '调度/交易平台正式下发或量测回传，可直接用于申报与结算核对',
    B: '调度发布的负荷/新能源预测与边界条件，可用于申报，需记录发布时间戳',
    C: '公司自建预测，可用于判断；申报前必须与 B 类交叉校验',
    D: '数据缺失时的沿用值或人工估算，仅允许用于观望，不得作为加大暴露的依据'
};
export const USAGE_GATE_LABEL = {
    declarable: '可申报',
    reference: '可参考',
    display_only: '仅展示'
};
/** 手册 S2 步骤 1 的八条数据源。少一条即核验单不完整。 */
export const REQUIRED_SOURCES = [
    { id: 'load_forecast', label: '统调负荷预测' },
    { id: 'renewable_forecast', label: '新能源预测出力' },
    { id: 'boundary', label: '运行日边界条件' },
    { id: 'contract_position', label: '中长期持仓' },
    { id: 'storage_soc', label: '储能 SOC 实况' },
    { id: 'customer_load', label: '客户负荷' },
    { id: 'interprovincial', label: '省间信息' },
    { id: 'rulebook', label: '规则库版本' }
];
const CREDIBILITY_ORDER = ['A', 'B', 'C', 'D'];
function weakest(list) {
    return list.reduce((worst, cur) => (CREDIBILITY_ORDER.indexOf(cur) > CREDIBILITY_ORDER.indexOf(worst) ? cur : worst), 'A');
}
/**
 * 八源验签 + 完整率 + 三态门禁判定。
 *
 * 门禁规则（三者取最严）：
 *   · 完整率 ≥98% 且最弱可信度 ∈ {A,B} 且无 Mock → 可申报
 *   · 完整率 ≥95% 或最弱为 C → 可参考（申报量须向中枢收敛、暴露减半）
 *   · 完整率 <95% 或最弱为 D 或含 Mock → 仅展示（不得作为申报依据）
 *
 * 降级联动：完整率 95–98% 为一级降级（数据降级），<95% 为二级降级（模型降级）。
 */
export function assessIntegrity(sources) {
    const byId = new Map(sources.map((s) => [s.id, s]));
    const problems = [];
    const credibilities = [];
    let weightSum = 0;
    let hasMock = false;
    for (const req of REQUIRED_SOURCES) {
        const s = byId.get(req.id);
        if (!s || !s.present) {
            problems.push({ id: req.id, label: req.label, reason: '未到位' });
            continue;
        }
        const completeness = s.completeness ?? 1;
        weightSum += Math.min(Math.max(completeness, 0), 1);
        credibilities.push(s.credibility);
        if (s.mock) {
            hasMock = true;
            problems.push({ id: req.id, label: req.label, reason: '为 Mock/合成数据，不得进入申报' });
        }
        if (completeness < 1) {
            problems.push({
                id: req.id,
                label: req.label,
                reason: `内容不完整（${(completeness * 100).toFixed(1)}%）`
            });
        }
        if (s.credibility === 'D') {
            problems.push({ id: req.id, label: req.label, reason: 'D 级估算/沿用值' });
        }
    }
    const total = REQUIRED_SOURCES.length;
    const presentCount = credibilities.length;
    const rate = total > 0 ? weightSum / total : 0;
    const weak = credibilities.length ? weakest(credibilities) : 'D';
    let gate;
    if (rate < 0.95 || weak === 'D' || hasMock)
        gate = 'display_only';
    else if (rate < 0.98 || weak === 'C')
        gate = 'reference';
    else
        gate = 'declarable';
    let degradeLevel = 0;
    if (rate < 0.95)
        degradeLevel = 2;
    else if (rate < 0.98)
        degradeLevel = 1;
    const summary = gate === 'declarable'
        ? `八源齐备、完整率 ${(rate * 100).toFixed(1)}%，可作为申报依据`
        : gate === 'reference'
            ? `完整率 ${(rate * 100).toFixed(1)}%／最弱 ${CREDIBILITY_LABEL[weak]}，仅可参考：申报量须向中枢收敛、暴露减半`
            : `完整率 ${(rate * 100).toFixed(1)}%${hasMock ? '，且含 Mock 数据' : ''}${weak === 'D' ? '，且存在 D 级数据' : ''} —— 不得作为申报依据`;
    return {
        completenessRate: Math.round(rate * 10000) / 10000,
        presentCount,
        totalCount: total,
        weakestCredibility: weak,
        gate,
        degradeLevel,
        problems,
        summary
    };
}
/** 门禁是否允许提交申报。 */
export function canDeclareUnder(gate) {
    return gate === 'declarable';
}
/**
 * 门禁对申报暴露的约束系数：可申报 1.0（不打折）、可参考 0.5（暴露减半）、
 * 仅展示 0（强制中枢，不得偏置）。用于 R4 的偏置上限裁剪。
 */
export function exposureFactorOf(gate) {
    if (gate === 'declarable')
        return 1;
    if (gate === 'reference')
        return 0.5;
    return 0;
}
