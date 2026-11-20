import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Line, LineChart, XAxis, YAxis } from "recharts";
import { CalendarCheck, ClipboardList, Scale, UtensilsCrossed, Bot, Pencil, Flame, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useAuth } from "@/src/lib/auth";
import { api, errText, todayStr, ACTIVITY_ZH, type Profile, type WeightEntry, type WorkoutLog, type DietEntry, type Plan } from "@/src/lib/api";

const chartConfig = { weight: { label: "体重 kg", color: "var(--chart-1)" } } satisfies ChartConfig;

function mondayOfThisWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [weights, setWeights] = useState<WeightEntry[] | null>(null);
  const [logs, setLogs] = useState<WorkoutLog[] | null>(null);
  const [diet, setDiet] = useState<DietEntry[] | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ display_name: "", gender: "", birth_year: "", height_cm: "", activity: "moderate", kcal_target: "", protein_target: "" });
  const [busy, setBusy] = useState(false);

  const today = todayStr();

  const load = useCallback(async () => {
    const [p, w, l, d, pl] = await Promise.allSettled([
      api.getProfile(), api.getWeight(), api.getLogs(), api.getDiet(today), api.getPlans(),
    ]);
    if (p.status === "fulfilled") setProfile(p.value.profile);
    if (w.status === "fulfilled") setWeights(w.value);
    if (l.status === "fulfilled") setLogs(l.value);
    if (d.status === "fulfilled") setDiet(d.value);
    if (pl.status === "fulfilled") setPlans(pl.value);
  }, [today]);

  useEffect(() => { void load(); }, [load]);

  const latest = weights && weights.length > 0 ? weights[weights.length - 1] : null;
  const prev = weights && weights.length > 1 ? weights[weights.length - 2] : null;
  const delta = latest && prev ? Number(latest.weight_kg) - Number(prev.weight_kg) : null;
  const weekLogs = useMemo(() => {
    const monday = mondayOfThisWeek();
    return (logs ?? []).filter((l) => l.log_date >= monday);
  }, [logs]);
  const todayKcal = useMemo(() => Math.round((diet ?? []).reduce((s, e) => s + Number(e.kcal), 0)), [diet]);
  const chartData = useMemo(() => (weights ?? []).slice(-60).map((e) => ({ date: e.entry_date, weight: Number(e.weight_kg) })), [weights]);

  const openEdit = () => {
    setForm({
      display_name: profile?.display_name ?? user?.username ?? "",
      gender: profile?.gender ?? "",
      birth_year: profile?.birth_year ? String(profile.birth_year) : "",
      height_cm: profile?.height_cm ? String(profile.height_cm) : "",
      activity: profile?.activity ?? "moderate",
      kcal_target: profile?.kcal_target ? String(profile.kcal_target) : "",
      protein_target: profile?.protein_target ? String(profile.protein_target) : "",
    });
    setEditOpen(true);
  };

  const saveProfile = async () => {
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const birth = num(form.birth_year);
    const height = num(form.height_cm);
    const kcal = num(form.kcal_target);
    const protein = num(form.protein_target);
    if (form.display_name.trim().length === 0) { toast.error("请填写昵称"); return; }
    if (birth !== null && (!Number.isInteger(birth) || birth < 1920 || birth > 2020)) { toast.error("出生年份应在 1920-2020 之间"); return; }
    if (height !== null && (!Number.isInteger(height) || height < 100 || height > 250)) { toast.error("身高应在 100-250cm 之间"); return; }
    if (kcal !== null && (!Number.isInteger(kcal) || kcal < 800 || kcal > 6000)) { toast.error("热量目标应在 800-6000 kcal 之间"); return; }
    if (protein !== null && (!Number.isInteger(protein) || protein < 30 || protein > 400)) { toast.error("蛋白质目标应在 30-400g 之间"); return; }
    setBusy(true);
    try {
      const { profile: p } = await api.putProfile({
        display_name: form.display_name.trim().slice(0, 30),
        gender: form.gender,
        birth_year: birth, height_cm: height,
        activity: form.activity,
        kcal_target: kcal, protein_target: protein,
      });
      setProfile(p);
      setEditOpen(false);
      toast.success("资料已保存，虎教练会参考这些信息");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const loading = !weights || !logs || !diet || !plans;
  const greetingName = profile?.display_name || user?.username || "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">你好，{greetingName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{today} · 坚持记录，改变看得见</p>
        </div>
        <Button variant="outline" size="sm" onClick={openEdit}><Pencil className="size-4" /> 个人资料</Button>
      </div>

      {loading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>}

      {!loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="py-4">
              <CardContent className="px-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Scale className="size-3.5" /> 最新体重</div>
                <div className="mt-1 text-2xl font-bold">{latest ? `${latest.weight_kg}` : "—"}<span className="text-sm font-normal text-muted-foreground"> kg</span></div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  {delta !== null && (delta < 0 ? <TrendingDown className="size-3.5 text-chart-2" /> : delta > 0 ? <TrendingUp className="size-3.5 text-chart-4" /> : null)}
                  {latest ? latest.entry_date : "去记第一笔"}
                </div>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="px-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarCheck className="size-3.5" /> 本周训练</div>
                <div className="mt-1 text-2xl font-bold">{weekLogs.length}<span className="text-sm font-normal text-muted-foreground"> 次</span></div>
                <div className="mt-0.5 text-xs text-muted-foreground">累计 {(logs ?? []).length} 次打卡</div>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="px-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Flame className="size-3.5" /> 今日摄入</div>
                <div className="mt-1 text-2xl font-bold">{todayKcal}<span className="text-sm font-normal text-muted-foreground"> kcal{profile?.kcal_target ? ` / ${profile.kcal_target}` : ""}</span></div>
                <div className="mt-0.5 text-xs text-muted-foreground">{(diet ?? []).length} 条饮食记录</div>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="px-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><ClipboardList className="size-3.5" /> 训练计划</div>
                <div className="mt-1 text-2xl font-bold">{(plans ?? []).length}<span className="text-sm font-normal text-muted-foreground"> 个</span></div>
                <div className="mt-0.5 text-xs text-muted-foreground">{(plans ?? []).reduce((s, p) => s + p.days.length, 0)} 个训练日</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* 体重趋势 */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">体重趋势</CardTitle>
                <Link to="/weight" className="text-xs text-primary hover:underline">记录体重 →</Link>
              </CardHeader>
              <CardContent>
                {chartData.length === 0 ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    还没有体重记录，<Link to="/weight" className="ml-1 text-primary hover:underline">去记第一笔</Link>
                  </div>
                ) : (
                  <ChartContainer config={chartConfig} className="h-40 w-full">
                    <LineChart data={chartData} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={6} tickFormatter={(v: string) => v.slice(5)} minTickGap={28} />
                      <YAxis hide domain={["dataMin - 0.5", "dataMax + 0.5"]} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line dataKey="weight" type="monotone" stroke="var(--color-weight)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            {/* 快捷入口 */}
            <Card>
              <CardHeader><CardTitle className="text-base">快速开始</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-auto flex-col gap-1.5 py-3" asChild>
                  <Link to="/train"><CalendarCheck className="size-5 text-primary" /> 去打卡</Link>
                </Button>
                <Button variant="outline" className="h-auto flex-col gap-1.5 py-3" asChild>
                  <Link to="/diet"><UtensilsCrossed className="size-5 text-chart-2" /> 记饮食</Link>
                </Button>
                <Button variant="outline" className="h-auto flex-col gap-1.5 py-3" asChild>
                  <Link to="/plans"><ClipboardList className="size-5 text-chart-3" /> 排计划</Link>
                </Button>
                <Button variant="outline" className="h-auto flex-col gap-1.5 py-3" asChild>
                  <Link to="/coach"><Bot className="size-5 text-chart-4" /> 问虎教练</Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* 最近打卡 */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">最近打卡</CardTitle>
              <Link to="/train" className="text-xs text-primary hover:underline">全部记录 →</Link>
            </CardHeader>
            <CardContent>
              {(logs ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  还没有打卡。先到<Link to="/plans" className="mx-1 text-primary hover:underline">计划页</Link>安排训练日，然后开始第一次训练吧。
                </p>
              ) : (
                <div className="space-y-2">
                  {(logs ?? []).slice(0, 3).map((log) => (
                    <div key={log.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                      <Badge variant="secondary">{log.log_date}</Badge>
                      <span className="font-medium">{log.plan_name}{log.day_name ? ` · ${log.day_name}` : ""}</span>
                      <span className="text-xs text-muted-foreground">
                        {log.detail.length} 个动作 · 完成 {log.detail.reduce((s, d) => s + d.done_sets, 0)} 组 · {log.duration_min} 分钟
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* 资料编辑 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>个人资料</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>昵称</Label>
              <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} maxLength={30} />
            </div>
            <div className="space-y-1.5">
              <Label>性别</Label>
              <Select value={form.gender || "unset"} onValueChange={(v) => setForm({ ...form, gender: v === "unset" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">不填写</SelectItem>
                  <SelectItem value="male">男</SelectItem>
                  <SelectItem value="female">女</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>活动水平</Label>
              <Select value={form.activity} onValueChange={(v) => setForm({ ...form, activity: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTIVITY_ZH).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>出生年份</Label>
              <Input type="number" min={1920} max={2020} value={form.birth_year} onChange={(e) => setForm({ ...form, birth_year: e.target.value })} placeholder="例如 1995" />
            </div>
            <div className="space-y-1.5">
              <Label>身高 cm</Label>
              <Input type="number" min={100} max={250} value={form.height_cm} onChange={(e) => setForm({ ...form, height_cm: e.target.value })} placeholder="例如 175" />
            </div>
            <div className="space-y-1.5">
              <Label>每日热量目标 kcal</Label>
              <Input type="number" min={800} max={6000} value={form.kcal_target} onChange={(e) => setForm({ ...form, kcal_target: e.target.value })} placeholder="例如 1800" />
            </div>
            <div className="space-y-1.5">
              <Label>每日蛋白质目标 g</Label>
              <Input type="number" min={30} max={400} value={form.protein_target} onChange={(e) => setForm({ ...form, protein_target: e.target.value })} placeholder="例如 120" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">这些资料只用于个性化建议与目标对比，保存在你自己的账号下。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={saveProfile} disabled={busy}>{busy ? "保存中…" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}