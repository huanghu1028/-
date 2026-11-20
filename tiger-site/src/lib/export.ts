// 客户端导出：CSV / iCal 文件下载与打印（PDF 走浏览器打印）。不经过服务端。
import type { WeightEntry, WorkoutLog } from "@/src/lib/api";
import { kgToUnit, type WeightUnit } from "@/src/lib/units";

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function downloadText(filename: string, mime: string, text: string) {
  // BOM 让 Excel 正确识别 UTF-8 中文
  const blob = new Blob(["﻿" + text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function weightCsv(entries: WeightEntry[], unit: WeightUnit): string {
  const head = ["date", "weight_kg", `weight_${unit}`, "note"];
  const lines = entries.map((e) => [
    e.entry_date, e.weight_kg, kgToUnit(Number(e.weight_kg), unit).toFixed(2), e.note ?? "",
  ].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\r\n");
}

export function logsCsv(logs: WorkoutLog[]): string {
  const head = ["log_date", "plan_name", "day_name", "duration_min", "exercise_id", "exercise_name", "sets", "reps", "weight_kg", "done_sets", "note"];
  const lines: string[] = [];
  for (const l of logs) {
    if (l.detail.length === 0) {
      lines.push([l.log_date, l.plan_name, l.day_name, l.duration_min, "", "", "", "", "", "", l.note].map(csvCell).join(","));
      continue;
    }
    for (const d of l.detail) {
      lines.push([l.log_date, l.plan_name, l.day_name, l.duration_min, d.exercise_id, d.name, d.sets, d.reps, d.weight, d.done_sets, l.note].map(csvCell).join(","));
    }
  }
  return [head.join(","), ...lines].join("\r\n");
}

const icalEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icalDate = (d: string) => d.replaceAll("-", "");

export function logsIcal(logs: WorkoutLog[]): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//tiger-fatloss//workout logs//CN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  ];
  for (const l of logs) {
    const summary = `${l.plan_name}${l.day_name ? ` · ${l.day_name}` : ""}`;
    const desc = [
      ...l.detail.map((d) => `${d.name}: ${d.done_sets}/${d.sets} 组 x ${d.reps} 次 @ ${d.weight} kg`),
      `时长 ${l.duration_min} 分钟`,
      l.note ? `备注: ${l.note}` : "",
    ].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${l.id}@tiger-fatloss`,
      `DTSTAMP:${icalDate(l.created_at.slice(0, 10))}T000000Z`,
      `DTSTART;VALUE=DATE:${icalDate(l.log_date)}`,
      `SUMMARY:${icalEscape(summary)}`,
      `DESCRIPTION:${icalEscape(desc)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}