import { Suspense, useEffect } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, RequireAuth, useAuth } from "@/src/lib/auth";
import Layout from "@/src/components/Layout";
import Landing from "@/src/pages/Landing";
import Login from "@/src/pages/Login";
import Register from "@/src/pages/Register";
// 登录后的功能页按需拆包：首屏只解析外壳与落地页，图表等重依赖留到各自 chunk。
import {
  CalendarView, Coach, Calculators, Dashboard, Diet, ExerciseAnalytics, ExerciseDetail,
  Exercises, Foods, Gallery, Measurements, NutritionPlans, Plans, Settings, Templates, Train, Weight,
} from "@/src/lib/pages";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";

// 切页时的骨架屏兜底：chunk 到达前保持外壳不闪、滚动位置不乱。
function PageFallback() {
  return (
    <div className="space-y-4 py-6" aria-busy="true" aria-live="polite">
      <div className="h-7 w-40 animate-pulse rounded-lg bg-card" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-card" />)}
      </div>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// 首页分流：未登录看公开落地页（自带页头页脚，不套应用外壳），已登录进总览。
function HomeGate() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">正在加载…</div>;
  }
  return user ? <Navigate to="/dashboard" replace /> : <Landing />;
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-lg font-semibold">页面不存在</p>
      <p className="mt-1 text-sm text-muted-foreground">你访问的地址走丢了</p>
      <Button variant="outline" className="mt-4" asChild><Link to="/">回到首页</Link></Button>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route index element={<HomeGate />} />
            <Route element={<Layout />}>
              <Route path="dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
              <Route path="exercises" element={<Exercises />} />
              <Route path="exercises/:id" element={<ExerciseDetail />} />
              <Route path="exercises/:id/analytics" element={<RequireAuth><ExerciseAnalytics /></RequireAuth>} />
              <Route path="plans" element={<RequireAuth><Plans /></RequireAuth>} />
              <Route path="train" element={<RequireAuth><Train /></RequireAuth>} />
              <Route path="calendar" element={<RequireAuth><CalendarView /></RequireAuth>} />
              <Route path="weight" element={<RequireAuth><Weight /></RequireAuth>} />
              <Route path="measurements" element={<RequireAuth><Measurements /></RequireAuth>} />
              <Route path="gallery" element={<RequireAuth><Gallery /></RequireAuth>} />
              <Route path="diet" element={<RequireAuth><Diet /></RequireAuth>} />
              <Route path="nutrition" element={<RequireAuth><NutritionPlans /></RequireAuth>} />
              <Route path="templates" element={<RequireAuth><Templates /></RequireAuth>} />
              <Route path="foods" element={<Foods />} />
              <Route path="calculators" element={<Calculators />} />
              <Route path="coach" element={<RequireAuth><Coach /></RequireAuth>} />
              <Route path="settings" element={<RequireAuth><Settings /></RequireAuth>} />
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}
