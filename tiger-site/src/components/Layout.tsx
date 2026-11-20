// 应用外壳：桌面左侧导航 + 移动端底部标签栏；老虎品牌 + 深色主题。
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Dumbbell, LayoutDashboard, CalendarCheck, ClipboardList, Scale, UtensilsCrossed, Bot, LogOut, LogIn, UserPlus,
} from "lucide-react";
import { useAuth } from "@/src/lib/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { errText } from "@/src/lib/api";

const NAV = [
  { to: "/", label: "总览", icon: LayoutDashboard, end: true },
  { to: "/exercises", label: "动作库", icon: Dumbbell },
  { to: "/plans", label: "计划", icon: ClipboardList },
  { to: "/train", label: "打卡", icon: CalendarCheck },
  { to: "/weight", label: "体重", icon: Scale },
  { to: "/diet", label: "饮食", icon: UtensilsCrossed },
  { to: "/coach", label: "虎教练", icon: Bot },
];

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 px-1">
      <img src="/img/brand/tiger-face.svg" alt="tiger-减脂" className="size-9 rounded-xl" />
      <div className="leading-tight">
        <div className="text-base font-bold tracking-wide">tiger-减脂</div>
        <div className="text-[11px] text-muted-foreground">科学健身管理平台</div>
      </div>
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    try {
      await logout();
      toast.success("已退出登录");
      navigate("/login");
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="min-h-dvh">
      {/* 桌面侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-sidebar/80 backdrop-blur-md md:flex">
        <div className="px-4 py-5"><Brand /></div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4.5" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          {user ? (
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{user.username}</div>
                <div className="text-[11px] text-muted-foreground">云端同步已开启</div>
              </div>
              <Button variant="ghost" size="icon" onClick={onLogout} aria-label="退出登录" title="退出登录">
                <LogOut className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate("/login")}>
                <LogIn className="size-4" /> 登录
              </Button>
              <Button size="sm" className="flex-1" onClick={() => navigate("/register")}>
                <UserPlus className="size-4" /> 注册
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* 移动端顶栏 */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/85 px-4 py-3 backdrop-blur-md md:hidden">
        <Brand />
        {user ? (
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground">
            <LogOut className="size-4" /> 退出
          </Button>
        ) : (
          <Button size="sm" onClick={() => navigate("/login")}>登录</Button>
        )}
      </header>

      {/* 主内容 */}
      <main className="px-4 pb-24 pt-5 md:ml-60 md:px-8 md:pb-10 md:pt-7">
        <div className="mx-auto w-full max-w-6xl tiger-rise">
          <Outlet />
        </div>
      </main>

      {/* 移动端底部标签 */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-border bg-background/92 backdrop-blur-md md:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn(
              "flex flex-col items-center gap-0.5 py-2 text-[10px]",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" /> {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}