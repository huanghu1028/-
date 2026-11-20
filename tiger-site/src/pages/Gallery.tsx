import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Columns2, ImagePlus, Images, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api, errText, todayStr, ApiError, type GalleryImage } from "@/src/lib/api";
import { cn } from "@/lib/utils";

// 服务端限制（functions/validate.mjs + router.mjs）：
// data_url 必须是 jpeg/png/webp base64 且 ≤600000 字符；说明 ≤120 码点；照片上限 60 张。
const MAX_CHARS = 600000;
const CAPTION_MAX = 120;
const PHOTO_MAX = 60;

// 客户端压缩：最长边 ≤1280，JPEG 编码；超限时先降质量（0.82→0.7→0.55），再降尺寸（1280→1024→800）。
async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    // 用 onload 而非 decode()：decode() 依赖渲染管线，在后台/隐藏页面可能永不 resolve。
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image_load_failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    for (const side of [1280, 1024, 800]) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      ctx.fillStyle = "#ffffff"; // 透明 PNG 转 JPEG 时垫白底，避免发黑
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.7, 0.55]) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length <= MAX_CHARS) return dataUrl;
      }
    }
    throw new Error("too_large");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Gallery() {
  const [images, setImages] = useState<GalleryImage[] | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null);
  const [compare, setCompare] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [delTarget, setDelTarget] = useState<GalleryImage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try { setImages(await api.getGallery()); } catch (e) { toast.error(errText(e)); setImages([]); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // 展示顺序：拍摄日期倒序，同日按上传时间倒序。
  const sorted = useMemo(
    () => [...(images ?? [])].sort((a, b) =>
      b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at)),
    [images],
  );

  const pair = useMemo(() => {
    if (!compare || picked.length !== 2 || !images) return null;
    const two = picked
      .map((id) => images.find((i) => i.id === id))
      .filter((i): i is GalleryImage => Boolean(i));
    if (two.length !== 2) return null;
    two.sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at));
    return two;
  }, [compare, picked, images]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重复选择同一文件
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("请选择图片文件"); return; }
    setProcessing(true);
    try {
      const dataUrl = await compressImage(file);
      setPending(dataUrl);
      setDate(todayStr());
      setCaption("");
      setAddOpen(true);
    } catch (err) {
      toast.error(err instanceof Error && err.message === "too_large"
        ? "图片压缩后仍超过大小限制，请换一张较小的照片"
        : "图片读取失败，请换一张试试");
    } finally {
      setProcessing(false);
    }
  };

  const onSave = async () => {
    if (!pending) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error("日期格式应为 YYYY-MM-DD"); return; }
    const cap = caption.trim();
    if ([...cap].length > CAPTION_MAX) { toast.error(`说明最多 ${CAPTION_MAX} 个字符`); return; }
    setBusy(true);
    try {
      await api.addGallery({ entry_date: date, caption: cap, data_url: pending });
      toast.success("照片已保存");
      setAddOpen(false);
      setPending(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError && e.code === "too_many_items"
        ? `照片最多 ${PHOTO_MAX} 张，请先删除一些`
        : errText(e));
    } finally {
      setBusy(false);
    }
  };

  const exitCompare = () => { setCompare(false); setPicked([]); };

  const toggleCompare = () => {
    if (compare) { exitCompare(); return; }
    if ((images?.length ?? 0) < 2) { toast.error("至少需要两张照片才能对比"); return; }
    setCompare(true);
    setPicked([]);
  };

  const onCardClick = (img: GalleryImage) => {
    if (!compare) { setLightbox(img); return; }
    if (picked.includes(img.id)) { setPicked(picked.filter((id) => id !== img.id)); return; }
    if (picked.length >= 2) { toast.error("最多选择两张，先取消一张再选"); return; }
    setPicked([...picked, img.id]);
  };

  const onConfirmDelete = async () => {
    if (!delTarget) return;
    const t = delTarget;
    setDelTarget(null);
    setBusy(true);
    try {
      await api.deleteGallery(t.id);
      toast.success("已删除");
      setPicked((p) => p.filter((id) => id !== t.id));
      if (lightbox?.id === t.id) setLightbox(null);
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">进度画廊</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            同角度、同光线定期拍照，变化看得见{images ? ` · 共 ${images.length} 张（上限 ${PHOTO_MAX}）` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={toggleCompare} disabled={busy || processing}>
            {compare ? <X className="size-4" /> : <Columns2 className="size-4" />}
            {compare ? "退出对比" : "对比模式"}
          </Button>
          <Button onClick={() => fileRef.current?.click()} disabled={busy || processing}>
            <ImagePlus className="size-4" /> {processing ? "处理中…" : "上传照片"}
          </Button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="选择照片文件"
        onChange={(e) => void onFile(e)} />

      {/* 对比模式提示 */}
      {compare && (
        <Card className="border-primary/50 py-3">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 px-4">
            <p className="text-sm text-muted-foreground">
              对比模式：点选两张照片进行前后对比（已选 {picked.length}/2）
            </p>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={exitCompare}>
              <X className="size-3.5" /> 退出对比
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 前后对比视图 */}
      {pair && (
        <Card>
          <CardHeader><CardTitle className="text-base">前后对比</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {pair.map((img, i) => (
              <div key={img.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={i === 0 ? "secondary" : "default"}>{i === 0 ? "早" : "晚"}</Badge>
                  <span className="text-sm font-medium">{img.entry_date}</span>
                </div>
                <img src={img.data_url} alt={`${i === 0 ? "早" : "晚"}期照片 ${img.entry_date}`}
                  className="max-h-[50vh] w-full rounded-lg bg-muted object-contain" />
                <p className="text-xs text-muted-foreground">{img.caption || "无说明"}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 加载骨架 */}
      {images === null && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
        </div>
      )}

      {/* 空状态 */}
      {images !== null && sorted.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Images className="size-10 text-muted-foreground opacity-50" />
            <div>
              <p className="font-medium">还没有进度照片</p>
              <p className="mt-1 text-sm text-muted-foreground">上传第一张照片，记录你的减脂旅程（自动压缩，仅自己可见）</p>
            </div>
            <Button onClick={() => fileRef.current?.click()} disabled={processing}>
              <ImagePlus className="size-4" /> {processing ? "处理中…" : "上传第一张"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 照片网格 */}
      {sorted.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((img) => (
            <Card key={img.id} role="button" tabIndex={0}
              onClick={() => onCardClick(img)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCardClick(img); } }}
              className={cn("tiger-lift cursor-pointer gap-0 overflow-hidden py-0",
                compare && picked.includes(img.id) && "border-primary ring-2 ring-primary")}>
              <div className="relative aspect-square w-full overflow-hidden bg-muted">
                <img src={img.data_url} alt={img.caption || `进度照片 ${img.entry_date}`}
                  className="size-full object-cover" loading="lazy" />
                <Badge variant="secondary" className="absolute left-2 top-2 bg-background/80 text-foreground backdrop-blur">
                  {img.entry_date}
                </Badge>
                {compare && picked.includes(img.id) && (
                  <Badge className="absolute right-2 top-2">已选</Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{img.caption || "无说明"}</span>
                <Button variant="ghost" size="icon" className="size-6 shrink-0 text-destructive" aria-label="删除照片"
                  onClick={(e) => { e.stopPropagation(); setDelTarget(img); }}>
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 上传保存对话框 */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) { setAddOpen(false); setPending(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>保存进度照片</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {pending && (
              <div className="space-y-1">
                <img src={pending} alt="待保存照片预览" className="max-h-64 w-full rounded-lg bg-muted object-contain" />
                <p className="text-[11px] text-muted-foreground">已自动压缩，约 {Math.round((pending.length * 3) / 4 / 1024)} KB</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>拍摄日期</Label>
              <Input type="date" value={date} min="2000-01-01" max="2100-12-31" onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>说明（可选）</Label>
              <Input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={CAPTION_MAX}
                placeholder="例如：第 4 周晨起正面照" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); setPending(null); }}>取消</Button>
            <Button onClick={() => void onSave()} disabled={busy || !pending}>{busy ? "保存中…" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 灯箱 */}
      <Dialog open={lightbox !== null} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{lightbox?.entry_date} 的照片</DialogTitle>
          </DialogHeader>
          {lightbox && (
            <div className="space-y-2">
              <img src={lightbox.data_url} alt={lightbox.caption || `进度照片 ${lightbox.entry_date}`}
                className="max-h-[70vh] w-full rounded-lg bg-muted object-contain" />
              <p className="text-sm text-muted-foreground">{lightbox.caption || "无说明"}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={delTarget !== null} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {delTarget?.entry_date} 的这张照片，此操作无法恢复。
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