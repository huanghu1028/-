import { useMemo, useState } from "react";
import { Activity, Calculator, Flame, Ruler, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ---------- BMI（中国成人标准） ----------

const BMI_MIN = 14;
const BMI_MAX = 36;
const BMI_SEGMENTS = [
  { label: "偏瘦", from: 14, to: 18.5, color: "var(--chart-3)", text: "text-chart-3" },
  { label: "正常", from: 18.5, to: 24, color: "var(--chart-2)", text: "text-chart-2" },
  { label: "超重", from: 24, to: 28, color: "var(--chart-1)", text: "text-chart-1" },
  { label: "肥胖", from: 28, to: 36, color: "var(--chart-4)", text: "text-chart-4" },
] as const;

function bmiCategory(bmi: number) {
  if (bmi < 18.5) return BMI_SEGMENTS[0];
  if (bmi < 24) return BMI_SEGMENTS[1];
  if (bmi < 28) return BMI_SEGMENTS[2];
  return BMI_SEGMENTS[3];
}

function BmiCard() {
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("65");

  const result = useMemo(() => {
    const cm = Number(height);
    const kg = Number(weight);
    if (!height.trim() || !weight.trim() || !Number.isFinite(cm) || !Number.isFinite(kg)) return null;
    if (cm < 50 || cm > 250 || kg < 10 || kg > 500) return null;
    const m = cm / 100;
    const bmi = kg / (m * m);
    return {
      bmi: Math.round(bmi * 10) / 10,
      cat: bmiCategory(bmi),
      healthyFrom: Math.round(18.5 * m * m * 10) / 10,
      healthyTo: Math.round(23.9 * m * m * 10) / 10,
    };
  }, [height, weight]);

  const pct = result
    ? ((Math.min(BMI_MAX, Math.max(BMI_MIN, result.bmi)) - BMI_MIN) / (BMI_MAX - BMI_MIN)) * 100
    : 0;

  return (
    <Card className="tiger-lift">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Ruler className="size-4 text-primary" /> BMI 身体质量指数
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bmi-height">身高 cm</Label>
            <Input id="bmi-height" type="number" min={50} max={250} step={0.5} value={height}
              onChange={(e) => setHeight(e.target.value)} placeholder="170" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bmi-weight">体重 kg</Label>
            <Input id="bmi-weight" type="number" min={10} max={500} step={0.1} value={weight}
              onChange={(e) => setWeight(e.target.value)} placeholder="65" />
          </div>
        </div>

        {!result ? (
          <p className="text-sm text-muted-foreground">请输入有效身高（50-250 cm）和体重（10-500 kg），结果会实时计算。</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xs text-muted-foreground">你的 BMI</div>
                <div className="tiger-gradient-text text-4xl font-bold">{result.bmi.toFixed(1)}</div>
              </div>
              <Badge variant="outline" className={cn("text-sm", result.cat.text)}>{result.cat.label}</Badge>
            </div>

            {/* 横向色带仪表 */}
            <div role="img" aria-label={`BMI ${result.bmi.toFixed(1)}，属于${result.cat.label}范围`} className="space-y-1">
              <div className="relative">
                <div className="flex h-3 overflow-hidden rounded-full">
                  {BMI_SEGMENTS.map((s) => (
                    <div key={s.label} style={{ width: `${((s.to - s.from) / (BMI_MAX - BMI_MIN)) * 100}%`, backgroundColor: s.color, opacity: 0.55 }} />
                  ))}
                </div>
                <div className="absolute -top-1 h-5 w-[3px] -translate-x-1/2 rounded-full bg-foreground shadow transition-[left] duration-300"
                  style={{ left: `${pct}%` }} />
              </div>
              <div className="flex text-[10px] text-muted-foreground">
                {BMI_SEGMENTS.map((s) => (
                  <div key={s.label} className="text-center" style={{ width: `${((s.to - s.from) / (BMI_MAX - BMI_MIN)) * 100}%` }}>
                    {s.label}
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              按中国成人标准：偏瘦 &lt;18.5，正常 18.5-23.9，超重 24-27.9，肥胖 ≥28。
              你的身高对应的健康体重约为 <span className="font-medium text-foreground">{result.healthyFrom}-{result.healthyTo} kg</span>。
              BMI 不区分肌肉与脂肪，力量训练者请结合体脂率判断。
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- 卡路里 / TDEE（Mifflin-St Jeor） ----------

const PAL_OPTIONS = [
  { value: "1.2", label: "久坐（几乎不运动）" },
  { value: "1.375", label: "轻度（每周 1-3 次）" },
  { value: "1.55", label: "中度（每周 3-5 次）" },
  { value: "1.725", label: "高度（每周 6-7 次）" },
  { value: "1.9", label: "极高（体力劳动 / 每日两练）" },
] as const;

function TdeeCard() {
  const [age, setAge] = useState("25");
  const [gender, setGender] = useState("male");
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("65");
  const [pal, setPal] = useState("1.375");

  const result = useMemo(() => {
    const a = Number(age);
    const cm = Number(height);
    const kg = Number(weight);
    const factor = Number(pal);
    if (!age.trim() || !height.trim() || !weight.trim()) return null;
    if (!Number.isFinite(a) || !Number.isFinite(cm) || !Number.isFinite(kg) || !Number.isFinite(factor)) return null;
    if (a < 10 || a > 100 || cm < 100 || cm > 250 || kg < 20 || kg > 400) return null;
    const bmr = 10 * kg + 6.25 * cm - 5 * a + (gender === "male" ? 5 : -161);
    const tdee = bmr * factor;
    const goals = [
      { label: "减脂", kcal: Math.round(tdee - 400), note: "温和缺口约 400 kcal" },
      { label: "维持", kcal: Math.round(tdee), note: "保持当前体重" },
      { label: "增肌", kcal: Math.round(tdee + 300), note: "小幅盈余约 300 kcal" },
    ];
    return { bmr: Math.round(bmr), tdee: Math.round(tdee), goals };
  }, [age, gender, height, weight, pal]);

  return (
    <Card className="tiger-lift">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Flame className="size-4 text-primary" /> 卡路里 / TDEE 计算器
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tdee-age">年龄</Label>
            <Input id="tdee-age" type="number" min={10} max={100} value={age} onChange={(e) => setAge(e.target.value)} placeholder="25" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tdee-gender">性别</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger id="tdee-gender" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">男</SelectItem>
                <SelectItem value="female">女</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tdee-height">身高 cm</Label>
            <Input id="tdee-height" type="number" min={100} max={250} step={0.5} value={height} onChange={(e) => setHeight(e.target.value)} placeholder="170" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tdee-weight">体重 kg</Label>
            <Input id="tdee-weight" type="number" min={20} max={400} step={0.1} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="65" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tdee-pal">活动量</Label>
          <Select value={pal} onValueChange={setPal}>
            <SelectTrigger id="tdee-pal" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label} ×{o.value}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {!result ? (
          <p className="text-sm text-muted-foreground">请输入有效年龄（10-100）、身高（100-250 cm）和体重（20-400 kg），结果会实时计算。</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-1 text-xs text-muted-foreground"><Activity className="size-3.5" /> 基础代谢 BMR</div>
                <div className="mt-1 text-2xl font-bold">{result.bmr}<span className="text-xs font-normal text-muted-foreground"> kcal/天</span></div>
              </div>
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
                <div className="flex items-center gap-1 text-xs text-muted-foreground"><Target className="size-3.5" /> 每日总消耗 TDEE</div>
                <div className="mt-1 text-2xl font-bold text-primary">{result.tdee}<span className="text-xs font-normal text-muted-foreground"> kcal/天</span></div>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-sm font-semibold">目标热量与宏量建议（蛋白 30% / 碳水 40% / 脂肪 30%）</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>目标</TableHead>
                    <TableHead>热量 kcal/天</TableHead>
                    <TableHead>蛋白质 g</TableHead>
                    <TableHead>碳水 g</TableHead>
                    <TableHead>脂肪 g</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.goals.map((g) => (
                    <TableRow key={g.label}>
                      <TableCell className="font-medium">
                        {g.label}
                        <span className="block text-[10px] font-normal text-muted-foreground">{g.note}</span>
                      </TableCell>
                      <TableCell className="font-bold">{g.kcal}</TableCell>
                      <TableCell>{Math.round((g.kcal * 0.3) / 4)}</TableCell>
                      <TableCell>{Math.round((g.kcal * 0.4) / 4)}</TableCell>
                      <TableCell>{Math.round((g.kcal * 0.3) / 9)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {result.goals[0].kcal < result.bmr && (
              <p className="text-xs text-chart-4">提示：当前减脂目标已低于基础代谢，建议缩小缺口或提高活动量，避免过度节食。</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              公式：Mifflin-St Jeor（男 10×kg + 6.25×cm − 5×年龄 + 5；女 −161），TDEE = BMR × 活动系数。数值为估算，请以 2-3 周体重趋势校准。
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Calculators() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Calculator className="size-6 text-primary" /> 健身计算器
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">BMI 与每日热量目标，纯本地计算，输入即出结果</p>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <BmiCard />
        <TdeeCard />
      </div>
    </div>
  );
}