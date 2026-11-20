import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Dumbbell, Target, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/src/lib/auth";
import { api, errText, type Plan } from "@/src/lib/api";
import { loadExercises, loadTaxonomy, nameOf, type Exercise, type Taxonomy } from "@/src/lib/data";
import { cn } from "@/lib/utils";

// ===== 目标肌群图示 =====
// 素材来自原站 wger（Wikimedia Commons 肌肉图，见 public/img/muscles/SOURCES）：
// 正面/背面底图 + 每块肌肉一张叠加层（main 红 / secondary 橙）。与原站 react-components
// 相同的 CSS 多背景叠加方式：叠加层 fetch 后把填充色改为主题橙，编码为 data URL 叠在底图之上。
// 主要肌群 #ff9f43（--primary），次要肌群浅橙 #ffc46b；加载失败时降级为纯底图 + 文字图例。
type MuscleView = "front" | "back";
const MUSCLE_BASE: Record<MuscleView, string> = {
  front: "/img/muscles/muscular_system_front.svg",
  back: "/img/muscles/muscular_system_back.svg",
};
const overlayCache = new Map<string, Promise<string>>();

function loadMuscleOverlay(kind: "main" | "secondary", id: number): Promise<string> {
  const key = `${kind}/${id}`;
  const hit = overlayCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const resp = await fetch(`/img/muscles/${kind}/muscle-${id}.svg`);
    if (!resp.ok) throw new Error(`肌群图层加载失败：${key}`);
    let svg = await resp.text();
    if (kind === "main") {
      svg = svg.replaceAll("#fc0000", "#ff9f43").replace(/opacity:0\.5242423\d*/g, "opacity:0.85");
    } else {
      svg = svg.replaceAll("#f57900", "#ffc46b").replace(/opacity:0\.5242423\d*/g, "opacity:0.6");
    }
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  })();
  overlayCache.set(key, p);
  p.catch(() => overlayCache.delete(key)); // 失败后允许下次重试
  return p;
}

function MuscleFigure({ view, bg, label }: { view: MuscleView; bg: string | null; label: string }) {
  return (
    <figure className="m-0 w-full max-w-[190px] shrink-0">
      <div className="rounded-xl border border-border bg-white p-2">
        {bg ? (
          <div
            role="img"
            aria-label={label}
            className="mx-auto aspect-[1/2] w-full"
            style={{ backgroundImage: bg, backgroundSize: "100% auto", backgroundRepeat: "no-repeat" }}
          />
        ) : (
          <img src={MUSCLE_BASE[view]} alt={label} className="mx-auto aspect-[1/2] w-full object-contain object-top" />
        )}
      </div>
      <figcaption className="mt-1.5 text-center text-xs text-muted-foreground">
        {view === "front" ? "正面" : "背面"}
      </figcaption>
    </figure>
  );
}

