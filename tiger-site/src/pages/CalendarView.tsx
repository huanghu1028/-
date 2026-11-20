import { useEffect, useMemo, useRef, useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, isSameDay, parseISO, startOfMonth, subMonths } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Dumbbell, Scale, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errText, todayStr, MEAL_ZH, type DietEntry, type WeightEntry, type WorkoutLog } from "@/src/lib/api";
import { tzToday } from "@/src/lib/units";
import { cn } from "@/lib/utils";

const WEEK_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const dietKcal = (list: DietEntry[]) => Math.round(list.reduce((s, e) => s + Number(e.kcal), 0));

export default function CalendarView() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [logs, setLogs] = useState<WorkoutLog[] | null>(null);
  const [weights, setWeights] = useState<WeightEntry[] | null>(null);
  const [diet, setDiet] = useState<Record<string, DietEntry[]>>({});
  const [dietLoading, setDietLoading] = useState(false);
  const [selected, setSelected] = useState<string>(todayStr());
  const [tz, setTz] = useState<string | undefined>(undefined);

  const dietRef = useRef<Record<string, DietEntry[]>>({});
  const runRef = useRef(0);

  // 训练打卡 + 体重 + 偏好（时区）：一次性拉全量
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [l, w, p] = await Promise.allSettled([api.getLogs(), api.getWeight(), api.getPreferences()]);
      if (!alive) return;
      if (l.status === "fulfilled") setLogs(l.value);
      else { toast.error(errText(l.reason)); setLogs([]); }
      if (w.status === "fulfilled") setWeights(w.value);
      else setWeights([]);
      if (p.status === "fulfilled") {
        const zone = p.value.preferences.timezone;
        setTz(zone);
        const ds = tzToday(zone);
        setSelected(ds);
        setMonth(startOfMonth(parseISO(ds)));
      }
    })();
    return () => { alive = false; };
  }, []);

  // 饮食接口按单日查询：对当月每天并发（限 4）拉取并缓存，翻月不重复请求
  useEffect(() => {
    const run = ++runRef.current;
    const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }).map((d) => format(d, "yyyy-MM-dd"));
    const missing = days.filter((d) => !(d in dietRef.current));
    if (missing.length === 0) { setDiet({ ...dietRef.current }); setDietLoading(false); return; }
    setDietLoading(true);
    let cursor = 0;
    let failed = 0;
    let firstErr: unknown = null;
    const worker = async () => {
      while (cursor < missing.length) {
        const d = missing[cursor++];
        try { dietRef.current[d] = await api.getDiet(d); }
        catch (e) { failed++; firstErr ??= e; }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, missing.length) }, () => worker())).then(() => {
      if (runRef.current !== run) return;
      setDiet({ ...dietRef.current });
      setDietLoading(false);
      if (failed > 0) toast.error(firstErr ? errText(firstErr) : "部分日期的饮食数据加载失败，请点按日期重试");
    });
  }, [month]);

  const logsByDate = useMemo(() => {
    const m = new Map<string, WorkoutLog[]>();
    for (const l of logs ?? []) {
      const arr = m.get(l.log_date) ?? [];
      arr.push(l);
      m.set(l.log_date, arr);
    }
    return m;
  }, [logs]);
  const weightByDate = useMemo(() => new Map<string, WeightEntry>((weights ?? []).map((w) => [w.entry_date, w])), [weights]);

  const days = useMemo(() => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }), [month]);
  const offset = (getDay(days[0]) + 6) % 7; // 周一开头
  const monthPrefix = format(month, "yyyy-MM");
  const monthStats = useMemo(() => ({
    workouts: (logs ?? []).filter((l) => l.log_date.startsWith(monthPrefix)).length,
    weights: (weights ?? []).filter((w) => w.entry_date.startsWith(monthPrefix)).length,
    diets: Object.entries(diet).filter(([d, list]) => d.startsWith(monthPrefix) && list.length > 0).length,
  }), [logs, weights, diet, monthPrefix]);

  const loading = logs === null || weights === null;
  const todayDs = tz ? tzToday(tz) : todayStr();
  const today = parseISO(todayDs);

  const selectDay = (ds: string) => {
    setSelected(ds);
    if (ds in dietRef.current) return;
    void api.getDiet(ds).then((list) => {
      dietRef.current[ds] = list;
      setDiet({ ...dietRef.current });
    }).catch((e) => toast.error(errText(e)));
  };

  const goToday = () => {
    setMonth(startOfMonth(parseISO(todayDs)));
    setSelected(todayDs);
  };

  const selLogs = selected ? logsByDate.get(selected) ?? [] : [];
  const selWeight = selected ? weightByDate.get(selected) : undefined;
  const selDiet = selected ? diet[selected] : undefined;
  const selEmpty = selLogs.length === 0 && !selWeight && (selDiet?.length ?? 0) === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarDays className="size-6 text-primary" /> 记录日历
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">训练、体重、饮食按月汇总，点按日期查看当日详情</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="上个月" onClick={() => setMonth((m) => subMonths(m, 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <div className="min-w-28 text-center text-lg font-bold" aria-live="polite">{format(month, "yyyy年M月")}</div>
          <Button variant="outline" size="icon" aria-label="下个月" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>今天</Button>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* 月历 */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              本月：训练 {monthStats.workouts} 次 · 体重 {monthStats.weights} 天 · 饮食 {monthStats.diets} 天
            </CardTitle>
            {dietLoading && <span className="text-xs text-muted-foreground">饮食数据加载中…</span>}
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-96 w-full rounded-xl" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
                  {["一", "二", "三", "四", "五", "六", "日"].map((w) => <div key={w} className="py-1">周{w}</div>)}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {Array.from({ length: offset }).map((_, i) => <div key={`blank-${i}`} />)}
                  {days.map((day) => {
                    const ds = format(day, "yyyy-MM-dd");
                    const dayLogs = logsByDate.get(ds) ?? [];
                    const w = weightByDate.get(ds);
                    const d = diet[ds];
                    const kcal = d && d.length > 0 ? dietKcal(d) : null;
                    const isToday = isSameDay(day, today);
                    const isSel = selected === ds;
                    return (
                      <button key={ds} type="button" onClick={() => selectDay(ds)} aria-pressed={isSel}
                        aria-label={`${ds}${dayLogs.length ? `，训练 ${dayLogs.length} 次` : ""}${w ? `，体重 ${w.weight_kg} kg` : ""}${kcal !== null ? `，饮食 ${kcal} kcal` : ""}`}
                        className={cn(
                          "flex min-h-20 flex-col gap-0.5 rounded-lg border p-1.5 text-left transition-colors sm:min-h-24",
                          isSel ? "border-primary bg-primary/10" : "border-border hover:border-primary/40 hover:bg-accent/50",
                          isToday && !isSel && "border-primary/40",
                        )}>
                        <span className={cn("text-xs font-medium", isToday && "text-primary")}>
                          {format(day, "d")}
                          {isToday && <span className="ml-1 hidden text-[10px] sm:inline">今天</span>}
                        </span>
                        {dayLogs.length > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-chart-1">
                            <Dumbbell className="size-3 shrink-0" /> 训练×{dayLogs.length}
                          </span>
                        )}
                        {w && (
                          <span className="flex items-center gap-0.5 text-[10px] text-chart-2">
                            <Scale className="size-3 shrink-0" /> {w.weight_kg}kg
                          </span>
                        )}
                        {kcal !== null && (
                          <span className="flex items-center gap-0.5 text-[10px] text-chart-3">
                            <UtensilsCrossed className="size-3 shrink-0" /> {kcal}kcal
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Dumbbell className="size-3 text-chart-1" /> 训练打卡</span>
                  <span className="flex items-center gap-1"><Scale className="size-3 text-chart-2" /> 体重记录</span>
                  <span className="flex items-center gap-1"><UtensilsCrossed className="size-3 text-chart-3" /> 饮食热量</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 当日详情 */}
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="text-base">
              {selected ? `${format(parseISO(selected), "M月d日")} · 周${WEEK_ZH[getDay(parseISO(selected))]}` : "当日详情"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && <Skeleton className="h-40 w-full" />}
            {!loading && !selected && (
              <p className="py-8 text-center text-sm text-muted-foreground">点击日历中的日期查看详情</p>
            )}
            {!loading && selected && selEmpty && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <CalendarDays className="size-8 opacity-50" />
                <p className="text-sm">这一天还没有任何记录</p>
                <p className="text-xs">去「开始训练」「体重记录」「饮食记录」打卡吧</p>
              </div>
            )}
            {!loading && selected && !selEmpty && (
              <>
                {selLogs.length > 0 && (
                  <section className="space-y-2">
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold text-chart-1">
                      <Dumbbell className="size-4" /> 训练（{selLogs.length}）
                    </h2>
                    {selLogs.map((l) => (
                      <div key={l.id} className="rounded-lg border border-border p-2.5 text-sm">
                        <div className="font-medium">{l.plan_name} · {l.day_name}</div>
                        <div className="text-xs text-muted-foreground">{l.duration_min} 分钟{l.note ? ` · ${l.note}` : ""}</div>
                        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                          {l.detail.map((d, i) => (
                            <li key={`${l.id}-${i}`} className="flex justify-between gap-2">
                              <span className="min-w-0 truncate">{d.name}</span>
                              <span className="shrink-0">{d.done_sets}/{d.sets} 组 × {d.reps} 次{d.weight > 0 ? ` @ ${d.weight}kg` : ""}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>
                )}
                {selWeight && (
                  <section className="space-y-1">
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold text-chart-2">
                      <Scale className="size-4" /> 体重
                    </h2>
                    <div className="rounded-lg border border-border p-2.5 text-sm">
                      <span className="text-lg font-bold">{selWeight.weight_kg}</span>
                      <span className="text-xs text-muted-foreground"> kg</span>
                      {selWeight.note && <p className="mt-0.5 text-xs text-muted-foreground">{selWeight.note}</p>}
                    </div>
                  </section>
                )}
                <section className="space-y-1">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-chart-3">
                    <UtensilsCrossed className="size-4" /> 饮食
                    {selDiet && selDiet.length > 0 && <Badge variant="secondary" className="text-[10px]">{dietKcal(selDiet)} kcal</Badge>}
                  </h2>
                  {!selDiet ? (
                    dietLoading ? <Skeleton className="h-16 w-full" /> : <p className="text-xs text-muted-foreground">饮食数据未加载，点按该日期可重试</p>
                  ) : selDiet.length === 0 ? (
                    <p className="text-xs text-muted-foreground">没有饮食记录</p>
                  ) : (
                    <div className="space-y-1">
                      {selDiet.map((e) => (
                        <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                          <Badge variant="outline" className="shrink-0 text-[10px]">{MEAL_ZH[e.meal] ?? e.meal}</Badge>
                          <span className="min-w-0 flex-1 truncate">{e.food_name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{e.grams}g</span>
                          <span className="shrink-0 text-xs font-medium">{e.kcal} kcal</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}