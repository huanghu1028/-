// 动作选择器：搜索 + 分类过滤，供计划页 / 打卡页 / 动作详情页复用。
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { loadExercises, loadTaxonomy, nameOf, type Exercise, type Taxonomy } from "@/src/lib/data";

export default function ExercisePicker({ open, onOpenChange, onPick, title = "选择动作" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (exercise: Exercise) => void;
  title?: string;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<number | "all">("all");
  const [visible, setVisible] = useState(50);

  useEffect(() => {
    if (!open) return;
    setVisible(50);
    void Promise.all([loadExercises(), loadTaxonomy()]).then(([ex, tax]) => {
      setExercises(ex);
      setTaxonomy(tax);
    }).catch(() => {});
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((e) => {
      if (category !== "all" && e.category !== category) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || e.name_en.toLowerCase().includes(q);
    });
  }, [exercises, query, category]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setVisible(50); }}
            placeholder="搜索动作名称（中文 / 英文）" className="pl-8" autoFocus />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant={category === "all" ? "default" : "outline"} size="sm" className="h-7 rounded-full px-3 text-xs"
            onClick={() => { setCategory("all"); setVisible(50); }}>全部</Button>
          {taxonomy?.categories.map((c) => (
            <Button key={c.id} variant={category === c.id ? "default" : "outline"} size="sm" className="h-7 rounded-full px-3 text-xs"
              onClick={() => { setCategory(c.id); setVisible(50); }}>{c.name}</Button>
          ))}
        </div>
        <ScrollArea className="min-h-0 flex-1 pr-3">
          <div className="space-y-1">
            {filtered.slice(0, visible).map((e) => (
              <button key={e.id} type="button" onClick={() => { onPick(e); onOpenChange(false); }}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-accent">
                {e.images[0] ? (
                  <img src={e.images[0]} alt="" loading="lazy" className="size-10 shrink-0 rounded-md bg-white object-cover" />
                ) : (
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">无图</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {taxonomy ? nameOf(taxonomy.categories, e.category) : ""} · {e.name_en}
                  </div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">没有匹配的动作</p>}
            {filtered.length > visible && (
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setVisible((v) => v + 50)}>
                加载更多（还有 {filtered.length - visible} 个）
              </Button>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}