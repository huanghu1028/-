import { useCallback, useEffect, useMemo, useState } from "react";
import { Apple, ArrowLeft, Pencil, Plus, Search, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errText, MEAL_ZH, type NutritionPlan, type NutritionMeal, type NutritionItem } from "@/src/lib/api";
import { loadFoods, scaleFood, type Food } from "@/src/lib/data";
import { cn } from "@/lib/utils";

const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const;
const r1 = (n: number) => Math.round(n * 10) / 10;

type Macro = { kcal: number; protein: number; fat: number; carb: number };

// 存储契约：items 的 kcal/protein/fat/carb 为每 100g 值，展示时按克数换算。
function portionOf(it: NutritionItem): Macro {
  const k = Number(it.grams) / 100;
  return {
    kcal: r1(Number(it.kcal) * k), protein: r1(Number(it.protein) * k),
    fat: r1(Number(it.fat) * k), carb: r1(Number(it.carb) * k),
  };
}
function sumMacros(list: Macro[]): Macro {
  return {
    kcal: r1(list.reduce((s, m) => s + m.kcal, 0)), protein: r1(list.reduce((s, m) => s + m.protein, 0)),
    fat: r1(list.reduce((s, m) => s + m.fat, 0)), carb: r1(list.reduce((s, m) => s + m.carb, 0)),
  };
}
const mealTotals = (m: NutritionMeal) => sumMacros(m.items.map(portionOf));
const planTotals = (p: NutritionPlan) => sumMacros(p.meals.flatMap((m) => m.items.map(portionOf)));
const macroText = (m: Macro) => `${m.kcal} kcal · 蛋${m.protein} 脂${m.fat} 碳${m.carb}`;

// ---------- 表单与校验 ----------

type PlanForm = { name: string; description: string; kcal_target: string; protein_target: string; carb_target: string; fat_target: string };
type PlanPayload = { name: string; description: string; kcal_target: number | null; protein_target: number | null; carb_target: number | null; fat_target: number | null };
const TARGET_FIELDS = [
  { key: "kcal_target", label: "热量目标 kcal", min: 800, max: 6000 },
  { key: "protein_target", label: "蛋白质目标 g", min: 0, max: 400 },
  { key: "carb_target", label: "碳水目标 g", min: 0, max: 800 },
  { key: "fat_target", label: "脂肪目标 g", min: 0, max: 300 },
] as const;

const emptyPlanForm = (): PlanForm => ({ name: "", description: "", kcal_target: "", protein_target: "", carb_target: "", fat_target: "" });
const planToForm = (p: NutritionPlan): PlanForm => ({
  name: p.name, description: p.description,
  kcal_target: p.kcal_target === null ? "" : String(p.kcal_target),
  protein_target: p.protein_target === null ? "" : String(p.protein_target),
  carb_target: p.carb_target === null ? "" : String(p.carb_target),
  fat_target: p.fat_target === null ? "" : String(p.fat_target),
});

function parsePlanForm(f: PlanForm): { err?: string; payload?: PlanPayload } {
  const name = f.name.trim();
  if (!name || [...name].length > 60) return { err: "计划名称需 1-60 字" };
  const description = f.description.trim();
  if ([...description].length > 300) return { err: "描述最多 300 字" };
  const payload: PlanPayload = { name, description, kcal_target: null, protein_target: null, carb_target: null, fat_target: null };
  for (const t of TARGET_FIELDS) {
    const raw = f[t.key].trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < t.min || n > t.max) return { err: `${t.label}需为 ${t.min}-${t.max} 的整数，留空表示不设目标` };
    payload[t.key] = n;
  }
  return { payload };
}

type ItemForm = { food_name: string; grams: string; kcal: string; protein: string; fat: string; carb: string };
type ItemPayload = { food_name: string; grams: number; kcal: number; protein: number; fat: number; carb: number };
const emptyItemForm = (): ItemForm => ({ food_name: "", grams: "100", kcal: "", protein: "", fat: "", carb: "" });
const itemToForm = (it: NutritionItem): ItemForm => ({
  food_name: it.food_name, grams: it.grams, kcal: it.kcal, protein: it.protein, fat: it.fat, carb: it.carb,
});

