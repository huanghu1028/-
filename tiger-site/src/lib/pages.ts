// 路由级代码分割：把「登录后才用得到」的页面拆成按需加载的独立 chunk。
// 落地页 / 登录 / 注册是首屏入口，保持同步引入；其余页面（含 recharts、
// 围度/体重图表、动作分析等重依赖）不再挤进同一个 index-*.js。
// 实测原站首屏 JS 1.07MB（br 310KB），解析+执行占了约 0.9s 的首屏空白，
// 拆开之后首屏只解析框架 + 外壳，切页时再靠 prefetchRoute 预热，感觉不到延迟。
import { lazy, type ComponentType } from "react";

export const Dashboard = lazy(() => import("@/src/pages/Dashboard"));
export const Exercises = lazy(() => import("@/src/pages/Exercises"));
export const ExerciseDetail = lazy(() => import("@/src/pages/ExerciseDetail"));
export const ExerciseAnalytics = lazy(() => import("@/src/pages/ExerciseAnalytics"));
export const Plans = lazy(() => import("@/src/pages/Plans"));
export const Train = lazy(() => import("@/src/pages/Train"));
export const CalendarView = lazy(() => import("@/src/pages/CalendarView"));
export const Weight = lazy(() => import("@/src/pages/Weight"));
export const Measurements = lazy(() => import("@/src/pages/Measurements"));
export const Gallery = lazy(() => import("@/src/pages/Gallery"));
export const Diet = lazy(() => import("@/src/pages/Diet"));
export const NutritionPlans = lazy(() => import("@/src/pages/NutritionPlans"));
export const Templates = lazy(() => import("@/src/pages/Templates"));
export const Foods = lazy(() => import("@/src/pages/Foods"));
export const Calculators = lazy(() => import("@/src/pages/Calculators"));
export const Coach = lazy(() => import("@/src/pages/Coach"));
export const Settings = lazy(() => import("@/src/pages/Settings"));

// 导航路径 -> 该路径所需 chunk。带参数的路由取前两段（/exercises/7 -> ExerciseDetail）。
const loaders: Record<string, () => Promise<{ default: ComponentType }>> = {
  "/dashboard": () => import("@/src/pages/Dashboard"),
  "/exercises": () => import("@/src/pages/Exercises"),
  "/exercises/:id": () => import("@/src/pages/ExerciseDetail"),
  "/plans": () => import("@/src/pages/Plans"),
  "/train": () => import("@/src/pages/Train"),
  "/calendar": () => import("@/src/pages/CalendarView"),
  "/weight": () => import("@/src/pages/Weight"),
  "/measurements": () => import("@/src/pages/Measurements"),
  "/gallery": () => import("@/src/pages/Gallery"),
  "/diet": () => import("@/src/pages/Diet"),
  "/nutrition": () => import("@/src/pages/NutritionPlans"),
  "/templates": () => import("@/src/pages/Templates"),
  "/foods": () => import("@/src/pages/Foods"),
  "/calculators": () => import("@/src/pages/Calculators"),
  "/coach": () => import("@/src/pages/Coach"),
  "/settings": () => import("@/src/pages/Settings"),
};

function keyFor(path: string): string | undefined {
  if (loaders[path]) return path;
  const segs = path.split("/").filter(Boolean).slice(0, 1);
  const candidate = "/" + segs.join("/") + "/:id";
  return loaders[candidate] ? candidate : undefined;
}

const preloaded = new Set<string>();

/** 预热某个路由的 chunk：鼠标悬停/聚焦导航项时调用，点击时即可秒开。 */
export function prefetchRoute(path: string): void {
  const key = keyFor(path);
  if (!key || preloaded.has(key)) return;
  preloaded.add(key);
  void loaders[key]().catch(() => { preloaded.delete(key); });
}
