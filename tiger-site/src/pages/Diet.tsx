import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, errText, todayStr, MEAL_ZH, type DietEntry, type Profile } from "@/src/lib/api";
import { loadFoods, scaleFood, type Food } from "@/src/lib/data";
import { cn } from "@/lib/utils";

const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
const sum = (list: DietEntry[], key: "kcal" | "protein" | "fat" | "carb") =>
  Math.round(list.reduce((s, e) => s + Number(e[key]), 0) * 10) / 10;

export default function Diet() {
  const [date, setDate] = useState(todayStr());
  const [entries, setEntries] = useState<DietEntry[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [foodNote, setFoodNote] = useState("");

  const [addMeal, setAddMeal] = useState<string | null>(null);
  const [tab, setTab] = useState("library");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("全部");
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [grams, setGrams] = useState("100");
  const [manual, setManual] = useState({ food_name: "", grams: "100", kcal: "", protein: "", fat: "", carb: "" });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (d: string) => {
    try { setEntries(await api.getDiet(d)); } catch (e) { toast.error(errText(e)); setEntries([]); }
  }, []);

  useEffect(() => { void refresh(date); }, [date, refresh]);
  useEffect(() => {
    void api.getProfile().then(({ profile: p }) => setProfile(p)).catch(() => {});
    void loadFoods().then(({ foods: f, note }) => { setFoods(f); setFoodNote(note); }).catch(() => {});
  }, []);

  const cats = useMemo(() => ["全部", ...new Set(foods.map((f) => f.cat))], [foods]);
  const filteredFoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    return foods.filter((f) => (cat === "全部" || f.cat === cat) && (!q || f.name.toLowerCase().includes(q)));
  }, [foods, query, cat]);

  const totals = useMemo(() => ({
    kcal: sum(entries ?? [], "kcal"), protein: sum(entries ?? [], "protein"),
    fat: sum(entries ?? [], "fat"), carb: sum(entries ?? [], "carb"),
  }), [entries]);

  const openAdd = (meal: string) => {
    setAddMeal(meal); setTab("library"); setQuery(""); setCat("全部");
    setSelectedFood(null); setGrams("100");
    setManual({ food_name: "", grams: "100", kcal: "", protein: "", fat: "", carb: "" });
  };

  const preview = selectedFood ? scaleFood(selectedFood, Math.max(0, Number(grams) || 0)) : null;

  const onAdd = async () => {
    if (!addMeal) return;
    const g = Number(tab === "library" ? grams : manual.grams);
    if (!Number.isFinite(g) || g <= 0 || g > 5000) { toast.error("请输入有效克数（0-5000）"); return; }
    let payload: { food_name: string; grams: number; kcal: number; protein: number; fat: number; carb: number };
    if (tab === "library") {
      if (!selectedFood || !preview) { toast.error("请先选择食物"); return; }
      payload = { food_name: selectedFood.name, grams: g, ...preview };
    } else {
      const name = manual.food_name.trim();
      if (!name) { toast.error("请填写食物名称"); return; }
      const nums = [manual.kcal, manual.protein, manual.fat, manual.carb].map(Number);
      if (nums.some((n) => !Number.isFinite(n) || n < 0)) { toast.error("营养成分需为非负数字"); return; }
      payload = { food_name: name.slice(0, 80), grams: g, kcal: nums[0], protein: nums[1], fat: nums[2], carb: nums[3] };
    }
    setBusy(true);
    try {
      await api.addDiet({ entry_date: date, meal: addMeal, ...payload });
      toast.success(`已记入${MEAL_ZH[addMeal]}`);
      setAddMeal(null);
      await refresh(date);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const kcalTarget = profile?.kcal_target ?? null;
  const proteinTarget = profile?.protein_target ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">饮食记录</h1>
          <p className="mt-1 text-sm text-muted-foreground">内置 93 种常见食物成分，按克数自动换算</p>
        </div>
        <Input type="date" value={date} min="2000-01-01" max="2100-12-31" onChange={(e) => setDate(e.target.value)} className="w-44" />
      </div>

      {/* 当日总览 */}
      <Card className="py-4">
        <CardContent className="grid gap-4 px-4 sm:grid-cols-4">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">热量</span>
              <span className="text-lg font-bold">{totals.kcal}<span className="text-xs font-normal text-muted-foreground"> kcal{kcalTarget ? ` / ${kcalTarget}` : ""}</span></span>
            </div>
            {kcalTarget && <Progress value={Math.min(100, (totals.kcal / kcalTarget) * 100)} className="mt-1.5 h-1.5" />}
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">蛋白质</span>
              <span className="text-lg font-bold">{totals.protein}<span className="text-xs font-normal text-muted-foreground"> g{proteinTarget ? ` / ${proteinTarget}` : ""}</span></span>
            </div>
            {proteinTarget && <Progress value={Math.min(100, (totals.protein / proteinTarget) * 100)} className="mt-1.5 h-1.5" />}
          </div>
          <div className="flex items-baseline justify-between sm:block">
            <span className="text-xs text-muted-foreground">脂肪</span>
            <span className="text-lg font-bold">{totals.fat}<span className="text-xs font-normal text-muted-foreground"> g</span></span>
          </div>
          <div className="flex items-baseline justify-between sm:block">
            <span className="text-xs text-muted-foreground">碳水</span>
            <span className="text-lg font-bold">{totals.carb}<span className="text-xs font-normal text-muted-foreground"> g</span></span>
          </div>
        </CardContent>
      </Card>

      {!entries && <Skeleton className="h-40 rounded-xl" />}

      {/* 四餐 */}
      {entries && MEALS.map((meal) => {
        const list = entries.filter((e) => e.meal === meal);
        return (
          <Card key={meal} className="py-4">
            <CardHeader className="flex-row items-center justify-between space-y-0 px-4">
              <CardTitle className="flex items-center gap-2 text-base">
                {MEAL_ZH[meal]}
                <span className="text-xs font-normal text-muted-foreground">{sum(list, "kcal")} kcal</span>
              </CardTitle>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openAdd(meal)}>
                <Plus className="size-3.5" /> 添加
              </Button>
            </CardHeader>
            <CardContent className="px-4">
              {list.length === 0 ? (
                <p className="text-xs text-muted-foreground">还没有记录</p>
              ) : (
                <div className="space-y-1">
                  {list.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/60">
                      <span className="min-w-0 flex-1 truncate font-medium">{e.food_name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{e.grams}g</span>
                      <span className="w-20 shrink-0 text-right text-xs">{e.kcal} kcal</span>
                      <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground sm:inline">
                        蛋{e.protein} 脂{e.fat} 碳{e.carb}
                      </span>
                      <Button variant="ghost" size="icon" className="size-6 text-destructive" aria-label="删除记录"
                        onClick={async () => {
                          try { await api.deleteDiet(e.id); toast.success("已删除"); await refresh(date); }
                          catch (err) { toast.error(errText(err)); }
                        }}>
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* 添加对话框 */}
      <Dialog open={addMeal !== null} onOpenChange={(o) => !o && setAddMeal(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
          <DialogHeader><DialogTitle>记入{addMeal ? MEAL_ZH[addMeal] : ""} · {date}</DialogTitle></DialogHeader>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="library" className="flex-1">食物库</TabsTrigger>
              <TabsTrigger value="manual" className="flex-1">手动输入</TabsTrigger>
            </TabsList>
            <TabsContent value="library" className="mt-3 space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索食物，例如 米饭 / 鸡胸" className="pl-8" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => (
                  <Button key={c} variant={cat === c ? "default" : "outline"} size="sm" className="h-6 rounded-full px-2.5 text-xs" onClick={() => setCat(c)}>{c}</Button>
                ))}
              </div>
              {!selectedFood ? (
                <ScrollArea className="h-52 pr-3">
                  <div className="space-y-0.5">
                    {filteredFoods.slice(0, 60).map((f) => (
                      <button key={f.name} type="button" onClick={() => { setSelectedFood(f); setGrams("100"); }}
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
                      {selectedFood.hint && <div className="text-xs text-muted-foreground">{selectedFood.hint}</div>}
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedFood(null)}>重选</Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">克数</Label>
                    <Input type="number" min={1} max={5000} value={grams} onChange={(e) => setGrams(e.target.value)} className="h-8 w-28" />
                    {preview && (
                      <Badge variant="secondary" className="text-xs">
                        {preview.kcal} kcal · 蛋{preview.protein} 脂{preview.fat} 碳{preview.carb}
                      </Badge>
                    )}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">{foodNote}</p>
            </TabsContent>
            <TabsContent value="manual" className="mt-3 space-y-3">
              <div className="space-y-1.5"><Label>食物名称</Label><Input value={manual.food_name} onChange={(e) => setManual({ ...manual, food_name: e.target.value })} maxLength={80} placeholder="例如 自制三明治" /></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {([["grams", "克数 g"], ["kcal", "热量 kcal"], ["protein", "蛋白质 g"], ["fat", "脂肪 g"], ["carb", "碳水 g"]] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs">{label}</Label>
                    <Input type="number" min={0} step={0.1} value={manual[key]} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">按所吃份量填写总量；包装食品可参考营养成分表换算。</p>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddMeal(null)}>取消</Button>
            <Button onClick={onAdd} disabled={busy || (tab === "library" && !selectedFood)}>
              <UtensilsCrossed className={cn("size-4", busy && "animate-pulse")} /> {busy ? "保存中…" : "记入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}