function parseItemForm(f: ItemForm): { err?: string; payload?: ItemPayload } {
  const name = f.food_name.trim();
  if (!name) return { err: "请填写食物名称" };
  if ([...name].length > 80) return { err: "食物名称最多 80 字" };
  const g = Number(f.grams);
  if (!Number.isFinite(g) || g <= 0 || g > 5000) return { err: "克数需大于 0 且不超过 5000" };
  const kcal = Number(f.kcal), protein = Number(f.protein), fat = Number(f.fat), carb = Number(f.carb);
  if ([kcal, protein, fat, carb].some((n) => !Number.isFinite(n) || n < 0)) return { err: "每 100g 营养成分需为非负数字" };
  if (kcal > 9000) return { err: "每 100g 热量不能超过 9000 kcal" };
  if (protein > 1000 || fat > 1000 || carb > 1000) return { err: "每 100g 蛋白质/脂肪/碳水不能超过 1000 g" };
  return { payload: { food_name: name, grams: r1(g), kcal: r1(kcal), protein: r1(protein), fat: r1(fat), carb: r1(carb) } };
}

// 手动输入 / 编辑时的实时份量预览（每 100g × 克数 / 100）。
function formPreview(f: ItemForm): Macro | null {
  const g = Number(f.grams), kcal = Number(f.kcal), protein = Number(f.protein), fat = Number(f.fat), carb = Number(f.carb);
  if (![g, kcal, protein, fat, carb].every(Number.isFinite) || g <= 0) return null;
  const k = g / 100;
  return { kcal: r1(kcal * k), protein: r1(protein * k), fat: r1(fat * k), carb: r1(carb * k) };
}

const ITEM_NUM_FIELDS = [
  ["kcal", "热量 kcal/100g"], ["protein", "蛋白质 g/100g"], ["fat", "脂肪 g/100g"], ["carb", "碳水 g/100g"],
] as const;

