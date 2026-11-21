// 应用外壳：桌面左侧分组导航 + 移动端底部横滑标签栏；老虎品牌 + 深色主题。
// 功能页已按路由拆包，这里负责两件事：chunk 到达前显示骨架（外壳不闪），
// 以及鼠标悬停/键盘聚焦导航项时预热对应页面，点击时基本瞬时打开。
import { useEffect, Suspense, type FocusEvent, type PointerEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Dumbbell, LayoutDashboard, CalendarCheck, CalendarDays, ClipboardList, LayoutTemplate, Scale, Ruler, Images, UtensilsCrossed, Salad, Apple, Calculator, Bot, Settings2, LogOut, LogIn, UserPlus,
} from "lucide-react";
import { useAuth } from "@/src/lib/auth";
import { prefetchRoute } from "@/src/lib/pages";
import { Button } from "@/components/ui/button";
import Background from "@/src/components/Background";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { errText } from "@/src/lib/api";

const WARM = {
  onPointerEnter: (e: React.PointerEvent<HTMLElement>) => prefetchRoute(e.currentTarget.getAttribute("href") || ""),
  onFocus: (e: React.FocusEvent<HTMLElement>) => prefetchRoute(e.currentTarget.getAttribute("href") || ""),
};

// 切页骨架：与页面节奏一致，避免内容跳变（CLS）。
function PageSkeleton() {
  return (
    <div className="space-y-4 py-4" aria-busy="true" aria-live="polite">
      <div className="h-7 w-40 animate-pulse rounded-lg bg-card" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-card" />)}
      </div>
    </div>
  );
}

const NAV_GROUPS = [
  {
    title: "训练",
    items: [
      { to: "/dashboard", label: "总览", icon: LayoutDashboard, end: true },
      { to: "/exercises", label: "动作库", icon: Dumbbell },
      { to: "/plans", label: "计划", icon: ClipboardList },
      { to: "/templates", label: "模板", icon: LayoutTemplate },
      { to: "/train", label: "打卡", icon: CalendarCheck },
      { to: "/calendar", label: "日历", icon: CalendarDays },
    ],
  },
  {
    title: "饮食与身体",
    items: [
      { to: "/diet", label: "饮食", icon: UtensilsCrossed },
      { to: "/nutrition", label: "营养计划", icon: Salad },
      { to: "/foods", label: "食物库", icon: Apple },
      { to: "/weight", label: "体重", icon: Scale },
      { to: "/measurements", label: "围度", icon: Ruler },
      { to: "/gallery", label: "画廊", icon: Images },
    ],
  },
  {
    title: "工具",
    items: [
      { to: "/calculators", label: "计算器", icon: Calculator },
      { to: "/coach", label: "虎教练", icon: Bot },
      { to: "/settings", label: "设置", icon: Settings2 },
    ],
  },
];
const NAV_FLAT = NAV_GROUPS.flatMap((g) => g.items);

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
  const { pathname } = useLocation();

  // 登录/注册后是程序化跳转，没有悬停可以预热：一进这两个页面就先把总览 chunk 拉好。
  useEffect(() => {
    if (pathname === "/login" || pathname === "/register") prefetchRoute("/dashboard");
  }, [pathname]);

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
      <Background />
      {/* 桌面侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-sidebar/80 backdrop-blur-md md:flex">
        <div className="px-4 py-5"><Brand /></div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{group.title}</div>
              <div className="space-y-1">
                {group.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    {...WARM}
                    className={({ isActive }) => cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive ? "tiger-nav-active bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4.5" /> {label}
                  </NavLink>
                ))}
              </div>
            </div>
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
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* 移动端底部标签（横向滑动查看全部功能） */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-border bg-background/92 backdrop-blur-md [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
        {NAV_FLAT.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            {...WARM}
            className={({ isActive }) => cn(
              "flex shrink-0 flex-col items-center gap-0.5 px-3.5 py-2 text-[10px]",
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