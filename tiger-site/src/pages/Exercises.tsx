import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Dumbbell } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadExercises, loadTaxonomy, nameOf, type Exercise, type Taxonomy } from "@/src/lib/data";

const PAGE = 60;

export default function Exercises() {
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<number | "all">("all");
  const [muscle, setMuscle] = useState<number | "all">("all");
  const [equipment, setEquipment] = useState<number | "all">("all");
  const [visible, setVisible] = useState(PAGE);

  useEffect(() => {
    void Promise.all([loadExercises(), loadTaxonomy()])
      .then(([ex, tax]) => { setExercises(ex); setTaxonomy(tax); })
      .catch(() => setError("动作库加载失败，请刷新重试"));
  }, []);

  const filtered = useMemo(() => {
    if (!exercises) return [];
    const q = query.trim().toLowerCase();
    return exercises.filter((e) => {
      if (category !== "all" && e.category !== category) return false;
      if (muscle !== "all" && !e.muscles.includes(muscle) && !e.muscles_secondary.includes(muscle)) return false;
      if (equipment !== "all" && !e.equipment.includes(equipment)) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || e.name_en.toLowerCase().includes(q);
    });
  }, [exercises, query, category, muscle, equipment]);

  const resetPage = () => setVisible(PAGE);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">动作库</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {exercises ? `${exercises.length} 个动作 · 中文名称全覆盖 · ${exercises.filter((e) => e.images.length > 0).length} 个配图` : "正在加载…"}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); resetPage(); }} placeholder="搜索动作…" className="pl-8" />
        </div>
      </div>

      {/* 过滤器 */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Button variant={category === "all" ? "default" : "outline"} size="sm" className="h-7 rounded-full px-3 text-xs"
            onClick={() => { setCategory("all"); resetPage(); }}>全部部位</Button>
          {taxonomy?.categories.map((c) => (
            <Button key={c.id} variant={category === c.id ? "default" : "outline"} size="sm" className="h-7 rounded-full px-3 text-xs"
              onClick={() => { setCategory(c.id); resetPage(); }}>{c.name}</Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">肌肉：</span>
          <Button variant={muscle === "all" ? "secondary" : "ghost"} size="sm" className="h-6 rounded-full px-2.5 text-xs"
            onClick={() => { setMuscle("all"); resetPage(); }}>不限</Button>
          {taxonomy?.muscles.map((m) => (
            <Button key={m.id} variant={muscle === m.id ? "secondary" : "ghost"} size="sm" className="h-6 rounded-full px-2.5 text-xs"
              onClick={() => { setMuscle(m.id); resetPage(); }}>{m.name}</Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">器械：</span>
          <Button variant={equipment === "all" ? "secondary" : "ghost"} size="sm" className="h-6 rounded-full px-2.5 text-xs"
            onClick={() => { setEquipment("all"); resetPage(); }}>不限</Button>
          {taxonomy?.equipment.map((eq) => (
            <Button key={eq.id} variant={equipment === eq.id ? "secondary" : "ghost"} size="sm" className="h-6 rounded-full px-2.5 text-xs"
              onClick={() => { setEquipment(eq.id); resetPage(); }}>{eq.name}</Button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!exercises && !error && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      )}

      {exercises && (
        <>
          <p className="text-xs text-muted-foreground">匹配 {filtered.length} 个动作</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.slice(0, visible).map((e) => (
              <Link key={e.id} to={`/exercises/${e.id}`} className="group">
                <Card className="h-full overflow-hidden py-0 transition-colors group-hover:border-primary/50">
                  {e.images[0] ? (
                    <img src={e.images[0]} alt={e.name} loading="lazy"
                      className="aspect-[4/3] w-full bg-white object-contain p-1" />
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted">
                      <Dumbbell className="size-8 text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="space-y-1.5 p-3">
                    <div className="line-clamp-1 text-sm font-semibold">{e.name}</div>
                    <div className="line-clamp-1 text-[11px] text-muted-foreground">{e.name_en}</div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        {taxonomy ? nameOf(taxonomy.categories, e.category) : ""}
                      </Badge>
                      {e.muscles.slice(0, 2).map((m) => (
                        <Badge key={m} variant="outline" className="px-1.5 py-0 text-[10px]">
                          {taxonomy ? nameOf(taxonomy.muscles, m) : ""}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的动作，换个关键词或清空过滤器试试</p>
          )}
          {filtered.length > visible && (
            <div className="text-center">
              <Button variant="outline" onClick={() => setVisible((v) => v + PAGE)}>
                加载更多（还有 {filtered.length - visible} 个）
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}