export default function ExerciseDetail() {
  const { id } = useParams();
  const exerciseId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [exercise, setExercise] = useState<Exercise | null | undefined>(undefined);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [imgIndex, setImgIndex] = useState(0);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [dayId, setDayId] = useState("");
  const [sets, setSets] = useState("3");
  const [reps, setReps] = useState("12");
  const [weight, setWeight] = useState("0");
  const [busy, setBusy] = useState(false);
  const [muscleBg, setMuscleBg] = useState<{ front: string | null; back: string | null }>({ front: null, back: null });

  useEffect(() => {
    setImgIndex(0);
    void Promise.all([loadExercises(), loadTaxonomy()]).then(([ex, tax]) => {
      setExercise(ex.find((e) => e.id === exerciseId) ?? null);
      setTaxonomy(tax);
    }).catch(() => setExercise(null));
  }, [exerciseId]);

  // 按 is_front 把主要/次要肌群分配到正/背面视图，叠加层置顶层、底图置底层。
  useEffect(() => {
    if (!exercise || !taxonomy) return;
    let cancelled = false;
    setMuscleBg({ front: null, back: null });
    const build = async (view: MuscleView): Promise<string | null> => {
      const isFront = view === "front";
      const inView = (id: number) => taxonomy.muscles.find((m) => m.id === id)?.is_front === isFront;
      const primary = exercise.muscles.filter(inView);
      const secondary = exercise.muscles_secondary.filter((id) => !primary.includes(id) && inView(id));
      try {
        const urls = await Promise.all([
          ...primary.map((id) => loadMuscleOverlay("main", id)),
          ...secondary.map((id) => loadMuscleOverlay("secondary", id)),
        ]);
        return [...urls.map((u) => `url("${u}")`), `url("${MUSCLE_BASE[view]}")`].join(", ");
      } catch {
        return null; // 降级：仅显示底图，文字图例仍列出肌群
      }
    };
    void Promise.all([build("front"), build("back")]).then(([front, back]) => {
      if (!cancelled) setMuscleBg({ front, back });
    });
    return () => { cancelled = true; };
  }, [exercise, taxonomy]);

  useEffect(() => {
    if (!user || !addOpen) return;
    void api.getPlans().then((p) => {
      setPlans(p);
      if (p.length > 0) {
        setPlanId((cur) => cur || p[0].id);
        setDayId((cur) => cur || p[0].days[0]?.id || "");
      }
    }).catch(() => {});
  }, [user, addOpen]);

  const selectedPlan = useMemo(() => plans.find((p) => p.id === planId), [plans, planId]);

  const onAdd = async () => {
    if (!dayId) { toast.error("请先选择一个训练日"); return; }
    setBusy(true);
    try {
      await api.addItem(dayId, {
        exercise_id: exerciseId,
        sets: Math.max(1, Math.min(20, Number(sets) || 3)),
        reps: Math.max(0, Math.min(200, Number(reps) || 12)),
        weight: Math.max(0, Math.min(1000, Number(weight) || 0)),
      });
      toast.success(`已加入「${selectedPlan?.name ?? "计划"}」`);
      setAddOpen(false);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (exercise === undefined) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-80 w-full rounded-xl" /></div>;
  }
  if (exercise === null) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">未找到该动作</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/exercises")}>返回动作库</Button>
      </div>
    );
  }

  const e = exercise;
  const images = e.images;

  const muscleLabel = (view: MuscleView): string => {
    const title = view === "front" ? "正面肌群图示" : "背面肌群图示";
    if (!taxonomy) return title;
    const isFront = view === "front";
    const inView = (id: number) => taxonomy.muscles.find((m) => m.id === id)?.is_front === isFront;
    const pri = e.muscles.filter(inView).map((id) => nameOf(taxonomy.muscles, id));
    const sec = e.muscles_secondary.filter(inView).map((id) => nameOf(taxonomy.muscles, id));
    const parts: string[] = [];
    if (pri.length > 0) parts.push(`主要肌群：${pri.join("、")}`);
    if (sec.length > 0) parts.push(`次要肌群：${sec.join("、")}`);
    return parts.length > 0 ? `${title}，${parts.join("；")}` : `${title}（该视图无标注肌群）`;
  };

  return (
    <div className="space-y-5">
      <Link to="/exercises" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> 返回动作库
      </Link>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 图片 */}
        <Card className="overflow-hidden py-0">
          {images.length > 0 ? (
            <>
              <img src={images[imgIndex]} alt={`${e.name} 示范图 ${imgIndex + 1}`}
                className="aspect-[4/3] w-full bg-white object-contain p-2" />
              {images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto border-t border-border p-2">
                  {images.map((src, i) => (
                    <button key={src} type="button" onClick={() => setImgIndex(i)}
                      className={cn("shrink-0 overflow-hidden rounded-lg border-2 bg-white", i === imgIndex ? "border-primary" : "border-transparent opacity-70")}>
                      <img src={src} alt="" loading="lazy" className="size-16 object-contain" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted">
              <Dumbbell className="size-12 text-muted-foreground/40" />
            </div>
          )}
        </Card>

        {/* 信息 */}
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">{e.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{e.name_en}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {taxonomy && <Badge>{nameOf(taxonomy.categories, e.category)}</Badge>}
            {taxonomy && e.equipment.map((eq) => <Badge key={eq} variant="secondary">{nameOf(taxonomy.equipment, eq)}</Badge>)}
          </div>
          {taxonomy && e.muscles.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">主要肌群：</span>
              {e.muscles.map((m) => nameOf(taxonomy.muscles, m)).join("、")}
            </div>
          )}
          {taxonomy && e.muscles_secondary.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">次要肌群：</span>
              {e.muscles_secondary.map((m) => nameOf(taxonomy.muscles, m)).join("、")}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => (user ? setAddOpen(true) : navigate("/login", { state: { from: `/exercises/${e.id}` } }))}>
              <Plus className="size-4" /> 加入训练计划
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/exercises/${e.id}/analytics`}><TrendingUp className="size-4" /> 训练分析</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* 目标肌群图示 */}
      {taxonomy && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="size-4 text-primary" aria-hidden="true" /> 目标肌群
            </CardTitle>
          </CardHeader>
          <CardContent>
            {e.muscles.length === 0 && e.muscles_secondary.length === 0 ? (
              <p className="text-sm text-muted-foreground">该动作暂无肌群标注，可参考上方示范图。</p>
            ) : (
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                <div className="flex justify-center gap-4 sm:justify-start">
                  <MuscleFigure view="front" bg={muscleBg.front} label={muscleLabel("front")} />
                  <MuscleFigure view="back" bg={muscleBg.back} label={muscleLabel("back")} />
                </div>
                <div className="min-w-0 flex-1 space-y-4 text-sm">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: "#ff9f43" }} />
                      主要肌群
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {e.muscles.length > 0 ? e.muscles.map((m) => nameOf(taxonomy.muscles, m)).join("、") : "无标注"}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: "#ffc46b" }} />
                      次要肌群
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {e.muscles_secondary.length > 0 ? e.muscles_secondary.map((m) => nameOf(taxonomy.muscles, m)).join("、") : "无标注"}
                    </p>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    橙色高亮为主要目标肌群，浅橙色为次要参与肌群，按正面/背面视图分别显示。
                    图示改编自 wger 开源肌肉图（Wikimedia Commons）。
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 说明 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            动作说明
            {e.description_lang === "en" && <Badge variant="outline" className="text-[10px]">英文原文 · 暂无中文翻译</Badge>}
            {e.description_lang === "zh" && <Badge variant="outline" className="text-[10px]">官方中文</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {e.description ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{e.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">暂无文字说明，可参考上方示范图；训练时注意控制动作节奏，避免借力。</p>
          )}
        </CardContent>
      </Card>

      {/* 加入计划对话框 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>加入训练计划</DialogTitle></DialogHeader>
          {plans.length === 0 ? (
            <div className="space-y-3 py-2 text-sm text-muted-foreground">
              <p>你还没有训练计划。先创建一个计划，再回来添加动作。</p>
              <Button variant="outline" onClick={() => navigate("/plans")}>去创建计划</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>计划</Label>
                <Select value={planId} onValueChange={(v) => { setPlanId(v); setDayId(plans.find((p) => p.id === v)?.days[0]?.id ?? ""); }}>
                  <SelectTrigger><SelectValue placeholder="选择计划" /></SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>训练日</Label>
                <Select value={dayId} onValueChange={setDayId}>
                  <SelectTrigger><SelectValue placeholder="选择训练日" /></SelectTrigger>
                  <SelectContent>
                    {(selectedPlan?.days ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(selectedPlan?.days.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">该计划还没有训练日，请先到计划页添加。</p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5"><Label>组数</Label><Input type="number" min={1} max={20} value={sets} onChange={(ev) => setSets(ev.target.value)} /></div>
                <div className="space-y-1.5"><Label>次数</Label><Input type="number" min={0} max={200} value={reps} onChange={(ev) => setReps(ev.target.value)} /></div>
                <div className="space-y-1.5"><Label>重量 kg</Label><Input type="number" min={0} max={1000} step={0.5} value={weight} onChange={(ev) => setWeight(ev.target.value)} /></div>
              </div>
            </div>
          )}
          {plans.length > 0 && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
              <Button onClick={onAdd} disabled={busy || !dayId}>{busy ? "添加中…" : "添加"}</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}