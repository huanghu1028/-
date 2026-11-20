// 仪表盘组件注册表：偏好 dashboard_layout 存组件 id 顺序（未列入=隐藏）。
export const WIDGETS = [
  { id: "stats", label: "核心指标", desc: "最新体重 / 本周训练 / 今日摄入 / 计划数" },
  { id: "weight", label: "体重趋势", desc: "最近 60 次体重曲线" },
  { id: "quick", label: "快速开始", desc: "打卡 / 饮食 / 计划 / 日历 / 食物库 / 虎教练入口" },
  { id: "logs", label: "最近打卡", desc: "最近 3 次训练记录" },
  { id: "diet_today", label: "今日饮食", desc: "今天各餐记录与热量合计" },
  { id: "meas_latest", label: "最新围度", desc: "各测量类别的最新数值" },
] as const;

export type WidgetId = (typeof WIDGETS)[number]["id"];
export const DEFAULT_LAYOUT: WidgetId[] = ["stats", "weight", "quick", "logs"];
export const isWidgetId = (v: string): v is WidgetId => WIDGETS.some((w) => w.id === v);