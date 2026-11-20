import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Minus, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import ExercisePicker from "@/src/components/ExercisePicker";
import { api, errText, todayStr, type Plan, type WorkoutLog } from "@/src/lib/api";
import { exerciseById, loadExercises, type Exercise } from "@/src/lib/data";
import { cn } from "@/lib/utils";

type SessionRow = { key: string; exercise_id: number; name: string; sets: number; reps: number; weight: number; done_sets: number };

export default function Train() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [logs, setLogs] = useState<WorkoutLog[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [dayId, setDayId] = useState("");
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [date, setDate] = useState(todayStr());
  const [duration, setDuration] = useState("45");
  const [note, setNote] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshLogs = useCallback(async () => {
    try { setLogs(await api.getLogs()); } catch (e) { toast.error(errText(e)); setLogs([]); }
  }, []);

  useEffect(() => {
    void api.getPlans().then((p) => {
      setPlans(p);
      if (p.length > 0) { setPlanId(p[0].id); setDayId(p[0].days[0]?.id ?? ""); }
    }).catch((e) => toast.error(errText(e)));
    void loadExercises().then(setExercises).catch(() => {});
    void refreshLogs();
  }, [refreshLogs]);

  const selectedPlan = useMemo(() => plans.find((p) => p.id === planId), [plans, planId]);
  const selectedDay = useMemo(() => selectedPlan?.days.find((d) => d.id === dayId), [selectedPlan, dayId]);

  // 选择训练日后，按当天安排生成打卡行。
  useEffect(() => {
    if (!selectedDay) { setRows([]); return; }
    setRows(selectedDay.items.map((item) => ({
      key: item.id,
      exercise_id: item.exercise_id,
      name: exerciseById(exercises, item.exercise_id)?.name ?? `动作 #${item.exercise_id}`,
      sets: item.sets,
      reps: item.reps,
      weight: Number(item.weight),
      done_sets: 0,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayId, exercises.length]);

  const patchRow = (key: string, patch: Partial<SessionRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const onPick = (ex: Exercise) => {
    setRows((rs) => [...rs, {
      key: `free-${ex.id}-${Date.now()}`, exercise_id: ex.id, name: ex.name,
      sets: 3, reps: 12, weight: 0, done_sets: 0,
    }]);
  };

  const doneCount = rows.filter((r) => r.done_sets > 0).length;

  const onSubmit = async () => {
    if (rows.length === 0) { toast.error("请先选择训练日或添加动作"); return; }
    if (rows.length > 30) { toast.error("单次打卡最多 30 个动作"); return; }
    if (doneCount === 0) { toast.error("至少完成一个动作的一组再打卡"); return; }
    setBusy(true);
    try {
      await api.addLog({
        log_date: date,
        plan_name: selectedPlan?.name ?? "自由训练",
        day_name: selectedDay?.name ?? "",
        detail: rows.map((r) => ({
          exercise_id: r.exercise_id, name: r.name.slice(0, 120),
          sets: r.sets, reps: r.reps, weight: r.weight, done_sets: r.done_sets,
        })),
        duration_min: Math.max(0, Math.min(600, Number(duration) || 0)),
        note: note.trim().slice(0, 300),
      });
      toast.success("打卡成功，已同步到云端");
      setRows((rs) => rs.map((r) => ({ ...r, done_sets: 0 })));
      setNote("");
      await refreshLogs();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">训练打卡</h1>
        <p className="mt-1 text-sm text-muted-foreground">按计划完成每组动作，记录时长与感受</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">今日训练</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>计划</Label>
              <Select value={planId} onValueChange={(v) => {
                setPlanId(v);
                const p = plans.find((x) => x.id === v);
                setDayId(p?.days[0]?.id ?? "");
              }}>
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
            </div>
            <div className="space-y-1.5">
              <Label>日期</Label>
              <Input type="date" value={date} min="2000-01-01" max="2100-12-31" onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {plans.length === 0 && (
            <p className="text-sm text-muted-foreground">
              还没有计划？<Link to="/plans" className="text-primary hover:underline">去创建</Link>，或直接用下方「添加动作」自由训练。
            </p>
          )}

          {rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.key} className={cn("rounded-xl border p-3", r.done_sets >= r.sets ? "border-primary/50 bg-primary/5" : "border-border")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link to={`/exercises/${r.exercise_id}`} className="text-sm font-semibold hover:text-primary hover:underline">
                      {r.name}
                    </Link>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">完成组数</span>
                      <Button variant="outline" size="icon" className="size-7" aria-label="减少一组"
                        onClick={() => patchRow(r.key, { done_sets: Math.max(0, r.done_sets - 1) })}>
                        <Minus className="size-3.5" />
                      </Button>
                      <span className={cn("w-10 text-center text-sm font-bold", r.done_sets >= r.sets ? "text-primary" : "")}>
                        {r.done_sets}/{r.sets}
                      </span>
                      <Button variant="outline" size="icon" className="size-7" aria-label="完成一组"
                        onClick={() => patchRow(r.key, { done_sets: Math.min(r.sets, r.done_sets + 1) })}>
                        <Plus className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label="移除该动作"
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      组数 <Input type="number" min={1} max={20} value={r.sets} className="h-7 w-16"
                        onChange={(e) => patchRow(r.key, { sets: Math.max(1, Math.min(20, Number(e.target.value) || 1)), done_sets: Math.min(r.done_sets, Math.max(1, Number(e.target.value) || 1)) })} />
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      次数 <Input type="number" min={0} max={200} value={r.reps} className="h-7 w-16"
                        onChange={(e) => patchRow(r.key, { reps: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })} />
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      kg <Input type="number" min={0} max={1000} step={0.5} value={r.weight} className="h-7 w-20"
                        onChange={(e) => patchRow(r.key, { weight: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <Plus className="size-4" /> 添加动作
            </Button>
            {rows.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, done_sets: r.sets })))}>
                <CheckCircle2 className="size-4" /> 全部完成
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <div className="space-y-1.5">
              <Label>时长（分钟）</Label>
              <Input type="number" min={0} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>备注（可选）</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={1} maxLength={300} placeholder="状态、感受、下次要改进的点…" />
            </div>
          </div>

          <Button onClick={onSubmit} disabled={busy || rows.length === 0} className="w-full sm:w-auto">
            <CalendarCheck className="size-4" /> {busy ? "保存中…" : `完成打卡（${doneCount}/${rows.length} 个动作）`}
          </Button>
        </CardContent>
      </Card>

      {/* 历史 */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">打卡历史</h2>
        {!logs && <Skeleton className="h-24 rounded-xl" />}
        {logs && logs.length === 0 && <p className="text-sm text-muted-foreground">还没有打卡记录，完成第一次训练后会显示在这里。</p>}
        {logs?.map((log) => (
          <Card key={log.id} className="py-4">
            <CardContent className="space-y-2 px-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{log.log_date}</Badge>
                  <span className="text-sm font-semibold">{log.plan_name}{log.day_name ? ` · ${log.day_name}` : ""}</span>
                  <span className="text-xs text-muted-foreground">{log.duration_min} 分钟</span>
                </div>
                <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label="删除打卡"
                  onClick={async () => {
                    try { await api.deleteLog(log.id); toast.success("记录已删除"); await refreshLogs(); }
                    catch (e) { toast.error(errText(e)); }
                  }}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {log.detail.length} 个动作 · 完成 {log.detail.reduce((s, d) => s + d.done_sets, 0)} 组
                </summary>
                <ul className="mt-2 space-y-1">
                  {log.detail.map((d, i) => (
                    <li key={i} className="flex justify-between gap-2 text-xs">
                      <span>{d.name}</span>
                      <span className="text-muted-foreground">{d.done_sets}/{d.sets} 组 × {d.reps} 次{d.weight > 0 ? ` @ ${d.weight}kg` : ""}</span>
                    </li>
                  ))}
                </ul>
              </details>
              {log.note && <p className="text-xs text-muted-foreground">备注：{log.note}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <ExercisePicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={onPick} title="添加动作到本次训练" />
    </div>
  );
}