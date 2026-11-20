import { useCallback, useEffect, useMemo, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Plus, Ruler, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { api, errText, todayStr, ApiError, type MeasurementCategory, type MeasurementEntry } from "@/src/lib/api";
import { cn } from "@/lib/utils";

// 服务端限制（functions/validate.mjs + router.mjs）：
// 名称 ≤60 码点、单位 ≤12 码点、数值 0-100000（两位小数）、备注 ≤200 码点、项目上限 40 个。
const NAME_MAX = 60;
const UNIT_MAX = 12;
const VALUE_MAX = 100000;
const NOTE_MAX = 200;
const SUGGESTIONS = ["腰围", "臀围", "胸围", "上臂围", "大腿围"];

const byDateAsc = (a: MeasurementEntry, b: MeasurementEntry) =>
  a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at);

type DelTarget = { kind: "cat" | "entry"; id: string; label: string };

export default function Measurements() {
  const [cats, setCats] = useState<MeasurementCategory[] | null>(null);
  const [entries, setEntries] = useState<MeasurementEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [addCatOpen, setAddCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catUnit, setCatUnit] = useState("cm");

  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(todayStr());
  const [entryValue, setEntryValue] = useState("");
  const [entryNote, setEntryNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [delTarget, setDelTarget] = useState<DelTarget | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([api.getMeasCategories(), api.getMeasEntries()]);
      setCats(c);
      setEntries(e);
    } catch (e) {
      toast.error(errText(e));
      setCats([]);
      setEntries([]);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // 默认选中第一个项目；被删除后自动回退。
  useEffect(() => {
    if (!cats) return;
    if (cats.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !cats.some((c) => c.id === selectedId)) setSelectedId(cats[0].id);
  }, [cats, selectedId]);

  const byCat = useMemo(() => {
    const m = new Map<string, MeasurementEntry[]>();
    for (const e of [...(entries ?? [])].sort(byDateAsc)) {
      const list = m.get(e.category_id);
      if (list) list.push(e);
      else m.set(e.category_id, [e]);
    }
    return m;
  }, [entries]);

  const selected = cats?.find((c) => c.id === selectedId) ?? null;
  const selEntries = selected ? byCat.get(selected.id) ?? [] : [];
  const chartData = useMemo(
    () => selEntries.map((e) => ({ date: e.entry_date, value: Number(e.value) })),
    [selEntries],
  );
  const chartConfig = useMemo(() => ({
    value: { label: selected ? `${selected.name}（${selected.unit}）` : "围度", color: "var(--chart-1)" },
  }) satisfies ChartConfig, [selected]);

  const createCategory = async (rawName: string, rawUnit: string) => {
    const name = rawName.trim();
    const unit = rawUnit.trim();
    if (!name || [...name].length > NAME_MAX) { toast.error(`名称需为 1-${NAME_MAX} 个字符`); return; }
    if (!unit || [...unit].length > UNIT_MAX) { toast.error(`单位需为 1-${UNIT_MAX} 个字符，例如 cm`); return; }
    setBusy(true);
    try {
      const created = await api.addMeasCategory(name, unit);
      toast.success(`已添加「${created.name}」`);
      setAddCatOpen(false);
      setCatName("");
      setCatUnit("cm");
      await refresh();
      setSelectedId(created.id);
    } catch (e) {
      toast.error(e instanceof ApiError && e.code === "too_many_items"
        ? "围度项目最多 40 个，请先删除不用的项目"
        : errText(e));
    } finally {
      setBusy(false);
    }
  };

  const openAddEntry = () => {
    setEntryDate(todayStr());
    setEntryValue("");
    setEntryNote("");
    setAddEntryOpen(true);
  };

  const onAddEntry = async () => {
    if (!selected) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) { toast.error("日期格式应为 YYYY-MM-DD"); return; }
    const v = Number(entryValue);
    if (entryValue.trim() === "" || !Number.isFinite(v) || v < 0 || v > VALUE_MAX) {
      toast.error(`请输入有效数值（0-${VALUE_MAX}）`);
      return;
    }
    setBusy(true);
    try {
      await api.addMeasEntry({
        category_id: selected.id,
        entry_date: entryDate,
        value: Math.round(v * 100) / 100,
        note: entryNote.trim().slice(0, NOTE_MAX),
      });
      toast.success("已记录");
      setAddEntryOpen(false);
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!delTarget) return;
    const t = delTarget;
    setDelTarget(null);
    setBusy(true);
    try {
      if (t.kind === "cat") {
        await api.deleteMeasCategory(t.id);
        toast.success(`已删除「${t.label}」及其全部记录`);
      } else {
        await api.deleteMeasEntry(t.id);
        toast.success("已删除");
      }
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const loading = cats === null || entries === null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">围度记录</h1>
          <p className="mt-1 text-sm text-muted-foreground">腰围、臀围、臂围…定期测量，看见减脂的真实变化</p>
        </div>
        <Button onClick={() => { setCatName(""); setCatUnit("cm"); setAddCatOpen(true); }} disabled={busy}>
          <Plus className="size-4" /> 添加围度
        </Button>
      </div>

      {loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
          <Skeleton className="h-56 rounded-xl" />
        </>
      )}

      {/* 空状态：快捷创建建议 */}
      {!loading && cats.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Ruler className="size-10 text-muted-foreground opacity-50" />
            <div>
              <p className="font-medium">还没有围度项目</p>
              <p className="mt-1 text-sm text-muted-foreground">点下面的快捷按钮一键创建（单位 cm），或自定义名称与单位</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" className="rounded-full" disabled={busy}
                  onClick={() => void createCategory(s, "cm")}>
                  <Plus className="size-3.5" /> {s}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 项目卡片列表 */}
      {!loading && cats.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => {
            const list = byCat.get(c.id) ?? [];
            const latest = list.length > 0 ? list[list.length - 1] : null;
            const prev = list.length > 1 ? list[list.length - 2] : null;
            const delta = latest && prev ? Number(latest.value) - Number(prev.value) : null;
            return (
              <Card key={c.id} role="button" tabIndex={0}
                onClick={() => setSelectedId(c.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(c.id); } }}
                className={cn("tiger-lift cursor-pointer py-4", selectedId === c.id && "border-primary ring-1 ring-primary")}>
                <CardContent className="px-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{c.name}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant="secondary" className="text-[10px]">{c.unit}</Badge>
                      <Button variant="ghost" size="icon" className="size-6 text-destructive" aria-label={`删除${c.name}`}
                        onClick={(e) => { e.stopPropagation(); setDelTarget({ kind: "cat", id: c.id, label: c.name }); }}>
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-1 text-2xl font-bold">
                    {latest ? Number(latest.value) : "—"}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">{c.unit}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    {delta === null ? "暂无对比" : (
                      <>
                        {delta < 0 ? <TrendingDown className="size-3.5 text-chart-2" /> : delta > 0 ? <TrendingUp className="size-3.5 text-chart-4" /> : null}
                        <span>较上次 {delta > 0 ? "+" : ""}{delta.toFixed(2)} {c.unit}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {latest ? latest.entry_date : "还没有记录"} · 共 {list.length} 条
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 选中项目的趋势与明细 */}
      {!loading && selected && (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{selected.name}趋势（{selected.unit}）</CardTitle>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={openAddEntry}>
                <Plus className="size-3.5" /> 记一笔
              </Button>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Ruler className="size-8 opacity-50" />
                  <p className="text-sm">还没有记录，点右上角「记一笔」添加第一条</p>
                </div>
              ) : (
                <ChartContainer config={chartConfig} className="h-56 w-full">
                  <LineChart data={chartData} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8}
                      tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} width={48} domain={["dataMin - 1", "dataMax + 1"]}
                      tickFormatter={(v: number) => v.toFixed(1)} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={chartData.length < 40} />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {selEntries.length > 0 && (
            <Card className="py-2">
              <CardContent className="px-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead>数值</TableHead>
                      <TableHead className="hidden sm:table-cell">备注</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...selEntries].reverse().map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.entry_date}</TableCell>
                        <TableCell>{Number(e.value)} {selected.unit}</TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">{e.note || "—"}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label="删除记录"
                            onClick={() => setDelTarget({ kind: "entry", id: e.id, label: `${e.entry_date} 的记录` })}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* 添加项目对话框 */}
      <Dialog open={addCatOpen} onOpenChange={(o) => !o && setAddCatOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>添加围度项目</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>名称</Label>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} maxLength={NAME_MAX} placeholder="例如 腰围 / 颈围" />
            </div>
            <div className="space-y-1.5">
              <Label>单位</Label>
              <Input value={catUnit} onChange={(e) => setCatUnit(e.target.value)} maxLength={UNIT_MAX} placeholder="cm" />
              <p className="text-[11px] text-muted-foreground">常用 cm，也可用 mm / in 等，最多 {UNIT_MAX} 个字符</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCatOpen(false)}>取消</Button>
            <Button onClick={() => void createCategory(catName, catUnit)} disabled={busy}>{busy ? "添加中…" : "添加"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加记录对话框 */}
      <Dialog open={addEntryOpen} onOpenChange={(o) => !o && setAddEntryOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>记录{selected ? selected.name : "围度"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>日期</Label>
              <Input type="date" value={entryDate} min="2000-01-01" max="2100-12-31" onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>数值{selected ? `（${selected.unit}）` : ""}</Label>
              <Input type="number" min={0} max={VALUE_MAX} step={0.1} value={entryValue}
                onChange={(e) => setEntryValue(e.target.value)} placeholder="例如 80.5" />
            </div>
            <div className="space-y-1.5">
              <Label>备注（可选）</Label>
              <Input value={entryNote} onChange={(e) => setEntryNote(e.target.value)} maxLength={NOTE_MAX} placeholder="晨起空腹 / 训练后…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddEntryOpen(false)}>取消</Button>
            <Button onClick={() => void onAddEntry()} disabled={busy}>{busy ? "保存中…" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={delTarget !== null} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除？</AlertDialogTitle>
            <AlertDialogDescription>
              {delTarget?.kind === "cat"
                ? `将删除「${delTarget.label}」及其全部测量记录，此操作无法恢复。`
                : `将删除${delTarget?.label ?? ""}，此操作无法恢复。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onConfirmDelete()} disabled={busy}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}