export default function NutritionPlans() {
  const [plans, setPlans] = useState<NutritionPlan[] | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [foodNote, setFoodNote] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 计划创建 / 编辑
  const [planDialog, setPlanDialog] = useState<{ mode: "create" } | { mode: "edit"; plan: NutritionPlan } | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(emptyPlanForm());
  const [removePlan, setRemovePlan] = useState<NutritionPlan | null>(null);

  // 餐食
  const [mealDialog, setMealDialog] = useState<{ mode: "add" } | { mode: "edit"; meal: NutritionMeal } | null>(null);
  const [mealForm, setMealForm] = useState({ meal: "breakfast", name: "" });
  const [removeMeal, setRemoveMeal] = useState<NutritionMeal | null>(null);

  // 食物条目
  const [itemDialog, setItemDialog] = useState<{ mode: "add"; meal: NutritionMeal } | { mode: "edit"; item: NutritionItem } | null>(null);
  const [itemTab, setItemTab] = useState("library");
  const [query, setQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [libGrams, setLibGrams] = useState("100");
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm());

  const refresh = useCallback(async () => {
    try { setPlans(await api.getNutritionPlans()); } catch (e) { toast.error(errText(e)); setPlans([]); }
  }, []);

  useEffect(() => {
    void refresh();
    void loadFoods().then(({ foods: f, note }) => { setFoods(f); setFoodNote(note); }).catch(() => {});
  }, [refresh]);

  const mutate = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      await refresh();
      return true;
    } catch (e) {
      toast.error(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const selected = plans?.find((p) => p.id === selectedId) ?? null;

  const filteredFoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    return foods.filter((f) => !q || f.name.toLowerCase().includes(q));
  }, [foods, query]);

  const openCreate = () => { setPlanForm(emptyPlanForm()); setPlanDialog({ mode: "create" }); };
  const openEditPlan = (p: NutritionPlan) => { setPlanForm(planToForm(p)); setPlanDialog({ mode: "edit", plan: p }); };

  const onSavePlan = async () => {
    if (!planDialog) return;
    const res = parsePlanForm(planForm);
    if (res.err || !res.payload) { toast.error(res.err ?? "输入无效"); return; }
    const ok = planDialog.mode === "create"
      ? await mutate(() => api.createNutritionPlan(res.payload!), "营养计划已创建")
      : await mutate(() => api.patchNutritionPlan(planDialog.plan.id, res.payload!), "营养计划已更新");
    if (ok) setPlanDialog(null);
  };

  const openAddMeal = () => {
    if (!selected) return;
    if (selected.meals.length >= 8) { toast.error("每个计划最多 8 餐"); return; }
    setMealForm({ meal: "breakfast", name: "" });
    setMealDialog({ mode: "add" });
  };
  const openEditMeal = (m: NutritionMeal) => { setMealForm({ meal: m.meal, name: m.name }); setMealDialog({ mode: "edit", meal: m }); };

  const onSaveMeal = async () => {
    if (!mealDialog || !selected) return;
    const name = mealForm.name.trim();
    if ([...name].length > 60) { toast.error("餐食名称最多 60 字"); return; }
    const ok = mealDialog.mode === "add"
      ? await mutate(() => api.addNutritionMeal(selected.id, { meal: mealForm.meal, name }), "餐食已添加")
      : await mutate(() => api.patchNutritionMeal(mealDialog.meal.id, { meal: mealForm.meal, name }), "餐食已更新");
    if (ok) setMealDialog(null);
  };

  const openAddItem = (m: NutritionMeal) => {
    if (m.items.length >= 40) { toast.error("每餐最多 40 种食物"); return; }
    setItemTab("library"); setQuery(""); setSelectedFood(null); setLibGrams("100");
    setItemForm(emptyItemForm());
    setItemDialog({ mode: "add", meal: m });
  };
  const openEditItem = (it: NutritionItem) => {
    setItemForm(itemToForm(it));
    setItemDialog({ mode: "edit", item: it });
  };

  const libPreview = selectedFood ? scaleFood(selectedFood, Math.max(0, Number(libGrams) || 0)) : null;
  const manualPreview = formPreview(itemForm);

  const onSaveItem = async () => {
    if (!itemDialog) return;
    if (itemDialog.mode === "add" && itemTab === "library") {
      if (!selectedFood) { toast.error("请先选择食物"); return; }
      const g = Number(libGrams);
      if (!Number.isFinite(g) || g <= 0 || g > 5000) { toast.error("克数需大于 0 且不超过 5000"); return; }
      // 存储契约：kcal/protein/fat/carb 为每 100g 值，克数单独存；展示时再换算。
      const ok = await mutate(() => api.addNutritionItem(itemDialog.meal.id, {
        food_name: selectedFood.name, grams: r1(g),
        kcal: selectedFood.kcal, protein: selectedFood.protein, fat: selectedFood.fat, carb: selectedFood.carb,
      }), `已添加「${selectedFood.name}」`);
      if (ok) setItemDialog(null);
      return;
    }
    const res = parseItemForm(itemForm);
    if (res.err || !res.payload) { toast.error(res.err ?? "输入无效"); return; }
    const ok = itemDialog.mode === "add"
      ? await mutate(() => api.addNutritionItem(itemDialog.meal.id, res.payload!), `已添加「${res.payload!.food_name}」`)
      : await mutate(() => api.patchNutritionItem(itemDialog.item.id, res.payload!), "食物已更新");
    if (ok) setItemDialog(null);
  };

  // ---------- 渲染 ----------

  const totalsCard = (p: NutritionPlan) => {
    const t = planTotals(p);
    const cells: { label: string; value: number; unit: string; target: number | null }[] = [
      { label: "热量", value: t.kcal, unit: "kcal", target: p.kcal_target },
      { label: "蛋白质", value: t.protein, unit: "g", target: p.protein_target },
      { label: "碳水", value: t.carb, unit: "g", target: p.carb_target },
      { label: "脂肪", value: t.fat, unit: "g", target: p.fat_target },
    ];
    return (
      <Card className="py-4">
        <CardContent className="grid gap-4 px-4 sm:grid-cols-4">
          {cells.map((c) => (
            <div key={c.label}>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">{c.label}</span>
                <span className="text-lg font-bold">
                  {c.value}
                  <span className="text-xs font-normal text-muted-foreground"> {c.unit}{c.target !== null ? ` / ${c.target}` : ""}</span>
                </span>
              </div>
              {c.target !== null && c.target > 0 && (
                <Progress value={Math.min(100, (c.value / c.target) * 100)} className="mt-1.5 h-1.5" aria-label={`${c.label}达成度`} />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    );
  };

  const itemRow = (it: NutritionItem) => {
    const po = portionOf(it);
    return (
      <div key={it.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/60">
        <span className="min-w-0 flex-1 truncate font-medium">{it.food_name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{it.grams}g</span>
        <span className="shrink-0 text-xs font-medium text-primary">≈ {po.kcal} kcal</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">蛋{po.protein} 脂{po.fat} 碳{po.carb}</span>
        <span className="hidden shrink-0 text-[11px] text-muted-foreground/70 lg:inline" title="存储为每 100g 成分">
          每100g：{it.kcal} kcal
        </span>
        <Button variant="ghost" size="icon" className="size-6" aria-label={`编辑食物 ${it.food_name}`} onClick={() => openEditItem(it)}>
          <Pencil className="size-3" />
        </Button>
        <Button variant="ghost" size="icon" className="size-6 text-destructive" aria-label={`删除食物 ${it.food_name}`}
          onClick={() => mutate(() => api.deleteNutritionItem(it.id), "食物已删除")}>
          <Trash2 className="size-3" />
        </Button>
      </div>
    );
  };

  const mealCard = (m: NutritionMeal) => {
    const t = mealTotals(m);
    return (
      <Card key={m.id} className="py-3">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 px-4">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            <Badge variant="secondary" className="shrink-0">{MEAL_ZH[m.meal] ?? m.meal}</Badge>
            <span className="truncate">{m.name || "未命名餐食"}</span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground">{t.kcal} kcal · 蛋{t.protein} 脂{t.fat} 碳{t.carb}</span>
          </CardTitle>
          <div className="flex shrink-0 gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openAddItem(m)}>
              <Plus className="size-3.5" /> 添加食物
            </Button>
            <Button variant="ghost" size="icon" className="size-7" aria-label={`编辑餐食 ${m.name || MEAL_ZH[m.meal]}`} onClick={() => openEditMeal(m)}>
              <Pencil className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label={`删除餐食 ${m.name || MEAL_ZH[m.meal]}`} onClick={() => setRemoveMeal(m)}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4">
          {m.items.length === 0
            ? <p className="text-xs text-muted-foreground">还没有食物，点「添加食物」从食物库选择或手动输入。</p>
            : <div className="space-y-1">{m.items.map(itemRow)}</div>}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">营养计划</h1>
          <p className="mt-1 text-sm text-muted-foreground">按餐编排每日饮食，食物成分按每 100g 存储、按克数自动换算</p>
        </div>
        {!selected && <Button onClick={openCreate}><Plus className="size-4" /> 新建营养计划</Button>}
      </div>

      {!plans && <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>}

      {plans && plans.length === 0 && (
        <Card className="py-10 text-center">
          <CardContent className="space-y-3">
            <Apple className="mx-auto size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">还没有营养计划。创建一个「减脂期饮食」计划，设定热量与三大营养素目标吧。</p>
            <Button onClick={openCreate}><Plus className="size-4" /> 创建第一个营养计划</Button>
          </CardContent>
        </Card>
      )}

      {/* 计划列表 */}
      {plans && !selected && plans.map((p) => {
        const t = planTotals(p);
        const itemCount = p.meals.reduce((s, m) => s + m.items.length, 0);
        return (
          <Card key={p.id} className="tiger-lift">
            <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
              <div className="min-w-0">
                <CardTitle className="text-lg">{p.name}</CardTitle>
                {p.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.kcal_target !== null && <Badge variant="outline">目标 {p.kcal_target} kcal</Badge>}
                  {p.protein_target !== null && <Badge variant="outline">蛋白质 {p.protein_target}g</Badge>}
                  {p.carb_target !== null && <Badge variant="outline">碳水 {p.carb_target}g</Badge>}
                  {p.fat_target !== null && <Badge variant="outline">脂肪 {p.fat_target}g</Badge>}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  当前合计：{macroText(t)} · {p.meals.length} 餐 · {itemCount} 种食物
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="outline" size="sm" onClick={() => setSelectedId(p.id)}>查看详情</Button>
                <Button variant="ghost" size="icon" aria-label={`编辑计划 ${p.name}`} onClick={() => openEditPlan(p)}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`删除计划 ${p.name}`} className="text-destructive" onClick={() => setRemovePlan(p)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </CardHeader>
          </Card>
        );
      })}

      {/* 计划详情 */}
      {selected && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
              <ArrowLeft className="size-4" /> 返回计划列表
            </Button>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" aria-label="编辑计划" onClick={() => openEditPlan(selected)}>
                <Pencil className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="删除计划" className="text-destructive" onClick={() => setRemovePlan(selected)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold">{selected.name}</h2>
            {selected.description && <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>}
          </div>

          {totalsCard(selected)}

          {selected.meals.length === 0 && (
            <Card className="py-8 text-center">
              <CardContent className="space-y-3">
                <UtensilsCrossed className="mx-auto size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">这个计划还没有餐食。先添加早餐 / 午餐 / 晚餐 / 加餐，再往里加食物。</p>
              </CardContent>
            </Card>
          )}

          {MEAL_ORDER.map((type) => {
            const group = selected.meals.filter((m) => m.meal === type).sort((a, b) => a.sort - b.sort);
            if (group.length === 0) return null;
            const groupKcal = r1(group.reduce((s, m) => s + mealTotals(m).kcal, 0));
            return (
              <div key={type} className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <span>{MEAL_ZH[type]}</span>
                  <span className="text-xs font-normal">{groupKcal} kcal</span>
                </div>
                {group.map(mealCard)}
              </div>
            );
          })}

          <Button variant="outline" onClick={openAddMeal} disabled={selected.meals.length >= 8}>
            <Plus className="size-4" /> 添加餐食{selected.meals.length >= 8 ? "（已达 8 餐上限）" : ""}
          </Button>
        </div>
      )}

      {/* 创建 / 编辑计划 */}
      <Dialog open={planDialog !== null} onOpenChange={(o) => !o && setPlanDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{planDialog?.mode === "edit" ? "编辑营养计划" : "新建营养计划"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>名称</Label>
              <Input value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} maxLength={60} placeholder="例如：减脂期 · 高蛋白饮食" />
            </div>
            <div className="space-y-1.5">
              <Label>描述（可选）</Label>
              <Textarea value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} maxLength={300} rows={2} placeholder="例如：每日 1800 kcal，蛋白质 140g，训练日碳水略高" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {TARGET_FIELDS.map((t) => (
                <div key={t.key} className="space-y-1.5">
                  <Label className="text-xs">{t.label}</Label>
                  <Input type="number" min={t.min} max={t.max} step={1} value={planForm[t.key]}
                    onChange={(e) => setPlanForm({ ...planForm, [t.key]: e.target.value })} placeholder="留空不设" />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">目标为每日总量，可留空；热量目标范围 800-6000 kcal。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialog(null)}>取消</Button>
            <Button onClick={onSavePlan} disabled={busy}>{planDialog?.mode === "edit" ? "保存" : "创建"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除计划确认 */}
      <Dialog open={removePlan !== null} onOpenChange={(o) => !o && setRemovePlan(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>删除营养计划「{removePlan?.name}」？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">其下所有餐食与食物条目将一并删除，饮食记录页的打卡不受影响。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovePlan(null)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => {
              if (!removePlan) return;
              const id = removePlan.id;
              if (await mutate(() => api.deleteNutritionPlan(id), "营养计划已删除")) {
                setRemovePlan(null);
                if (selectedId === id) setSelectedId(null);
              }
            }}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加 / 编辑餐食 */}
      <Dialog open={mealDialog !== null} onOpenChange={(o) => !o && setMealDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{mealDialog?.mode === "edit" ? "编辑餐食" : "添加餐食"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>餐次</Label>
              <Select value={mealForm.meal} onValueChange={(v) => setMealForm({ ...mealForm, meal: v })}>
                <SelectTrigger className="w-full" aria-label="餐次"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEAL_ORDER.map((m) => <SelectItem key={m} value={m}>{MEAL_ZH[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>名称（可选）</Label>
              <Input value={mealForm.name} onChange={(e) => setMealForm({ ...mealForm, name: e.target.value })} maxLength={60} placeholder="例如：训练前早餐" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMealDialog(null)}>取消</Button>
            <Button onClick={onSaveMeal} disabled={busy}>{mealDialog?.mode === "edit" ? "保存" : "添加"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除餐食确认 */}
      <Dialog open={removeMeal !== null} onOpenChange={(o) => !o && setRemoveMeal(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>删除餐食「{removeMeal?.name || (removeMeal ? MEAL_ZH[removeMeal.meal] : "")}」？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">该餐下的 {removeMeal?.items.length ?? 0} 种食物将一并删除。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveMeal(null)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => {
              if (!removeMeal) return;
              if (await mutate(() => api.deleteNutritionMeal(removeMeal.id), "餐食已删除")) setRemoveMeal(null);
            }}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加 / 编辑食物 */}
      <Dialog open={itemDialog !== null} onOpenChange={(o) => !o && setItemDialog(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {itemDialog?.mode === "edit"
                ? `编辑食物 · ${itemDialog.item.food_name}`
                : `添加食物 · ${itemDialog?.mode === "add" ? (itemDialog.meal.name || MEAL_ZH[itemDialog.meal.meal]) : ""}`}
            </DialogTitle>
          </DialogHeader>
          {itemDialog?.mode === "add" ? (
            <Tabs value={itemTab} onValueChange={setItemTab}>
              <TabsList className="w-full">
                <TabsTrigger value="library" className="flex-1">食物库</TabsTrigger>
                <TabsTrigger value="manual" className="flex-1">手动输入</TabsTrigger>
              </TabsList>
              <TabsContent value="library" className="mt-3 space-y-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索食物，例如 米饭 / 鸡胸" className="pl-8" aria-label="搜索食物" />
                </div>
                {!selectedFood ? (
                  <ScrollArea className="h-52 pr-3">
                    <div className="space-y-0.5">
                      {filteredFoods.slice(0, 60).map((f) => (
                        <button key={f.name} type="button" onClick={() => { setSelectedFood(f); setLibGrams("100"); }}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent">
                          <span className="min-w-0 truncate">{f.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{f.kcal} kcal/100g</span>
                        </button>
                      ))}
                      {filteredFoods.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">没有匹配食物，可切到「手动输入」</p>}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="space-y-3 rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{selectedFood.name}</div>
                        <div className="text-xs text-muted-foreground">
                          每100g：{selectedFood.kcal} kcal · 蛋{selectedFood.protein} 脂{selectedFood.fat} 碳{selectedFood.carb}
                          {selectedFood.hint ? ` · ${selectedFood.hint}` : ""}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedFood(null)}>重选</Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Label className="text-xs">克数</Label>
                      <Input type="number" min={0.1} max={5000} step={0.1} value={libGrams} onChange={(e) => setLibGrams(e.target.value)} className="h-8 w-28" aria-label="克数" />
                      {libPreview && <Badge variant="secondary" className="text-xs">本份 ≈ {macroText(libPreview)}</Badge>}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">{foodNote || "食物库数值为每 100g 成分，选择后自动填入。"}</p>
              </TabsContent>
              <TabsContent value="manual" className="mt-3 space-y-3">
                <ItemFields form={itemForm} setForm={setItemForm} />
                {manualPreview && <Badge variant="secondary" className="text-xs">本份 ≈ {macroText(manualPreview)}</Badge>}
                <p className="text-[11px] text-muted-foreground">按每 100g 成分填写（包装食品请按营养成分表换算到每 100g），克数单独填写。</p>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="space-y-3">
              <ItemFields form={itemForm} setForm={setItemForm} />
              {manualPreview && <Badge variant="secondary" className="text-xs">本份 ≈ {macroText(manualPreview)}</Badge>}
              <p className="text-[11px] text-muted-foreground">营养成分按每 100g 存储，展示与合计按克数自动换算。</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialog(null)}>取消</Button>
            <Button onClick={onSaveItem} disabled={busy || (itemDialog?.mode === "add" && itemTab === "library" && !selectedFood)}>
              <UtensilsCrossed className={cn("size-4", busy && "animate-pulse")} /> {busy ? "保存中…" : itemDialog?.mode === "edit" ? "保存" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 每 100g 成分 + 克数的通用输入区（手动添加与编辑共用）。
function ItemFields({ form, setForm }: { form: ItemForm; setForm: (f: ItemForm) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>食物名称</Label>
        <Input value={form.food_name} onChange={(e) => setForm({ ...form, food_name: e.target.value })} maxLength={80} placeholder="例如 自制三明治" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">克数 g</Label>
          <Input type="number" min={0.1} max={5000} step={0.1} value={form.grams} onChange={(e) => setForm({ ...form, grams: e.target.value })} aria-label="克数" />
        </div>
        {ITEM_NUM_FIELDS.map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            <Input type="number" min={0} step={0.1} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} aria-label={label} />
          </div>
        ))}
      </div>
    </div>
  );
}