// 偏好设置：体重单位 / 时区 / 仪表盘组件编排 + 数据导出（CSV / iCal / 打印 PDF）。
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileText, CalendarPlus, Printer, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errText, type Preferences } from "@/src/lib/api";
import { TIMEZONES, type WeightUnit } from "@/src/lib/units";
import { WIDGETS, DEFAULT_LAYOUT, isWidgetId, type WidgetId } from "@/src/lib/widgets";
import { downloadText, weightCsv, logsCsv, logsIcal } from "@/src/lib/export";

export default function Settings() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [unit, setUnit] = useState<WeightUnit>("kg");
  const [tz, setTz] = useState("Asia/Shanghai");
  const [layout, setLayout] = useState<WidgetId[]>([...DEFAULT_LAYOUT]);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { preferences } = await api.getPreferences();
      setPrefs(preferences);
      setUnit(preferences.weight_unit === "lb" ? "lb" : "kg");
      setTz(preferences.timezone || "Asia/Shanghai");
      const saved = (preferences.dashboard_layout ?? []).filter(isWidgetId);
      setLayout(saved.length > 0 ? saved : [...DEFAULT_LAYOUT]);
    } catch (e) {
      toast.error(errText(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id: WidgetId, on: boolean) => {
    setLayout((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
  };
  const move = (id: WidgetId, dir: -1 | 1) => {
    setLayout((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      const { preferences } = await api.putPreferences({ weight_unit: unit, timezone: tz, dashboard_layout: layout });
      setPrefs(preferences);
      toast.success("偏好已保存，总览页会按新设置显示");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const doExport = async (kind: "weight" | "logs" | "ical") => {
    setExporting(kind);
    try {
      if (kind === "weight") {
        const entries = await api.getWeight();
        if (entries.length === 0) { toast.error("还没有体重记录可导出"); return; }
        downloadText(`tiger-weight-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv", weightCsv(entries, unit));
      } else {
        const logs = await api.getLogs();
        if (logs.length === 0) { toast.error("还没有打卡记录可导出"); return; }
        if (kind === "logs") downloadText(`tiger-workouts-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv", logsCsv(logs));
        else downloadText(`tiger-workouts-${new Date().toISOString().slice(0, 10)}.ics`, "text/calendar", logsIcal(logs));
      }
      toast.success("导出文件已开始下载");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Settings2 className="size-6 text-primary" /> 偏好设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">单位、时区、总览组件与数据导出，都保存在你自己的账号下</p>
      </div>

      {!prefs && <Skeleton className="h-64 w-full rounded-xl" />}

      {prefs && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">单位与时区</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>体重单位</Label>
                <Select value={unit} onValueChange={(v) => setUnit(v as WeightUnit)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kg">公斤 kg</SelectItem>
                    <SelectItem value="lb">磅 lb</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">记录仍按 kg 存储，切换单位只改变显示与录入换算。</p>
              </div>
              <div className="space-y-1.5">
                <Label>时区</Label>
                <Select value={tz} onValueChange={setTz}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">用于总览与日历的「今天」；打卡日期按设备本地日期记录。</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">总览页组件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">勾选要显示的组件，用箭头调整顺序；未勾选的组件不会出现在总览页。</p>
              {WIDGETS.map((w) => {
                const on = layout.includes(w.id);
                const i = layout.indexOf(w.id);
                return (
                  <div key={w.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                    <Checkbox checked={on} onCheckedChange={(v) => toggle(w.id, v === true)} aria-label={w.label} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{w.label}</div>
                      <div className="truncate text-xs text-muted-foreground">{w.desc}</div>
                    </div>
                    {on && (
                      <div className="flex items-center gap-1">
                        <span className="mr-1 text-xs text-muted-foreground">{i + 1}</span>
                        <Button variant="ghost" size="icon" className="size-7" disabled={i === 0} onClick={() => move(w.id, -1)} aria-label="上移">
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7" disabled={i === layout.length - 1} onClick={() => move(w.id, 1)} aria-label="下移">
                          <ArrowDown className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              <Button variant="outline" size="sm" onClick={() => setLayout([...DEFAULT_LAYOUT])}>恢复默认编排</Button>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={save} disabled={busy}><Save className="size-4" /> {busy ? "保存中…" : "保存偏好"}</Button>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">数据导出</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">导出在浏览器本地完成，文件不经过服务器。CSV 带 BOM，Excel 打开中文不乱码；iCal 可导入系统日历。</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={exporting !== null} onClick={() => void doExport("weight")}>
                  <Download className="size-4" /> 体重 CSV
                </Button>
                <Button variant="outline" disabled={exporting !== null} onClick={() => void doExport("logs")}>
                  <FileText className="size-4" /> 训练记录 CSV
                </Button>
                <Button variant="outline" disabled={exporting !== null} onClick={() => void doExport("ical")}>
                  <CalendarPlus className="size-4" /> 训练日历 iCal
                </Button>
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="size-4" /> 打印 / 存为 PDF
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}