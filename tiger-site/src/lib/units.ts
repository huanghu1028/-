// 体重单位换算与偏好时区工具：存储一律 kg，显示按用户偏好 kg/lb。
export type WeightUnit = "kg" | "lb";
export const LB_PER_KG = 2.2046226218;

export const kgToUnit = (kg: number, unit: WeightUnit) => (unit === "lb" ? kg * LB_PER_KG : kg);
export const unitToKg = (v: number, unit: WeightUnit) => (unit === "lb" ? v / LB_PER_KG : v);
export const fmtWeight = (kg: number, unit: WeightUnit, digits = 1) => `${kgToUnit(kg, unit).toFixed(digits)} ${unit}`;

// 偏好时区的“今天”（YYYY-MM-DD）；非法时区回退设备本地日期。
export function tzToday(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Shanghai", label: "中国标准时间 (UTC+8)" },
  { value: "Asia/Tokyo", label: "日本标准时间 (UTC+9)" },
  { value: "Asia/Singapore", label: "新加坡时间 (UTC+8)" },
  { value: "Europe/London", label: "伦敦时间 (UTC+0/+1)" },
  { value: "Europe/Berlin", label: "中欧时间 (UTC+1/+2)" },
  { value: "America/New_York", label: "美东时间 (UTC-5/-4)" },
  { value: "America/Los_Angeles", label: "美西时间 (UTC-8/-7)" },
  { value: "Australia/Sydney", label: "悉尼时间 (UTC+10/+11)" },
  { value: "UTC", label: "协调世界时 (UTC)" },
];