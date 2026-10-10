# 练习空间（公司上下文钉住与顶栏徽标）

> ChenShi-Tech/dljy#3403 · 前端实现；后端开通接口见 ChenShi-Tech/dljy#3402，共享契约在
> `shared/company/practice-space.mjs`（上游同步，勿在本仓修改）。导引引擎是后续 PR（#3404），
> 本文只覆盖「公司上下文支持与顶栏标识」这一层。

## 什么是练习公司

中长期等模块的业务表不可物理删除，操作导引要让用户真实建一整套测试业务流，测试数据必须与
正式数据隔离。**练习公司** = 挂在某家真实公司（来源公司）名下、`source='PRACTICE'` 的子公司
（名称带「【练习】」前缀）。开通接口幂等：同一来源公司永远得到同一家练习公司。

- `GET /api/company/practice-space?company=<来源>` 查询；`POST` 同路径幂等开通（body 可带
  `module` / `regionId` / `seedStations`）。只有来源公司可写者（ADMIN / 本公司 BOSS）能开通。
- `/api/company/list` 返回的公司对象带 `source` 字段；练习公司不在静态地区表
  `REGION_HOME_COMPANY` / `COMPANY_REGION` 里（`companyRegionId` 返回 null）。

## 为什么要「钉住」

管理员/老板切到云南、或每次刷新公司列表时，`setCompanyOptions` → `coordinateCompanyForRegion`
会按 #668 四规则把当前公司自动协调回 `comp-cgn-yunnan`（练习公司不在静态表，不满足规则 1 的
「保持」条件）。进入练习空间后必须稳定停留在练习公司，否则导引写的数据会落到错误公司或页面
被切走。

钉住机制（`src/services/company/companyContext.ts`）：

- **存储**：localStorage 键 `dljy.companyPin`，值 `{ companyId, username, regionId, originCompanyId }`；
  读取/写入均 try/catch，损坏或字段不全视同无钉住。
- **生效条件**：存在钉住 && 同一用户（username 匹配）&& 当前公司 === 钉住公司 && 当前地区 ===
  钉住地区。用户手动切走公司后钉住**保留但失效**（供后续「回到练习空间继续」），不再拦截协调。
- **`setCompanyOptions`**：钉住生效且练习公司仍在授权集合 → 跳过四规则协调；练习公司被授权
  收回 → 解除钉住并走常规协调。
- **地区 watch**：新地区 === 钉住地区且当前公司仍是练习公司 → 不协调。
- **`resetCompanyContextToHome`**（登录/切换账号）清除钉住；`setCurrentCompanyId` 不清除。
- 练习公司**不会被**四规则的规则 2/3 自动选中——静态表天然排除（`regionAuthorized` 只含
  `companyRegionId(id) === regionId` 的公司，练习公司为 null），有单测锁住该行为。

配套守卫：`refreshCompanyOptions`（`companyApi.ts`）带请求序号，先发后到的旧公司列表不会覆盖
新结果——否则开通前在途的旧列表回来会触发协调，把刚切到的练习公司顶掉。

## 进入 / 退出（`src/services/company/practiceSpace.ts`）

```ts
import { enterPracticeSpace, exitPracticeSpace, currentPracticeCompany } from '@/services/company/practiceSpace'

// 进入：来源公司 = 当前公司；当前已在练习公司 → 用它的上级（重进不换练习公司）。
// 开通 403 且当前公司不是本人归属公司 → 改用本人归属公司再试一次
// （平台管理员在云南会被自动定位到不可写的中广核）。
// 成功后：刷新授权列表 → 钉住 → 切换到练习公司；切换失败会解除钉住并抛明确错误。
const { practiceCompanyId, originCompanyId, result } = await enterPracticeSpace()

// 退出：切回钉住记录里的来源公司并解除钉住；来源公司已被授权收回时不硬切，
// 交回四规则地区协调兜底。
exitPracticeSpace()

// 当前练习公司（非练习公司或授权列表未加载时为 null）
currentPracticeCompany.value // { companyId, name, parentCompanyId } | null
```

## 界面标识

- **顶栏徽标**（`src/components/company/PracticeSpaceBadge.vue`，挂在 `AppLayout` 顶栏
  `.topbar-actions` 公司切换器前面）：当前公司是练习公司时显示「练习空间 · {公司名} · 退出」，
  根元素带 `data-guide="practice-space-badge"`（供 #3404 导引引擎定位）。
- **公司切换器下拉**：练习公司的选项带「练习」小标签。
- **`CompanyScopeBar`**：练习公司时标签显示「练习空间」，说明写「练习空间（不计入集团汇总，
  数据不能删除）」。

## 判定纪律

练习公司判定一律走 `src/services/company/practiceCompany.ts` 的 `isPracticeCompanyOption`
（转出共享契约 `isPracticeCompany`，口径 `source === 'PRACTICE'`）。该文件是**叶子模块**，
不得 import `companyContext`——61 个 spec 对 companyContext 做局部 mock，经它引用会让这些
spec 因缺导出而挂。
