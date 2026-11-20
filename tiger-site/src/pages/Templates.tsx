import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Copy, Dumbbell, Save, SlidersHorizontal, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errText, type Plan, type PlanMeta, type Template } from "@/src/lib/api";
import { loadExercises, nameOf, type Exercise } from "@/src/lib/data";
import { cn } from "@/lib/utils";

const DAY_TYPES = [
  ["standard", "标准"],
  ["emom", "EMOM 每分钟循环"],
  ["amrap", "AMRAP 尽可能多轮"],
  ["hiit", "HIIT 高强度间歇"],
  ["tabata", "Tabata 20秒练10秒歇"],
  ["custom", "自定义"],
] as const;
const SET_TYPES = [
  ["normal", "普通组"],
  ["drop", "递减组"],
  ["rest_pause", "休息暂停"],
  ["cluster", "集群组"],
  ["myo_rep", "Myo-rep"],
] as const;
const dayTypeLabel = (v: string) => DAY_TYPES.find(([k]) => k === v)?.[1] ?? v;
const setTypeLabel = (v: string) => SET_TYPES.find(([k]) => k === v)?.[1] ?? v;

// 草稿用字符串保存数字输入，保存时统一解析 + 有界校验（与后端 validateExtras 一致）。
type DayDraft = { day_type: string; rounds: string; work_sec: string; rest_sec: string };
type ItemDraft = { set_type: string; superset_group: string; rpe: string };
type Draft = { isTemplate: boolean; isPublic: boolean; days: Record<string, DayDraft>; items: Record<string, ItemDraft> };

const numStr = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const emptyDayDraft = (): DayDraft => ({ day_type: "standard", rounds: "", work_sec: "", rest_sec: "" });
const emptyItemDraft = (): ItemDraft => ({ set_type: "normal", superset_group: "", rpe: "" });

function draftFromMeta(plan: Plan, meta: PlanMeta | null): Draft {
  const days: Record<string, DayDraft> = {};
  const items: Record<string, ItemDraft> = {};
  for (const d of plan.days) {
    const e = meta?.day_extras?.[d.id];
    days[d.id] = { day_type: e?.day_type ?? "standard", rounds: numStr(e?.rounds), work_sec: numStr(e?.work_sec), rest_sec: numStr(e?.rest_sec) };
    for (const it of d.items) {
      const x = meta?.item_extras?.[it.id];
      items[it.id] = { set_type: x?.set_type ?? "normal", superset_group: numStr(x?.superset_group), rpe: numStr(x?.rpe) };
    }
  }
  return { isTemplate: meta?.is_template ?? false, isPublic: meta?.is_public ?? false, days, items };
}

// 空串 → null；非法 / 越界 → undefined（调用方据此报错）。
function nullableInt(raw: string, min: number, max: number): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < min || n > max) return undefined;
  return n;
}

// 各日类型需要展示的数字字段与文案。
function dayFields(type: string): { key: "rounds" | "work_sec" | "rest_sec"; label: string; min: number; max: number }[] {
  const rounds = { key: "rounds" as const, label: "轮数（1-100）", min: 1, max: 100 };
  const work = { key: "work_sec" as const, label: "每轮秒数（1-3600）", min: 1, max: 3600 };
  const rest = { key: "rest_sec" as const, label: "间歇秒数（0-3600）", min: 0, max: 3600 };
  switch (type) {
    case "emom": return [rounds, work];
    case "amrap": return [rounds, { ...work, label: "时间上限秒（1-3600）" }];
    case "hiit": return [rounds, { ...work, label: "练秒数（1-3600）" }, rest];
    case "tabata": return [rounds, { ...work, label: "练秒数（1-3600）" }, { ...rest, label: "歇秒数（0-3600）" }];
    case "custom": return [rounds, work, rest];
    default: return [];
  }
}

