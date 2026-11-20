// 拍照识餐对话框：选图 → 浏览器本地 WASM 推理 → top-5 选择 → 按克数换算营养并录入。
// 可复用组件：由 Diet 等页面通过 open / onOpenChange / onPick 接入。
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertCircle, Camera, Check, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { recognizeFood, type FoodPrediction, type ModelProgress } from "@/src/lib/foodAi";

/** 确认录入时回传给页面的事件（与饮食记录字段对齐）。 */
export type FoodPickEvent = {
  food_name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
};

type Phase = "idle" | "download" | "infer" | "done" | "error";

const EMPTY_PROGRESS: ModelProgress = { loaded: 0, total: 0, percent: 0 };
const r1 = (n: number) => Math.round(n * 10) / 10;
// 小概率保留更多小数位，避免非零概率被显示成 0.0%。
const probLabel = (prob: number) => {
  const pct = prob * 100;
  if (pct >= 0.1) return `${pct.toFixed(1)}%`;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(3)}%`;
};

export default function FoodPhotoScanner({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (event: FoodPickEvent) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<ModelProgress>(EMPTY_PROGRESS);
  const [results, setResults] = useState<FoodPrediction[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [grams, setGrams] = useState("");
  const [error, setError] = useState("");
  // 取消令牌：重置 / 关闭 / 换图 / 重新识别时自增，过期的异步回调不再写入状态。
  const runIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "download" || phase === "infer";

  const reset = useCallback(() => {
    runIdRef.current += 1;
    // 原生 file input 不受 React 状态控制，需手动清空（关闭动画未结束即重开时尤其必要）。
    if (fileInputRef.current) fileInputRef.current.value = "";
    setPhase("idle");
    setFile(null);
    setResults([]);
    setSelected(null);
    setGrams("");
    setError("");
    setProgress(EMPTY_PROGRESS);
    setPreview(null);
  }, []);

  // 关闭即重置；预览 URL 变化 / 卸载时释放。
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const run = useCallback(async (target: File) => {
    const id = ++runIdRef.current;
    setPhase("download");
    setError("");
    setResults([]);
    setSelected(null);
    setProgress(EMPTY_PROGRESS);
    try {
      const preds = await recognizeFood(target, (p) => {
        if (runIdRef.current !== id) return;
        setProgress(p);
        if (p.percent >= 100) setPhase("infer");
      });
      if (runIdRef.current !== id) return;
      setResults(preds);
      setSelected(0);
      setGrams(String(preds[0]?.food.serving ?? 100));
      setPhase("done");
    } catch (e) {
      if (runIdRef.current !== id) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    runIdRef.current += 1;
    if (!f.type.startsWith("image/")) {
      setError("请选择图片文件（JPG / PNG 等）");
      setPhase("error");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResults([]);
    setSelected(null);
    setGrams("");
    setError("");
    setProgress(EMPTY_PROGRESS);
    setPhase("idle");
  };

  const start = () => {
    if (!file || busy) return;
    void run(file);
  };

  const select = (i: number) => {
    setSelected(i);
    setGrams(String(results[i]?.food.serving ?? 100));
  };

  const activeFood = selected != null ? results[selected]?.food : undefined;
  const g = Number(grams);
  const gramsValid = !!activeFood && Number.isFinite(g) && g > 0 && g <= 5000;
  const k = gramsValid ? g / 100 : 0;
  const totals = activeFood
    ? {
        kcal: Math.round(activeFood.energy * k),
        protein: r1(activeFood.protein * k),
        fat: r1(activeFood.fat * k),
        carb: r1(activeFood.carbs * k),
      }
    : null;

  const confirm = () => {
    if (!activeFood || !gramsValid || !totals) return;
    onPick({
      food_name: activeFood.zh,
      grams: g,
      kcal: totals.kcal,
      protein: totals.protein,
      fat: totals.fat,
      carb: totals.carb,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-lg" data-phase={phase}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="size-5 text-primary" />
            拍照识餐
          </DialogTitle>
          <DialogDescription>
            上传食物照片，浏览器本地识别菜品并估算营养，照片不会上传服务器。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="food-photo">食物照片</Label>
          <Input
            id="food-photo"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={onFileChange}
            className="cursor-pointer file:cursor-pointer"
          />
          {preview && (
            <img
              src={preview}
              alt="食物照片预览"
              className="max-h-44 w-full rounded-md border border-border object-contain"
            />
          )}
        </div>

        {(phase === "idle" || phase === "error") && (
          <Button onClick={start} disabled={!file || busy} className="w-full">
            <Camera />
            识别
          </Button>
        )}

        {phase === "download" && (
          <div className="space-y-2 rounded-md border border-border px-3 py-3">
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin text-primary" />
              {progress.total > 0 ? `下载模型 ${progress.percent}%` : "正在准备识别引擎…"}
            </p>
            {progress.total > 0 && <Progress value={progress.percent} />}
            <p className="text-xs text-muted-foreground">
              模型约 34MB，仅首次需要下载，之后浏览器会缓存。
            </p>
          </div>
        )}

        {phase === "infer" && (
          <p className="flex items-center gap-2 rounded-md border border-border px-3 py-3 text-sm">
            <Loader2 className="size-4 animate-spin text-primary" />
            识别中…
          </p>
        )}

        {phase === "error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-2">
              <p>{error}</p>
              {file && (
                <Button size="sm" variant="outline" onClick={start}>
                  <RotateCcw />
                  重试
                </Button>
              )}
            </div>
          </div>
        )}

        {phase === "done" && results.length > 0 && (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            <p className="text-xs text-muted-foreground">
              识别结果（点击选择菜品，按克数换算营养）
            </p>
            {results.map((r, i) => {
              const active = selected === i;
              return (
                <div
                  key={r.key}
                  className={cn(
                    "rounded-md border transition-colors",
                    active ? "border-primary bg-primary/10" : "border-border"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => select(i)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{r.food.zh}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{r.food.en}</span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-primary">
                      {probLabel(r.prob)}
                    </span>
                  </button>
                  {active && totals && (
                    <div className="space-y-2 border-t border-border/60 px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        每100g：{r.food.energy} kcal · 蛋白质 {r.food.protein}g · 脂肪 {r.food.fat}g · 碳水{" "}
                        {r.food.carbs}g
                      </p>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="food-grams" className="shrink-0 text-xs">
                          克数
                        </Label>
                        <Input
                          id="food-grams"
                          type="number"
                          min={1}
                          max={5000}
                          step={1}
                          value={grams}
                          onChange={(e) => setGrams(e.target.value)}
                          className="h-8 w-28"
                        />
                        <span className="text-xs text-muted-foreground">
                          默认 {r.food.serving}g
                        </span>
                      </div>
                      <p className="text-sm">
                        合计：<span className="font-semibold text-primary">{totals.kcal} kcal</span> · 蛋白质{" "}
                        {totals.protein}g · 脂肪 {totals.fat}g · 碳水 {totals.carb}g
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={reset} disabled={busy}>
            <RotateCcw />
            重新选择
          </Button>
          <Button onClick={confirm} disabled={!gramsValid || busy}>
            <Check />
            确认录入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { FoodPhotoScanner };