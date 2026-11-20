import { useEffect, useMemo, useState } from "react";
import { Apple, ArrowDown, ArrowUp, ArrowUpDown, Search, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadFoods, scaleFood, type Food } from "@/src/lib/data";
import { cn } from "@/lib/utils";

type SortKey = "name" | "kcal" | "protein" | "fat" | "carb";
type SortDir = "asc" | "desc";

const ALL = "全部";

export default function Foods() {
  const [foods, setFoods] = useState<Food[] | null>(null);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState(ALL);
  const [sortKey, setSortKey] = useState<SortKey>("kcal");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [grams, setGrams] = useState("100");
  const [selected, setSelected] = useState<Food | null>(null);

  useEffect(() => {
    let alive = true;
    void loadFoods()
      .then(({ foods: f, note: n }) => { if (alive) { setFoods(f); setNote(n); } })
      .catch((e: unknown) => {
        if (!alive) return;
        toast.error(e instanceof Error ? e.message : "食物数据加载失败，请刷新重试");
        setFoods([]);
      });
    return () => { alive = false; };
  }, []);

  const cats = useMemo(() => [ALL, ...new Set((foods ?? []).map((f) => f.cat))], [foods]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (foods ?? []).filter((f) => (cat === ALL || f.cat === cat) && (!q || f.name.toLowerCase().includes(q)));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) =>
      sortKey === "name" ? a.name.localeCompare(b.name, "zh") * dir : (a[sortKey] - b[sortKey]) * dir,
    );
  }, [foods, query, cat, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  };

  const sortIcon = (k: SortKey) =>
    sortKey !== k ? <ArrowUpDown className="size-3 opacity-40" />
      : sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />;

  const sortHead = (k: SortKey, label: string, className?: string) => (
    <TableHead className={className}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground"
        aria-label={`按${label}排序`}>
        {label} {sortIcon(k)}
      </button>
    </TableHead>
  );

  const g = Math.max(0, Math.min(5000, Number(grams) || 0));
  const scaled = selected ? scaleFood(selected, g) : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Apple className="size-6 text-primary" /> 食谱总览
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          常见食物成分表（每 100g 可食部），点击食物并按克数换算份量
        </p>
      </div>

      {/* 筛选与份量 */}
      <Card className="py-4">
        <CardContent className="grid gap-3 px-4 sm:grid-cols-[minmax(0,1fr)_180px_140px]">
          <div className="space-y-1.5">
            <Label htmlFor="food-search">搜索食物</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input id="food-search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="例如 米饭 / 鸡胸 / 牛奶" className="pl-8" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="food-cat">分类</Label>
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger id="food-cat" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="food-grams">份量 g</Label>
            <Input id="food-grams" type="number" min={1} max={5000} value={grams} onChange={(e) => setGrams(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {foods === null && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      )}

      {foods !== null && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Card className="py-2">
            <CardContent className="px-2">
              <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
                <span>共 {sorted.length} 种{sorted.length !== foods.length ? ` / ${foods.length} 种` : ""}</span>
                <span>数值为每 100g</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    {sortHead("name", "食物")}
                    {sortHead("kcal", "热量 kcal")}
                    {sortHead("protein", "蛋白质 g")}
                    {sortHead("fat", "脂肪 g", "hidden sm:table-cell")}
                    {sortHead("carb", "碳水 g", "hidden sm:table-cell")}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((f) => (
                    <TableRow key={f.name} onClick={() => setSelected(f)}
                      className={cn("cursor-pointer", selected?.name === f.name && "bg-primary/5")}>
                      <TableCell>
                        <button type="button" onClick={() => setSelected(f)} className="text-left font-medium hover:text-primary">
                          {f.name}
                        </button>
                        <Badge variant="secondary" className="ml-2 hidden text-[10px] sm:inline-flex">{f.cat}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{f.kcal}</TableCell>
                      <TableCell>{f.protein}</TableCell>
                      <TableCell className="hidden sm:table-cell">{f.fat}</TableCell>
                      <TableCell className="hidden sm:table-cell">{f.carb}</TableCell>
                    </TableRow>
                  ))}
                  {sorted.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        {foods.length === 0 ? "食物数据加载失败，请刷新重试" : "没有匹配的食物，换个关键词或分类试试"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* 份量换算 */}
          <Card className="lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UtensilsCrossed className="size-4 text-primary" /> 份量换算
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selected || !scaled ? (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <Apple className="size-8 opacity-50" />
                  <p className="text-sm">点击左侧食物</p>
                  <p className="text-xs">按上方克数实时换算热量与三大宏量</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-semibold">{selected.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">{selected.cat}</Badge>
                      <span className="text-xs text-muted-foreground">每 100g：{selected.kcal} kcal</span>
                    </div>
                    {selected.hint && <p className="mt-1 text-xs text-muted-foreground">{selected.hint}</p>}
                  </div>
                  <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-center">
                    <div className="text-xs text-muted-foreground">{g} g 份量热量</div>
                    <div className="tiger-gradient-text text-3xl font-bold">{scaled.kcal}</div>
                    <div className="text-xs text-muted-foreground">kcal</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {([["蛋白质", scaled.protein, "text-chart-2"], ["脂肪", scaled.fat, "text-chart-4"], ["碳水", scaled.carb, "text-chart-3"]] as const).map(([label, v, color]) => (
                      <div key={label} className="rounded-lg border border-border p-2">
                        <div className={cn("text-lg font-bold", color)}>{v}</div>
                        <div className="text-[10px] text-muted-foreground">{label} g</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    每 100g 含蛋白质 {selected.protein}g · 脂肪 {selected.fat}g · 碳水 {selected.carb}g，按 {g}g 等比换算。
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}