export default function Templates() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [metas, setMetas] = useState<Record<string, PlanMeta | null>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [metaLoading, setMetaLoading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const [lastCopied, setLastCopied] = useState<string | null>(null);

  const refreshTemplates = useCallback(async () => {
    try { setTemplates(await api.getTemplates()); } catch (e) { toast.error(errText(e)); setTemplates([]); }
  }, []);
  const refreshPlans = useCallback(async () => {
    try { setPlans(await api.getPlans()); } catch (e) { toast.error(errText(e)); setPlans([]); }
  }, []);

  useEffect(() => {
    void refreshTemplates();
    void refreshPlans();
    void loadExercises().then(setExercises).catch(() => {});
  }, [refreshTemplates, refreshPlans]);

  const toggleExpand = async (plan: Plan) => {
    if (expanded === plan.id) { setExpanded(null); return; }
    setExpanded(plan.id);
    if (plan.id in metas) return;
    setMetaLoading(plan.id);
    try {
      const { meta } = await api.getPlanMeta(plan.id);
      setMetas((m) => ({ ...m, [plan.id]: meta }));
      setDrafts((d) => ({ ...d, [plan.id]: draftFromMeta(plan, meta) }));
    } catch (e) {
      toast.error(errText(e));
      setMetas((m) => ({ ...m, [plan.id]: null }));
      setDrafts((d) => ({ ...d, [plan.id]: draftFromMeta(plan, null) }));
    } finally {
      setMetaLoading(null);
    }
  };

  const patchDraft = (planId: string, fn: (d: Draft) => Draft) => {
    setDrafts((all) => (all[planId] ? { ...all, [planId]: fn(all[planId]) } : all));
  };

  const onCopy = async (t: Template) => {
    setCopying(t.id);
    try {
      const copy = await api.copyTemplate(t.id);
      toast.success(`已复制「${t.name}」为我的计划，高级训练法设置一并带走`);
      setLastCopied(copy.name);
      await Promise.all([refreshPlans(), refreshTemplates()]);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setCopying(null);
    }
  };

  // 保存：始终发送完整的 day_extras / item_extras 映射（后端整体替换）。
  const onSave = async (plan: Plan) => {
    const draft = drafts[plan.id];
    if (!draft) return;
    const day_extras: PlanMeta["day_extras"] = {};
    const item_extras: PlanMeta["item_extras"] = {};
    for (const day of plan.days) {
      const dd = draft.days[day.id] ?? emptyDayDraft();
      const dayTag = `第 ${day.day_index + 1} 天「${day.name}」`;
      if (dd.day_type === "standard") {
        day_extras[day.id] = { day_type: "standard", rounds: null, work_sec: null, rest_sec: null };
      } else {
        const rounds = nullableInt(dd.rounds, 1, 100);
        const work = nullableInt(dd.work_sec, 1, 3600);
        const rest = nullableInt(dd.rest_sec, 0, 3600);
        if (rounds === undefined) { toast.error(`${dayTag}：轮数需为 1-100 的整数`); return; }
        if (work === undefined) { toast.error(`${dayTag}：秒数需为 1-3600 的整数`); return; }
        if (rest === undefined) { toast.error(`${dayTag}：间歇秒数需为 0-3600 的整数`); return; }
        day_extras[day.id] = { day_type: dd.day_type, rounds, work_sec: work, rest_sec: rest };
      }
      for (const it of day.items) {
        const xd = draft.items[it.id] ?? emptyItemDraft();
        const itemTag = `${dayTag}动作「${nameOf(exercises, it.exercise_id)}」`;
        const group = nullableInt(xd.superset_group, 0, 60);
        const rpe = nullableInt(xd.rpe, 1, 10);
        if (group === undefined) { toast.error(`${itemTag}：超级组编号需为 0-60 的整数`); return; }
        if (rpe === undefined) { toast.error(`${itemTag}：RPE 需为 1-10 的整数`); return; }
        item_extras[it.id] = { set_type: xd.set_type, superset_group: group, rpe };
      }
    }
    setBusy(true);
    try {
      const meta = await api.patchPlanMeta(plan.id, {
        is_template: draft.isTemplate, is_public: draft.isPublic, day_extras, item_extras,
      });
      toast.success("高级设置已保存");
      setMetas((m) => ({ ...m, [plan.id]: meta }));
      setDrafts((d) => ({ ...d, [plan.id]: draftFromMeta(plan, meta) }));
      await refreshTemplates();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const exName = (id: number) => nameOf(exercises, id);

  return (
    <div className="space-y-8">
      {/* 模板市场 */}
      <section className="space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Store className="size-6 text-primary" /> 模板市场</h1>
          <p className="mt-1 text-sm text-muted-foreground">复制其他训练者公开的计划，高级训练法设置会随副本一并带走</p>
        </div>

        {lastCopied && (
          <Card className="border-primary/40 py-3">
            <CardContent className="flex flex-wrap items-center justify-between gap-2 px-4 text-sm">
              <span>已复制「{lastCopied}」到我的计划。</span>
              <Link to="/plans" className="font-medium text-primary hover:underline">前往训练计划查看 →</Link>
            </CardContent>
          </Card>
        )}

        {!templates && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>}

        {templates && templates.length === 0 && (
          <Card className="py-8 text-center">
            <CardContent className="space-y-2">
              <Store className="mx-auto size-9 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">模板市场还没有公开模板。</p>
              <p className="mx-auto max-w-md text-xs text-muted-foreground">
                在下方「我的计划与高级训练法」中展开一个计划，打开「设为模板」与「公开分享」并保存，
                其他用户就能在这里看到并复制你的计划。
              </p>
            </CardContent>
          </Card>
        )}

        {templates && templates.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <Card key={t.id} className="tiger-lift flex flex-col py-4">
                <CardHeader className="space-y-1 px-4">
                  <CardTitle className="text-base">{t.name}</CardTitle>
                  {t.goal && <p className="line-clamp-2 text-xs text-muted-foreground">{t.goal}</p>}
                </CardHeader>
                <CardContent className="mt-auto space-y-3 px-4">
                  <div className="flex flex-wrap gap-1.5">
                    {t.is_public && <Badge>公开</Badge>}
                    {t.is_mine && <Badge variant="secondary">我的</Badge>}
                    <span className="text-[11px] text-muted-foreground">创建于 {t.created_at.slice(0, 10)}</span>
                  </div>
                  <Button size="sm" className="w-full" disabled={copying !== null} onClick={() => onCopy(t)}>
                    <Copy className={cn("size-4", copying === t.id && "animate-pulse")} /> {copying === t.id ? "复制中…" : "复制为我的计划"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 我的计划与高级训练法 */}
      <section className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold"><SlidersHorizontal className="size-5 text-primary" /> 我的计划与高级训练法</h2>
          <p className="mt-1 text-sm text-muted-foreground">为每个训练日配置 EMOM / AMRAP / HIIT / Tabata，为每个动作配置递减组、超级组与 RPE</p>
        </div>

        {!plans && <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>}

        {plans && plans.length === 0 && (
          <Card className="py-8 text-center">
            <CardContent className="space-y-3">
              <Dumbbell className="mx-auto size-9 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">还没有训练计划。先到「训练计划」页创建计划与训练日，再回来配置高级训练法。</p>
              <Link to="/plans" className="text-sm font-medium text-primary hover:underline">前往训练计划 →</Link>
            </CardContent>
          </Card>
        )}

        {plans?.map((plan) => {
          const isOpen = expanded === plan.id;
          const draft = drafts[plan.id];
          const meta = metas[plan.id];
          return (
            <Card key={plan.id} className="py-0">
              <button type="button" className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left" onClick={() => toggleExpand(plan)}
                aria-expanded={isOpen} aria-label={`展开计划 ${plan.name} 的高级设置`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{plan.name}</span>
                    {meta?.is_template && <Badge variant="secondary">模板</Badge>}
                    {meta?.is_public && <Badge>公开</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {plan.goal ? `${plan.goal} · ` : ""}{plan.days.length} 个训练日 · {plan.days.reduce((s, d) => s + d.items.length, 0)} 个动作
                  </p>
                </div>
                {isOpen ? <ChevronUp className="size-5 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-5 shrink-0 text-muted-foreground" />}
              </button>

              {isOpen && (
                <CardContent className="space-y-4 border-t border-border px-5 pb-5 pt-4">
                  {metaLoading === plan.id && <Skeleton className="h-40 rounded-xl" />}
                  {metaLoading !== plan.id && draft && (
                    <>
                      {/* 模板 / 公开开关 */}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 p-3">
                          <div>
                            <Label htmlFor={`tpl-${plan.id}`} className="text-sm font-medium">设为模板</Label>
                            <p className="mt-0.5 text-xs text-muted-foreground">开启后出现在模板市场（默认仅自己可见）</p>
                          </div>
                          <Switch id={`tpl-${plan.id}`} checked={draft.isTemplate}
                            onCheckedChange={(v) => patchDraft(plan.id, (d) => ({ ...d, isTemplate: v }))} aria-label="设为模板" />
                        </div>
                        <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 p-3">
                          <div>
                            <Label htmlFor={`pub-${plan.id}`} className="text-sm font-medium">公开分享</Label>
                            <p className="mt-0.5 text-xs text-muted-foreground">公开后其他用户可在模板市场复制（需同时开启「设为模板」）</p>
                          </div>
                          <Switch id={`pub-${plan.id}`} checked={draft.isPublic}
                            onCheckedChange={(v) => patchDraft(plan.id, (d) => ({ ...d, isPublic: v }))} aria-label="公开分享" />
                        </div>
                      </div>

                      {plan.days.length === 0 && <p className="text-xs text-muted-foreground">该计划还没有训练日，先到「训练计划」页添加。</p>}

                      {/* 每个训练日 */}
                      {plan.days.map((day) => {
                        const dd = draft.days[day.id] ?? emptyDayDraft();
                        const fields = dayFields(dd.day_type);
                        const setDay = (patch: Partial<DayDraft>) => patchDraft(plan.id, (d) => ({
                          ...d, days: { ...d.days, [day.id]: { ...(d.days[day.id] ?? emptyDayDraft()), ...patch } },
                        }));
                        return (
                          <div key={day.id} className="space-y-3 rounded-xl border border-border bg-background/40 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">第 {day.day_index + 1} 天</Badge>
                              <span className="text-sm font-semibold">{day.name}</span>
                              <span className="text-xs text-muted-foreground">{day.items.length} 个动作</span>
                              <div className="ml-auto">
                                <Select value={dd.day_type} onValueChange={(v) => setDay({ day_type: v })}>
                                  <SelectTrigger size="sm" className="w-52" aria-label={`训练日类型 ${day.name}`}><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {DAY_TYPES.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            {dd.day_type !== "standard" && (
                              <div className="flex flex-wrap items-end gap-2">
                                {fields.map((f) => (
                                  <div key={f.key} className="space-y-1">
                                    <Label className="text-[11px] text-muted-foreground">{f.label}</Label>
                                    <Input type="number" min={f.min} max={f.max} step={1} className="h-8 w-32" value={dd[f.key]}
                                      onChange={(e) => setDay({ ...dd, [f.key]: e.target.value })} aria-label={`${day.name} ${f.label}`} />
                                  </div>
                                ))}
                                {dd.day_type === "tabata" && <p className="pb-1.5 text-[11px] text-muted-foreground">经典配方：8 轮 × 20 秒练 / 10 秒歇</p>}
                                {dd.day_type === "emom" && <p className="pb-1.5 text-[11px] text-muted-foreground">每分钟开头完成规定动作，剩余时间休息</p>}
                                {dd.day_type === "amrap" && <p className="pb-1.5 text-[11px] text-muted-foreground">在时间上限内尽可能完成更多轮</p>}
                              </div>
                            )}

                            {/* 每个动作的高级组设置 */}
                            {day.items.length > 0 && (
                              <div className="space-y-2">
                                {day.items.map((it) => {
                                  const xd = draft.items[it.id] ?? emptyItemDraft();
                                  const setItem = (patch: Partial<ItemDraft>) => patchDraft(plan.id, (d) => ({
                                    ...d, items: { ...d.items, [it.id]: { ...(d.items[it.id] ?? emptyItemDraft()), ...patch } },
                                  }));
                                  return (
                                    <div key={it.id} className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg bg-accent/30 px-2 py-2">
                                      <div className="min-w-32 flex-1">
                                        <div className="truncate text-sm font-medium">{exName(it.exercise_id)}</div>
                                        <div className="text-[11px] text-muted-foreground">{it.sets} 组 × {it.reps} 次{Number(it.weight) > 0 ? ` @ ${it.weight}kg` : ""}</div>
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-[11px] text-muted-foreground">组类型</Label>
                                        <Select value={xd.set_type} onValueChange={(v) => setItem({ set_type: v })}>
                                          <SelectTrigger size="sm" className="w-32" aria-label={`组类型 ${exName(it.exercise_id)}`}><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            {SET_TYPES.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-[11px] text-muted-foreground">超级组编号</Label>
                                        <Input type="number" min={0} max={60} step={1} className="h-8 w-24" placeholder="无" value={xd.superset_group}
                                          onChange={(e) => setItem({ superset_group: e.target.value })} aria-label={`超级组编号 ${exName(it.exercise_id)}`} />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-[11px] text-muted-foreground">RPE 1-10</Label>
                                        <Input type="number" min={1} max={10} step={1} className="h-8 w-20" placeholder="未设" value={xd.rpe}
                                          onChange={(e) => setItem({ rpe: e.target.value })} aria-label={`RPE ${exName(it.exercise_id)}`} />
                                      </div>
                                    </div>
                                  );
                                })}
                                <p className="text-[11px] text-muted-foreground">超级组编号留空 = 无；相同编号的动作组成超级组。RPE 为自觉用力程度（1-10），留空 = 未设。</p>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground">
                          {meta?.updated_at ? `上次保存：${meta.updated_at.slice(0, 16).replace("T", " ")}` : "尚未保存过高级设置"}
                          {draft.isTemplate && !draft.isPublic ? " · 当前仅自己可见" : ""}
                        </p>
                        <Button onClick={() => onSave(plan)} disabled={busy}>
                          <Save className={cn("size-4", busy && "animate-pulse")} /> {busy ? "保存中…" : "保存高级设置"}
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </section>
    </div>
  );
}