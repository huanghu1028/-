import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/src/lib/auth";
import { errText } from "@/src/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!loading && user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
      toast.success("欢迎回来！");
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
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
          <CardTitle className="text-xl">登录 tiger-减脂</CardTitle>
          <CardDescription>训练、体重、饮食记录云端同步，多设备随时继续</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">用户名</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" placeholder="3-32 位小写字母 / 数字" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">口令</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" placeholder="至少 15 个字符" required />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "登录中…" : "登录"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            还没有账号？{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">立即注册</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}