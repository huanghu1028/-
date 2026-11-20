import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Trash2, CalendarPlus, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import ExercisePicker from "@/src/components/ExercisePicker";
import { api, errText, type Plan, type PlanDay, type PlanItem } from "@/src/lib/api";
import { exerciseById, loadExercises, type Exercise } from "@/src/lib/data";

export default function Plans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [editPlanName, setEditPlanName] = useState("");
  const [editPlanGoal, setEditPlanGoal] = useState("");
  const [removePlan, setRemovePlan] = useState<Plan | null>(null);
  const [addDayPlan, setAddDayPlan] = useState<Plan | null>(null);
  const [dayName, setDayName] = useState("");
  const [editDay, setEditDay] = useState<PlanDay | null>(null);
  const [editDayName, setEditDayName] = useState("");
  const [removeDay, setRemoveDay] = useState<PlanDay | null>(null);
  const [pickerDay, setPickerDay] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<PlanItem | null>(null);
  const [itemSets, setItemSets] = useState("3");
  const [itemReps, setItemReps] = useState("12");
  const [itemWeight, setItemWeight] = useState("0");

  const refresh = useCallback(async () => {
    try { setPlans(await api.getPlans()); } catch (e) { toast.error(errText(e)); setPlans([]); }
  }, []);

  useEffect(() => {
    void refresh();
    void loadExercises().then(setExercises).catch(() => {});
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

  const exName = (id: number) => exerciseById(exercises, id)?.name ?? `动作 #${id}`;

  const onCreatePlan = async () => {
    if (!newName.trim()) { toast.error("请填写计划名称"); return; }
    if (await mutate(() => api.createPlan(newName.trim(), newGoal.trim()), "计划已创建")) {
      setCreateOpen(false); setNewName(""); setNewGoal("");
    }
  };

  const onAddDay = async () => {
    if (!addDayPlan || !dayName.trim()) { toast.error("请填写训练日名称"); return; }
    if (await mutate(() => api.addDay(addDayPlan.id, dayName.trim(), addDayPlan.days.length), "训练日已添加")) {
      setAddDayPlan(null); setDayName("");
    }
  };

  const onPickExercise = async (ex: Exercise) => {
    if (!pickerDay) return;
    await mutate(() => api.addItem(pickerDay, { exercise_id: ex.id, sets: 3, reps: 12, weight: 0 }), `已添加「${ex.name}」（默认 3 组 × 12 次，可编辑）`);
    setPickerDay(null);
  };

  const onSaveItem = async () => {
    if (!editItem) return;
    const ok = await mutate(() => api.patchItem(editItem.id, {
      sets: Math.max(1, Math.min(20, Number(itemSets) || 3)),
      reps: Math.max(0, Math.min(200, Number(itemReps) || 12)),
      weight: Math.max(0, Math.min(1000, Number(itemWeight) || 0)),
    }), "动作已更新");
    if (ok) setEditItem(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">训练计划</h1>
          <p className="mt-1 text-sm text-muted-foreground">按天编排动作，打卡时直接按计划执行</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> 新建计划</Button>
      </div>

      {!plans && <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>}

      {plans && plans.length === 0 && (
        <Card className="py-10 text-center">
          <CardContent className="space-y-3">
            <Dumbbell className="mx-auto size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">还没有训练计划。创建一个「减脂入门」计划，安排每周的训练日吧。</p>
            <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> 创建第一个计划</Button>
          </CardContent>
        </Card>
      )}

      {plans?.map((plan) => (
        <Card key={plan.id}>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div className="min-w-0">
              <CardTitle className="text-lg">{plan.name}</CardTitle>
              {plan.goal && <p className="mt-1 text-sm text-muted-foreground">{plan.goal}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{plan.days.length} 个训练日 · 创建于 {plan.created_at.slice(0, 10)}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon" aria-label="编辑计划" onClick={() => { setEditPlan(plan); setEditPlanName(plan.name); setEditPlanGoal(plan.goal); }}>
                <Pencil className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="删除计划" className="text-destructive" onClick={() => setRemovePlan(plan)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {plan.days.map((day) => (
              <div key={day.id} className="rounded-xl border border-border bg-background/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">第 {day.day_index + 1} 天</Badge>
                    <span className="text-sm font-semibold">{day.name}</span>
                    <span className="text-xs text-muted-foreground">{day.items.length} 个动作</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPickerDay(day.id)}>
                      <Plus className="size-3.5" /> 动作
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label="重命名训练日"
                      onClick={() => { setEditDay(day); setEditDayName(day.name); }}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label="删除训练日" onClick={() => setRemoveDay(day)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                {day.items.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {day.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/60">
                        <Link to={`/exercises/${item.exercise_id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">
                          {exName(item.exercise_id)}
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.sets} 组 × {item.reps} 次{Number(item.weight) > 0 ? ` @ ${item.weight}kg` : ""}
                        </span>
                        <Button variant="ghost" size="icon" className="size-6" aria-label="编辑动作"
                          onClick={() => { setEditItem(item); setItemSets(String(item.sets)); setItemReps(String(item.reps)); setItemWeight(item.weight); }}>
                          <Pencil className="size-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-6 text-destructive" aria-label="删除动作"
                          onClick={() => mutate(() => api.deleteItem(item.id), "动作已移除")}>
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => { setAddDayPlan(plan); setDayName(`第 ${plan.days.length + 1} 天`); }}>
              <CalendarPlus className="size-4" /> 添加训练日
            </Button>
          </CardContent>
        </Card>
      ))}

      {/* 新建计划 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>新建训练计划</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>名称</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：减脂入门 · 每周三练" maxLength={60} /></div>
            <div className="space-y-1.5"><Label>目标（可选）</Label><Textarea value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder="例如：8 周减重 4kg，保留肌肉" maxLength={200} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={onCreatePlan} disabled={busy}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑计划 */}
      <Dialog open={editPlan !== null} onOpenChange={(o) => !o && setEditPlan(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>编辑计划</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>名称</Label><Input value={editPlanName} onChange={(e) => setEditPlanName(e.target.value)} maxLength={60} /></div>
            <div className="space-y-1.5"><Label>目标</Label><Textarea value={editPlanGoal} onChange={(e) => setEditPlanGoal(e.target.value)} maxLength={200} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPlan(null)}>取消</Button>
            <Button disabled={busy} onClick={async () => {
              if (!editPlan || !editPlanName.trim()) return;
              if (await mutate(() => api.patchPlan(editPlan.id, { name: editPlanName.trim(), goal: editPlanGoal.trim() }), "计划已更新")) setEditPlan(null);
            }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除计划确认 */}
      <Dialog open={removePlan !== null} onOpenChange={(o) => !o && setRemovePlan(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>删除计划「{removePlan?.name}」？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">其下所有训练日与动作安排将一并删除，已完成的打卡记录不受影响。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovePlan(null)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => {
              if (!removePlan) return;
              if (await mutate(() => api.deletePlan(removePlan.id), "计划已删除")) setRemovePlan(null);
            }}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加训练日 */}
      <Dialog open={addDayPlan !== null} onOpenChange={(o) => !o && setAddDayPlan(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>添加训练日</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label>名称</Label><Input value={dayName} onChange={(e) => setDayName(e.target.value)} placeholder="例如：推日 · 胸肩三头" maxLength={60} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDayPlan(null)}>取消</Button>
            <Button onClick={onAddDay} disabled={busy}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名训练日 */}
      <Dialog open={editDay !== null} onOpenChange={(o) => !o && setEditDay(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>重命名训练日</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label>名称</Label><Input value={editDayName} onChange={(e) => setEditDayName(e.target.value)} maxLength={60} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDay(null)}>取消</Button>
            <Button disabled={busy} onClick={async () => {
              if (!editDay || !editDayName.trim()) return;
              if (await mutate(() => api.patchDay(editDay.id, editDayName.trim()), "训练日已更新")) setEditDay(null);
            }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除训练日确认 */}
      <Dialog open={removeDay !== null} onOpenChange={(o) => !o && setRemoveDay(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>删除训练日「{removeDay?.name}」？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">该日的动作安排将一并删除。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveDay(null)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => {
              if (!removeDay) return;
              if (await mutate(() => api.deleteDay(removeDay.id), "训练日已删除")) setRemoveDay(null);
            }}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑动作安排 */}
      <Dialog open={editItem !== null} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{editItem ? exName(editItem.exercise_id) : ""}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5"><Label>组数</Label><Input type="number" min={1} max={20} value={itemSets} onChange={(e) => setItemSets(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>次数</Label><Input type="number" min={0} max={200} value={itemReps} onChange={(e) => setItemReps(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>重量 kg</Label><Input type="number" min={0} max={1000} step={0.5} value={itemWeight} onChange={(e) => setItemWeight(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>取消</Button>
            <Button onClick={onSaveItem} disabled={busy}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExercisePicker open={pickerDay !== null} onOpenChange={(o) => !o && setPickerDay(null)} onPick={onPickExercise} title="添加动作到训练日" />
    </div>
  );
}