// 同源业务 API 客户端：所有请求带本应用会话 Cookie，绝不直接访问数据库。
const BASE = "/functions/v1/app";

export class ApiError extends Error {
  code: string;
  status: number;
  retryAfter?: number;
  constructor(code: string, status: number, retryAfter?: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export const ERROR_ZH: Record<string, string> = {
  invalid_input: "输入不符合要求，请检查后重试",
  invalid_username: "用户名需 3-32 位小写字母、数字、下划线或连字符，且以字母或数字开头",
  invalid_password: "口令至少 15 个字符（建议用一句好记的短语）",
  invalid_date: "日期格式应为 YYYY-MM-DD",
  invalid_weight: "体重数值无效",
  invalid_message: "消息内容无效（1-2000 字）",
  username_taken: "该用户名已被占用",
  invalid_credentials: "用户名或口令错误",
  login_required: "请先登录",
  rate_limited: "操作太频繁，请稍后再试",
  limiter_busy: "系统繁忙，请稍后再试",
  registration_unconfirmed: "注册结果未确认，请稍后重试或直接登录",
  logout_unconfirmed: "退出未确认，请重试",
  coach_key_required: "请先填入你自己的 DeepSeek API 密钥（点右上角「密钥」按钮）",
  invalid_coach_key: "密钥格式不对：DeepSeek 密钥以 sk- 开头，请检查后重填",
  coach_unavailable: "AI 教练暂时无法回应，请检查密钥是否有效或稍后再试",
  database_unavailable: "数据服务暂时不可用，请稍后再试",
  service_unavailable: "服务暂时不可用，请稍后再试",
  not_found: "记录不存在或已被删除",
  too_many_items: "单日动作数量已达上限（60 个）",
  plan_unconfirmed: "计划保存结果未确认，请刷新后重试",
  day_unconfirmed: "训练日保存结果未确认，请刷新后重试",
  item_unconfirmed: "动作保存结果未确认，请刷新后重试",
  log_unconfirmed: "打卡保存结果未确认，请刷新后重试",
  diet_unconfirmed: "饮食保存结果未确认，请刷新后重试",
  weight_unconfirmed: "体重保存结果未确认，请刷新后重试",
  profile_unconfirmed: "资料保存结果未确认，请刷新后重试",
  network_error: "网络异常，请检查连接后重试",
};

export function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const base = ERROR_ZH[e.code] ?? `请求失败（${e.code}）`;
    return e.code === "rate_limited" && e.retryAfter ? `${base}（约 ${e.retryAfter} 秒后可重试）` : base;
  }
  return ERROR_ZH.network_error;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(BASE + path, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network_error", 0);
  }
  let data: unknown = null;
  try { data = await resp.json(); } catch { /* 无 JSON 体 */ }
  if (!resp.ok) {
    const code = (data as { error?: string } | null)?.error ?? "service_unavailable";
    const retry = Number(resp.headers.get("retry-after"));
    throw new ApiError(code, resp.status, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  return data as T;
}

// ---------- 类型 ----------

export type User = { id: string; username: string };
export type Profile = {
  owner_id?: string; display_name: string; gender: string; birth_year: number | null;
  height_cm: number | null; activity: string; kcal_target: number | null;
  protein_target: number | null; updated_at?: string;
};
export type PlanItem = { id: string; day_id: string; exercise_id: number; sort: number; sets: number; reps: number; weight: string };
export type PlanDay = { id: string; plan_id: string; day_index: number; name: string; items: PlanItem[] };
export type Plan = { id: string; name: string; goal: string; created_at: string; days: PlanDay[] };
export type LogDetail = { exercise_id: number; name: string; sets: number; reps: number; weight: number; done_sets: number };
export type WorkoutLog = {
  id: string; log_date: string; plan_name: string; day_name: string;
  detail: LogDetail[]; duration_min: number; note: string; created_at: string;
};
export type WeightEntry = { entry_date: string; weight_kg: string; note: string; updated_at?: string };
export type DietEntry = {
  id: string; entry_date: string; meal: string; food_name: string; grams: string;
  kcal: string; protein: string; fat: string; carb: string; created_at: string;
};
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; created_at: string };

export type MeasurementCategory = { id: string; name: string; unit: string; created_at: string };
export type MeasurementEntry = { id: string; category_id: string; entry_date: string; value: string; note: string; created_at: string };
export type GalleryImage = { id: string; entry_date: string; caption: string; data_url: string; created_at: string };
export type NutritionItem = { id: string; meal_id: string; food_name: string; grams: string; kcal: string; protein: string; fat: string; carb: string; sort: number };
export type NutritionMeal = { id: string; plan_id: string; meal: string; name: string; sort: number; items: NutritionItem[] };
export type NutritionPlan = {
  id: string; name: string; description: string; kcal_target: number | null; protein_target: number | null;
  carb_target: number | null; fat_target: number | null; created_at: string; meals: NutritionMeal[];
};
export type DayExtra = { day_type: string; rounds: number | null; work_sec: number | null; rest_sec: number | null };
export type ItemExtra = { set_type: string; superset_group: number | null; rpe: number | null };
export type PlanMeta = { owner_id: string; plan_id: string; is_template: boolean; is_public: boolean; day_extras: Record<string, DayExtra>; item_extras: Record<string, ItemExtra>; updated_at: string };
export type Template = { id: string; name: string; goal: string; created_at: string; is_public: boolean; is_mine: boolean };
export type Preferences = { owner_id?: string; weight_unit: string; timezone: string; dashboard_layout: string[]; updated_at?: string };

export type ProfileInput = {
  display_name: string; gender: string; birth_year: number | null; height_cm: number | null;
  activity: string; kcal_target: number | null; protein_target: number | null;
};

// ---------- 接口 ----------

export const api = {
  register: (username: string, password: string) => request<{ user: User }>("POST", "/api/register", { username, password }),
  login: (username: string, password: string) => request<{ user: User }>("POST", "/api/login", { username, password }),
  logout: () => request<{ ok: boolean }>("POST", "/api/logout"),
  me: () => request<{ user: User }>("GET", "/api/me"),

  getProfile: () => request<{ profile: Profile }>("GET", "/api/profile"),
  putProfile: (p: ProfileInput) => request<{ profile: Profile }>("PUT", "/api/profile", p),

  getPlans: () => request<Plan[]>("GET", "/api/plans"),
  createPlan: (name: string, goal: string) => request<Plan>("POST", "/api/plans", { name, goal }),
  patchPlan: (id: string, patch: { name?: string; goal?: string }) => request<Plan>("PATCH", `/api/plans/${id}`, patch),
  deletePlan: (id: string) => request<{ ok: boolean }>("DELETE", `/api/plans/${id}`),
  addDay: (planId: string, name: string, dayIndex: number) => request<PlanDay>("POST", `/api/plans/${planId}/days`, { name, day_index: dayIndex }),
  patchDay: (id: string, name: string) => request<PlanDay>("PATCH", `/api/days/${id}`, { name }),
  deleteDay: (id: string) => request<{ ok: boolean }>("DELETE", `/api/days/${id}`),
  addItem: (dayId: string, item: { exercise_id: number; sets: number; reps: number; weight: number }) => request<PlanItem>("POST", `/api/days/${dayId}/items`, item),
  patchItem: (id: string, patch: { sets?: number; reps?: number; weight?: number }) => request<PlanItem>("PATCH", `/api/items/${id}`, patch),
  deleteItem: (id: string) => request<{ ok: boolean }>("DELETE", `/api/items/${id}`),

  getLogs: (date?: string) => request<WorkoutLog[]>("GET", date ? `/api/logs?date=${date}` : "/api/logs"),
  addLog: (log: { log_date: string; plan_name: string; day_name: string; detail: LogDetail[]; duration_min: number; note: string }) => request<WorkoutLog>("POST", "/api/logs", log),
  deleteLog: (id: string) => request<{ ok: boolean }>("DELETE", `/api/logs/${id}`),

  getWeight: () => request<WeightEntry[]>("GET", "/api/weight"),
  putWeight: (entry_date: string, weight_kg: number, note: string) => request<WeightEntry>("PUT", "/api/weight", { entry_date, weight_kg, note }),
  deleteWeight: (date: string) => request<{ ok: boolean }>("DELETE", `/api/weight/${date}`),

  getDiet: (date: string) => request<DietEntry[]>("GET", `/api/diet?date=${date}`),
  addDiet: (e: { entry_date: string; meal: string; food_name: string; grams: number; kcal: number; protein: number; fat: number; carb: number }) => request<DietEntry>("POST", "/api/diet", e),
  deleteDiet: (id: string) => request<{ ok: boolean }>("DELETE", `/api/diet/${id}`),

  getChat: () => request<ChatMessage[]>("GET", "/api/chat"),
  sendChat: (message: string, apiKey: string) => request<{ reply: string; saved: boolean }>("POST", "/api/chat", { message, apiKey }),
  clearChat: () => request<{ ok: boolean }>("DELETE", "/api/chat"),

  // 测量围度
  getMeasCategories: () => request<MeasurementCategory[]>("GET", "/api/measurements/categories"),
  addMeasCategory: (name: string, unit: string) => request<MeasurementCategory>("POST", "/api/measurements/categories", { name, unit }),
  deleteMeasCategory: (id: string) => request<{ ok: boolean }>("DELETE", `/api/measurements/categories/${id}`),
  getMeasEntries: (category?: string) => request<MeasurementEntry[]>("GET", category ? `/api/measurements/entries?category=${category}` : "/api/measurements/entries"),
  addMeasEntry: (e: { category_id: string; entry_date: string; value: number; note: string }) => request<MeasurementEntry>("POST", "/api/measurements/entries", e),
  deleteMeasEntry: (id: string) => request<{ ok: boolean }>("DELETE", `/api/measurements/entries/${id}`),

  // 画廊
  getGallery: () => request<GalleryImage[]>("GET", "/api/gallery"),
  addGallery: (e: { entry_date: string; caption: string; data_url: string }) => request<GalleryImage>("POST", "/api/gallery", e),
  deleteGallery: (id: string) => request<{ ok: boolean }>("DELETE", `/api/gallery/${id}`),

  // 营养计划
  getNutritionPlans: () => request<NutritionPlan[]>("GET", "/api/nutrition-plans"),
  createNutritionPlan: (p: { name: string; description: string; kcal_target: number | null; protein_target: number | null; carb_target: number | null; fat_target: number | null }) => request<NutritionPlan>("POST", "/api/nutrition-plans", p),
  patchNutritionPlan: (id: string, patch: Partial<{ name: string; description: string; kcal_target: number | null; protein_target: number | null; carb_target: number | null; fat_target: number | null }>) => request<NutritionPlan>("PATCH", `/api/nutrition-plans/${id}`, patch),
  deleteNutritionPlan: (id: string) => request<{ ok: boolean }>("DELETE", `/api/nutrition-plans/${id}`),
  addNutritionMeal: (planId: string, m: { meal: string; name: string }) => request<NutritionMeal>("POST", `/api/nutrition-plans/${planId}/meals`, m),
  patchNutritionMeal: (id: string, patch: { name?: string; meal?: string }) => request<NutritionMeal>("PATCH", `/api/nutrition-meals/${id}`, patch),
  deleteNutritionMeal: (id: string) => request<{ ok: boolean }>("DELETE", `/api/nutrition-meals/${id}`),
  addNutritionItem: (mealId: string, it: { food_name: string; grams: number; kcal: number; protein: number; fat: number; carb: number }) => request<NutritionItem>("POST", `/api/nutrition-meals/${mealId}/items`, it),
  patchNutritionItem: (id: string, patch: Partial<{ food_name: string; grams: number; kcal: number; protein: number; fat: number; carb: number }>) => request<NutritionItem>("PATCH", `/api/nutrition-items/${id}`, patch),
  deleteNutritionItem: (id: string) => request<{ ok: boolean }>("DELETE", `/api/nutrition-items/${id}`),

  // 模板 / 高级训练法 / 偏好
  getPlanMeta: (planId: string) => request<{ meta: PlanMeta | null }>("GET", `/api/plans/${planId}/meta`),
  patchPlanMeta: (planId: string, patch: Partial<{ is_template: boolean; is_public: boolean; day_extras: Record<string, DayExtra>; item_extras: Record<string, ItemExtra> }>) => request<PlanMeta>("PATCH", `/api/plans/${planId}/meta`, patch),
  getTemplates: () => request<Template[]>("GET", "/api/templates"),
  copyTemplate: (id: string) => request<Plan>("POST", `/api/templates/${id}/copy`),
  getPreferences: () => request<{ preferences: Preferences }>("GET", "/api/preferences"),
  putPreferences: (p: { weight_unit: string; timezone: string; dashboard_layout: string[] }) => request<{ preferences: Preferences }>("PUT", "/api/preferences", p),
};

// ---------- 小工具 ----------

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const MEAL_ZH: Record<string, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
export const ACTIVITY_ZH: Record<string, string> = {
  sedentary: "久坐少动", light: "轻度活动", moderate: "中等活动", active: "高度活动", very_active: "非常高",
};