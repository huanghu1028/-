import { useEffect, useRef, useState } from "react";
import { Bot, KeyRound, Send, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { api, errText, ApiError, type ChatMessage } from "@/src/lib/api";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "帮我安排一周的减脂训练",
  "今天练什么比较好？",
  "减脂期晚餐应该怎么吃？",
  "体重两周没变了，怎么突破平台期？",
];

const KEY_STORAGE = "tiger_deepseek_key";
const KEY_RE = /^sk-[A-Za-z0-9_-]+$/;

export default function Coach() {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [apiKey, setApiKey] = useState<string>(() => {
    try { return localStorage.getItem(KEY_STORAGE) ?? ""; } catch { return ""; }
  });
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try { setMessages(await api.getChat()); } catch (e) { toast.error(errText(e)); setMessages([]); }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  const openKeyDialog = () => { setKeyDraft(apiKey); setKeyOpen(true); };
  const saveKey = () => {
    const k = keyDraft.trim();
    if (k && (k.length > 128 || !KEY_RE.test(k))) { toast.error("密钥格式不对：DeepSeek 密钥以 sk- 开头"); return; }
    try {
      if (k) localStorage.setItem(KEY_STORAGE, k); else localStorage.removeItem(KEY_STORAGE);
    } catch { /* 隐私模式等无法写入时仅存于内存 */ }
    setApiKey(k); setKeyOpen(false);
    toast.success(k ? "密钥已保存到本浏览器" : "密钥已清除");
  };
  const clearKey = () => {
    try { localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
    setApiKey(""); setKeyDraft(""); setKeyOpen(false);
    toast.success("密钥已清除");
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    if (message.length > 2000) { toast.error("消息最长 2000 字"); return; }
    if (!apiKey) { toast.error("请先填入你自己的 DeepSeek 密钥"); openKeyDialog(); return; }
    setBusy(true);
    setInput("");
    const temp: ChatMessage = { id: `temp-${Date.now()}`, role: "user", content: message, created_at: new Date().toISOString() };
    setMessages((m) => [...(m ?? []), temp]);
    try {
      const { reply, saved } = await api.sendChat(message, apiKey);
      setMessages((m) => [...(m ?? []), { id: `reply-${Date.now()}`, role: "assistant", content: reply, created_at: new Date().toISOString() }]);
      if (!saved) toast.warning("回复已生成，但历史保存失败，刷新后可能丢失");
      void refresh();
    } catch (e) {
      setMessages((m) => (m ?? []).filter((x) => x.id !== temp.id));
      setInput(message);
      toast.error(errText(e));
      if (e instanceof ApiError && (e.code === "coach_key_required" || e.code === "invalid_coach_key")) openKeyDialog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-11rem)] flex-col md:h-[calc(100dvh-7rem)]">
      <div className="flex items-center justify-between gap-3 pb-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <img src="/img/brand/tiger-face.svg" alt="" className="size-8 rounded-lg" /> 虎教练
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">AI 健身助手 · 用你自己的 DeepSeek 密钥 · 结合你的资料与记录给出建议</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openKeyDialog}>
            <KeyRound className="size-4" /> 密钥
            <span className={cn("ml-0.5 size-1.5 rounded-full", apiKey ? "bg-emerald-500" : "bg-muted-foreground/40")} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setClearOpen(true)} disabled={!messages?.length}>
            <Trash2 className="size-4" /> 清空对话
          </Button>
        </div>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col py-0">
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
          {!messages && <div className="flex h-full items-center justify-center"><Spinner className="size-6" /></div>}
          {messages && messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <img src="/img/brand/tiger-cartoon.svg" alt="" className="w-28 opacity-90" />
              <div>
                <p className="font-semibold">你好，我是虎教练</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  训练安排、动作要点、饮食营养、平台期突破，都可以问我。完善个人资料后，建议会更贴合你。
                </p>
              </div>
              <div className="flex max-w-md flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="outline" size="sm" className="h-auto rounded-full px-3 py-1.5 text-xs" onClick={() => void send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
              {!apiKey && (
                <button onClick={openKeyDialog} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                  使用 AI 教练需先填入你自己的 DeepSeek 密钥 →
                </button>
              )}
            </div>
          )}
          <div className="space-y-3">
            {messages?.map((m) => (
              <div key={m.id} className={cn("flex gap-2.5", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" && (
                  <img src="/img/brand/tiger-face.svg" alt="虎教练" className="mt-0.5 size-7 shrink-0 rounded-lg" />
                )}
                <div className={cn(
                  "max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}>
                  {m.content}
                </div>
                {m.role === "user" && (
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
                    <User className="size-4" />
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2.5">
                <img src="/img/brand/tiger-face.svg" alt="" className="size-7 rounded-lg" />
                <div className="flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                  <Spinner className="size-4" /> 虎教练思考中…
                </div>
              </div>
            )}
          </div>
          <div ref={bottomRef} />
        </CardContent>
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="问问训练、饮食、恢复…（Enter 发送，Shift+Enter 换行）"
              className="max-h-32 min-h-10 flex-1 resize-none"
            />
            <Button size="icon" onClick={() => void send(input)} disabled={busy || !input.trim()} aria-label="发送">
              <Send className="size-4" />
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Bot className="size-3" /> AI 建议仅供参考，不构成医疗意见；伤病或不适请先咨询医生。
          </p>
        </div>
      </Card>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>清空全部对话？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">云端保存的聊天记录将被删除，无法恢复。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={async () => {
              try { await api.clearChat(); setMessages([]); setClearOpen(false); toast.success("对话已清空"); }
              catch (e) { toast.error(errText(e)); }
            }}>清空</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>DeepSeek API 密钥</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              虎教练用你自己的 DeepSeek 密钥调用 AI，费用由你的 DeepSeek 账户承担。还没有密钥可去
              <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" className="mx-1 underline underline-offset-2">platform.deepseek.com</a>
              创建。
            </p>
            <Input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              密钥只保存在你自己的浏览器本地，不会上传到本站数据库；对话时临时发送给本站接口、转发给 DeepSeek，本站不存储也不记录你的密钥。请勿在公用电脑上保存。
            </p>
          </div>
          <DialogFooter className="gap-2">
            {apiKey && <Button variant="outline" onClick={clearKey}>清除已存密钥</Button>}
            <Button variant="outline" onClick={() => setKeyOpen(false)}>取消</Button>
            <Button onClick={saveKey}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}