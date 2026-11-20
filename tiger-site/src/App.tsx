import { useEffect } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, RequireAuth } from "@/src/lib/auth";
import Layout from "@/src/components/Layout";
import Dashboard from "@/src/pages/Dashboard";
import Exercises from "@/src/pages/Exercises";
import ExerciseDetail from "@/src/pages/ExerciseDetail";
import Plans from "@/src/pages/Plans";
import Train from "@/src/pages/Train";
import Weight from "@/src/pages/Weight";
import Diet from "@/src/pages/Diet";
import Coach from "@/src/pages/Coach";
import Login from "@/src/pages/Login";
import Register from "@/src/pages/Register";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-lg font-semibold">页面不存在</p>
      <p className="mt-1 text-sm text-muted-foreground">你访问的地址走丢了</p>
      <Button variant="outline" className="mt-4" asChild><Link to="/">回到总览</Link></Button>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="exercises" element={<Exercises />} />
            <Route path="exercises/:id" element={<ExerciseDetail />} />
            <Route path="plans" element={<RequireAuth><Plans /></RequireAuth>} />
            <Route path="train" element={<RequireAuth><Train /></RequireAuth>} />
            <Route path="weight" element={<RequireAuth><Weight /></RequireAuth>} />
            <Route path="diet" element={<RequireAuth><Diet /></RequireAuth>} />
            <Route path="coach" element={<RequireAuth><Coach /></RequireAuth>} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}