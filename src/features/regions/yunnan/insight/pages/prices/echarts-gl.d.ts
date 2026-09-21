// echarts-gl 包不携带类型声明；它是 echarts 的副作用扩展（import 即注册 grid3D/
// line3D 等三维系列），本目录只以 `await import('echarts-gl')` 方式按需加载、不消费
// 其导出，三维 option 的类型全部落在 echarts 本体上，故声明为空模块。
declare module 'echarts-gl'
