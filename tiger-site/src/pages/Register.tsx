import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/src/lib/auth";
import { errText } from "@/src/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export default function Register() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!loading && user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const name = username.trim().toLowerCase();
    if (!USERNAME_RE.test(name)) {
      setError("用户名需 3-32 位小写字母、数字、下划线或连字符，且以字母或数字开头");
      return;
    }
    if ([...password].length < 15) {
      setError("口令至少 15 个字符，建议用一句好记的短语，例如「老虎每天练三组」加数字");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的口令不一致");
      return;
    }
    setBusy(true);
    try {
      await register(name, password);
      toast.success("注册成功，已自动登录");
      navigate("/", { replace: true });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
      <Card>
        <CardHeader className="text-center">
          <img src="/img/brand/tiger-face.svg" alt="" className="mx-auto mb-2 size-14 rounded-2xl" />
          <CardTitle className="text-xl">创建账号</CardTitle>
          <CardDescription>一个账号，管理你的训练计划、打卡、体重与饮食</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">用户名</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" placeholder="例如 tiger_2026" required />
              <p className="text-xs text-muted-foreground">3-32 位小写字母、数字、下划线或连字符</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">口令</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" placeholder="至少 15 个字符" required />
              <p className="text-xs text-muted-foreground">长口令更安全：一句短语 + 数字就很好记</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">确认口令</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" placeholder="再输入一次" required />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "注册中…" : "注册并开始"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            已有账号？{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">直接登录</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}