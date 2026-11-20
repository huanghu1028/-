import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ArrowLeft, ChartColumn, Dumbbell, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { api, errText, type WorkoutLog } from "@/src/lib/api";
import { loadExercises } from "@/src/lib/data";

type Session = { date: string; maxWeight: number; volume: number; reps: number; sets: number };

const weightConfig = { maxWeight: { label: "最大重量 kg", color: "var(--chart-1)" } } satisfies ChartConfig;
const volumeConfig = { volume: { label: "训练容量 kg", color: "var(--chart-2)" } } satisfies ChartConfig;
const repsConfig = { reps: { label: "总次数", color: "var(--chart-3)" } } satisfies ChartConfig;

export default function ExerciseAnalytics() {
  const { id } = useParams();
  const exerciseId = Number(id);
  const validId = Number.isInteger(exerciseId) && exerciseId > 0;
  const navigate = useNavigate();

  const [logs, setLogs] = useState<WorkoutLog[] | null>(null);
  const [exerciseName, setExerciseName] = useState<string | null>(null);

  useEffect(() => {
    if (!validId) return;
    let alive = true;
    setLogs(null);
    void api.getLogs()
      .then((l) => { if (alive) setLogs(l); })
      .catch((e) => { if (alive) { toast.error(errText(e)); setLogs([]); } });
    void loadExercises()
      .then((list) => { if (alive) setExerciseName(list.find((x) => x.id === exerciseId)?.name ?? null); })
      .catch(() => { if (alive) setExerciseName(null); });
    return () => { alive = false; };
  }, [exerciseId, validId]);

  // 同一天的多条打卡合并为一个训练日；容量/次数按实际完成组数 done_sets 计
  const sessions = useMemo<Session[]>(() => {
    const map = new Map<string, Session>();
    for (const log of logs ?? []) {
      const details = log.detail.filter((d) => d.exercise_id === exerciseId);
      if (details.length === 0) continue;
      const s = map.get(log.log_date) ?? { date: log.log_date, maxWeight: 0, volume: 0, reps: 0, sets: 0 };
      for (const d of details) {
        s.maxWeight = Math.max(s.maxWeight, d.weight);
        s.volume += d.weight * d.reps * d.done_sets;
        s.reps += d.reps * d.done_sets;
        s.sets += d.done_sets;
      }
      map.set(log.log_date, s);
    }
    return [...map.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({ ...s, volume: Math.round(s.volume) }));
  }, [logs, exerciseId]);

  const logName = useMemo(() => {
    for (const log of logs ?? []) {
      const d = log.detail.find((x) => x.exercise_id === exerciseId);
      if (d?.name) return d.name;
    }
    return null;
  }, [logs, exerciseId]);

  const stats = useMemo(() => ({
    count: sessions.length,
    maxWeight: sessions.reduce((m, s) => Math.max(m, s.maxWeight), 0),
    totalVolume: sessions.reduce((sum, s) => sum + s.volume, 0),
    totalReps: sessions.reduce((sum, s) => sum + s.reps, 0),
  }), [sessions]);

  if (!validId) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">无效的动作编号</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/exercises")}>返回动作库</Button>
      </div>
    );
  }

  const displayName = exerciseName ?? logName ?? `动作 #${exerciseId}`;
  const loading = logs === null;

  return (
    <div className="space-y-5">
      <Link to={`/exercises/${exerciseId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> 返回动作详情
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{displayName} · 训练分析</h1>
        <p className="mt-1 text-sm text-muted-foreground">基于你的打卡记录，追踪最大重量、训练容量与次数的进步</p>
      </div>

      {loading && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-muted-foreground">
            <Dumbbell className="size-10 opacity-50" />
            <p className="text-sm">还没有「{displayName}」的训练记录</p>
            <p className="text-xs">在「开始训练」中完成打卡后，这里会显示你的进步曲线</p>
            <Button variant="outline" className="mt-1" onClick={() => navigate("/train")}>去训练打卡</Button>
          </CardContent>
        </Card>
      )}

      {!loading && sessions.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="py-4">
              <CardContent className="px-4">
                <div className="text-xs text-muted-foreground">训练次数</div>
                <div className="mt-1 text-2xl font-bold">{stats.count}<span className="text-xs font-normal text-muted-foreground"> 次</span></div>
                <div className="text-xs text-muted-foreground">含该动作的打卡日</div>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="px-4">
                <div className="text-xs text-muted-foreground">历史最大重量</div>
                <div className="mt-1 text-2xl font-bold">{stats.maxWeight}<span className="text-xs font-normal text-muted-foreground"> kg</span></div>
                <div className="text-xs text-muted-foreground">单次动作最高负重</div>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="px-4">
                <div className="text-xs text-muted-foreground">累计训练容量</div>
                <div className="mt-1 text-2xl font-bold">{stats.totalVolume.toLocaleString()}<span className="text-xs font-normal text-muted-foreground"> kg</span></div>
                <div className="text-xs text-muted-foreground">重量 × 次数 × 完成组数</div>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="px-4">
                <div className="text-xs text-muted-foreground">累计完成次数</div>
                <div className="mt-1 text-2xl font-bold">{stats.totalReps.toLocaleString()}<span className="text-xs font-normal text-muted-foreground"> 次</span></div>
                <div className="text-xs text-muted-foreground">按实际完成组数统计</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4 text-chart-1" /> 最大重量趋势
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={weightConfig} className="h-56 w-full">
                <LineChart data={sessions} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8}
                    tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={44} domain={["dataMin - 2", "dataMax + 2"]}
                    tickFormatter={(v: number) => v.toFixed(0)} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line dataKey="maxWeight" type="monotone" stroke="var(--color-maxWeight)" strokeWidth={2} dot={sessions.length < 40} />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ChartColumn className="size-4 text-chart-2" /> 每次训练容量
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={volumeConfig} className="h-52 w-full">
                  <BarChart data={sessions} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8}
                      tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} width={52}
                      tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="volume" fill="var(--color-volume)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Dumbbell className="size-4 text-chart-3" /> 每次总次数
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={repsConfig} className="h-52 w-full">
                  <LineChart data={sessions} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8}
                      tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} width={40} domain={[0, "dataMax + 4"]}
                      tickFormatter={(v: number) => v.toFixed(0)} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line dataKey="reps" type="monotone" stroke="var(--color-reps)" strokeWidth={2} dot={sessions.length < 40} />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="py-2">
            <CardHeader className="px-4">
              <CardTitle className="text-base">最近训练</CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead>完成组数</TableHead>
                    <TableHead>总次数</TableHead>
                    <TableHead>最大重量 kg</TableHead>
                    <TableHead className="hidden sm:table-cell">容量 kg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...sessions].reverse().slice(0, 8).map((s) => (
                    <TableRow key={s.date}>
                      <TableCell className="font-medium">{s.date}</TableCell>
                      <TableCell>{s.sets}</TableCell>
                      <TableCell>{s.reps}</TableCell>
                      <TableCell>{s.maxWeight}</TableCell>
                      <TableCell className="hidden sm:table-cell">{s.volume.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}