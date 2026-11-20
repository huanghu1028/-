import { useCallback, useEffect, useMemo, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Scale, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { api, errText, todayStr, type WeightEntry } from "@/src/lib/api";
import { fmtWeight, kgToUnit, unitToKg, type WeightUnit } from "@/src/lib/units";

export default function Weight() {
  const [entries, setEntries] = useState<WeightEntry[] | null>(null);
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [date, setDate] = useState(todayStr());
  const [kg, setKg] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [w, p] = await Promise.allSettled([api.getWeight(), api.getPreferences()]);
    if (w.status === "fulfilled") setEntries(w.value);
    else { toast.error(errText(w.reason)); setEntries([]); }
    if (p.status === "fulfilled") setUnit(p.value.preferences.weight_unit === "lb" ? "lb" : "kg");
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const chartConfig = useMemo(() => ({ weight: { label: `体重 ${unit}`, color: "var(--chart-1)" } }) satisfies ChartConfig, [unit]);
  const chartData = useMemo(
    () => (entries ?? []).map((e) => ({ date: e.entry_date, weight: +kgToUnit(Number(e.weight_kg), unit).toFixed(2) })),
    [entries, unit],
  );
  const latest = entries && entries.length > 0 ? entries[entries.length - 1] : null;
  const prev = entries && entries.length > 1 ? entries[entries.length - 2] : null;
  const delta = latest && prev ? Number(latest.weight_kg) - Number(prev.weight_kg) : null;
  const first = entries && entries.length > 0 ? entries[0] : null;
  const totalDelta = latest && first && entries!.length > 1 ? Number(latest.weight_kg) - Number(first.weight_kg) : null;

  const onSubmit = async () => {
    const value = Number(kg);
    const max = unit === "lb" ? 1100 : 500;
    if (!Number.isFinite(value) || value <= 0 || value > max) { toast.error(`请输入有效体重（0-${max} ${unit}）`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error("日期格式应为 YYYY-MM-DD"); return; }
    setBusy(true);
    try {
      const kgValue = Math.round(unitToKg(value, unit) * 100) / 100;
      await api.putWeight(date, kgValue, note.trim().slice(0, 200));
      toast.success("体重已记录（同一天重复提交会更新）");
      setKg(""); setNote("");
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">体重记录</h1>
        <p className="mt-1 text-sm text-muted-foreground">每天固定时间称重更可比，建议晨起空腹</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="py-4">
          <CardContent className="px-4">
            <div className="text-xs text-muted-foreground">最新体重</div>
            <div className="mt-1 text-2xl font-bold">{latest ? fmtWeight(Number(latest.weight_kg), unit) : "—"}</div>
            <div className="text-xs text-muted-foreground">{latest?.entry_date ?? "还没有记录"}</div>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent className="px-4">
            <div className="text-xs text-muted-foreground">较上次</div>
            <div className="mt-1 flex items-center gap-1.5 text-2xl font-bold">
              {delta === null ? "—" : (
                <>
                  {delta < 0 ? <TrendingDown className="size-5 text-chart-2" /> : delta > 0 ? <TrendingUp className="size-5 text-chart-4" /> : null}
                  {delta > 0 ? "+" : ""}{kgToUnit(delta, unit).toFixed(2)} {unit}
                </>
              )}
            </div>
            <div className="text-xs text-muted-foreground">单日波动很正常，看周趋势</div>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent className="px-4">
            <div className="text-xs text-muted-foreground">累计变化</div>
            <div className="mt-1 text-2xl font-bold">
              {totalDelta === null ? "—" : `${totalDelta > 0 ? "+" : ""}${kgToUnit(totalDelta, unit).toFixed(2)} ${unit}`}
            </div>
            <div className="text-xs text-muted-foreground">共 {entries?.length ?? 0} 条记录</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">趋势</CardTitle></CardHeader>
        <CardContent>
          {!entries && <Skeleton className="h-56 w-full" />}
          {entries && chartData.length === 0 && (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Scale className="size-8 opacity-50" />
              <p className="text-sm">记录第一条体重后，这里会显示趋势曲线</p>
            </div>
          )}
          {chartData.length > 0 && (
            <ChartContainer config={chartConfig} className="h-56 w-full">
              <LineChart data={chartData} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8}
                  tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={44} domain={["dataMin - 1", "dataMax + 1"]}
                  tickFormatter={(v: number) => v.toFixed(1)} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="weight" type="monotone" stroke="var(--color-weight)" strokeWidth={2} dot={chartData.length < 40} />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">记一笔</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[150px_130px_1fr_auto]">
            <div className="space-y-1.5">
              <Label>日期</Label>
              <Input type="date" value={date} min="2000-01-01" max="2100-12-31" onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>体重 {unit}</Label>
              <Input type="number" min={0.1} max={unit === "lb" ? 1100 : 500} step={0.05} value={kg} onChange={(e) => setKg(e.target.value)} placeholder={unit === "lb" ? "160" : "72.5"} />
            </div>
            <div className="space-y-1.5">
              <Label>备注（可选）</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="晨起空腹 / 训练后…" />
            </div>
            <div className="flex items-end">
              <Button onClick={onSubmit} disabled={busy} className="w-full sm:w-auto">{busy ? "保存中…" : "保存"}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {entries && entries.length > 0 && (
        <Card className="py-2">
          <CardContent className="px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>体重</TableHead>
                  <TableHead className="hidden sm:table-cell">备注</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...entries].reverse().map((e) => (
                  <TableRow key={e.entry_date}>
                    <TableCell className="font-medium">{e.entry_date}</TableCell>
                    <TableCell>{fmtWeight(Number(e.weight_kg), unit, 2)}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{e.note || "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label="删除记录"
                        onClick={async () => {
                          try { await api.deleteWeight(e.entry_date); toast.success("已删除"); await refresh(); }
                          catch (err) { toast.error(errText(err)); }
                        }}>
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
    </div>
  );
}