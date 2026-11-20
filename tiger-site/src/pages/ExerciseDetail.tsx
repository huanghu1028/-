import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Dumbbell } from "lucide-react";
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

  useEffect(() => {
    setImgIndex(0);
    void Promise.all([loadExercises(), loadTaxonomy()]).then(([ex, tax]) => {
      setExercise(ex.find((e) => e.id === exerciseId) ?? null);
      setTaxonomy(tax);
    }).catch(() => setExercise(null));
  }, [exerciseId]);

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
          <Button onClick={() => (user ? setAddOpen(true) : navigate("/login", { state: { from: `/exercises/${e.id}` } }))}>
            <Plus className="size-4" /> 加入训练计划
          </Button>
        </div>
      </div>

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