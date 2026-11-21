// 全局深空背景：星云(Granim) + 火星(particles.js) + 星空(NightSky) 三层 canvas，
// 极光带与老虎水印由 globals.css 提供。另含「回到顶部」按钮。
// 移植自原站 tiger-fx.js / tiger-ui.js，遵循 prefers-reduced-motion 与降分辨率性能策略。
// 性能：滚动中与标签页隐藏时暂停三层动画（canvas 保留最后一帧，视觉无跳变），停手后立即恢复。
import { createElement, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { loadScript, prefersReducedMotion } from "@/src/lib/loadScript";

type GranimLike = { pause?: () => void; play?: () => void };
type PjsLike = {
  particles: { move: { enable: boolean } };
  fn: { particlesDraw?: () => void; vendors?: { checkBeforeDraw?: () => void } };
};

const EMBERS_CONFIG = {
  particles: {
    number: { value: 40, density: { enable: true, value_area: 900 } },
    color: { value: ["#ff9f43", "#ffc46b", "#ffffff"] },
    shape: { type: "circle" },
    opacity: { value: 0.55, random: true, anim: { enable: true, speed: 0.6, opacity_min: 0.18, sync: false } },
    size: { value: 2.6, random: true },
    line_linked: { enable: false },
    move: { enable: true, speed: 0.7, direction: "none", random: true, straight: false, out_mode: "out" },
  },
  interactivity: {
    detect_on: "window",
    events: { onhover: { enable: true, mode: "repulse" }, onclick: { enable: false }, resize: true },
    modes: { repulse: { distance: 70, duration: 0.4 } },
  },
  retina_detect: false,
};

/** 取回当前所有 particles.js 实例（2.0.0 直接存实例；老版本存 {pJS} 包装，两种都兼容）。 */
function pjsInstances(): PjsLike[] {
  const doms = (window as unknown as { pJSDom?: unknown[] }).pJSDom;
  if (!Array.isArray(doms)) return [];
  return doms.map((d) => ((d as { pJS?: PjsLike })?.pJS ?? (d as PjsLike))).filter(Boolean);
}

export default function Background() {
  const reduce = prefersReducedMotion();
  const [showTop, setShowTop] = useState(false);
  // 动画控制器：脚本加载完成后写入，供滚动/可见性监听调用。
  const ctl = useRef<{ pause: () => void; resume: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let granim: GranimLike | null = null;
    let removeResize: (() => void) | undefined;

    ctl.current = {
      pause: () => {
        try { granim?.pause?.(); } catch { /* ignore */ }
        for (const p of pjsInstances()) {
          try {
            p.particles.move.enable = false;
            p.fn.particlesDraw?.(); // 画最后一帧；move.enable=false 时库内部会自行取消 rAF
          } catch { /* ignore */ }
        }
      },
      resume: () => {
        try { granim?.play?.(); } catch { /* ignore */ }
        for (const p of pjsInstances()) {
          try {
            if (p.particles.move.enable) continue;
            p.particles.move.enable = true;
            p.fn.vendors?.checkBeforeDraw?.();
          } catch { /* ignore */ }
        }
      },
    };

    (async () => {
      // 星空 web component：始终加载（减弱动效时速度为 0，呈静态星空）
      try { await loadScript("/vendor/night-sky.bundle.min.js"); } catch { /* 离线/失败时降级为纯 CSS 背景 */ }
      if (cancelled || reduce) return;
      try {
        await loadScript("/vendor/granim/granim.min.js");
        await loadScript("/vendor/particles/particles.min.js");
      } catch { return; }
      if (cancelled) return;

      const w = window as unknown as { Granim?: new (o: unknown) => GranimLike; particlesJS?: (id: string, c: unknown) => void };
      const nebula = document.getElementById("tigerNebula") as HTMLCanvasElement | null;
      if (nebula && w.Granim) {
        granim = new w.Granim({
          element: "#tigerNebula",
          direction: "radial",
          isPausedWhenNotInView: true,
          states: { "default-state": { gradients: [["#2b1600", "#000000"], ["#001c28", "#000000"], ["#241019", "#000000"]], transitionSpeed: 7000, loop: true } },
        });
        // 性能：渐变平滑，按 1/3 分辨率绘制再由 CSS 放大（原站 165fps 修复）
        const scale = () => {
          nebula.width = Math.max(2, Math.round(nebula.clientWidth / 3));
          nebula.height = Math.max(2, Math.round(nebula.clientHeight / 3));
        };
        scale();
        window.addEventListener("resize", scale);
        removeResize = () => window.removeEventListener("resize", scale);
      }
      if (document.getElementById("tigerEmbers") && w.particlesJS) {
        w.particlesJS("tigerEmbers", EMBERS_CONFIG);
      }
    })();

    return () => {
      cancelled = true;
      removeResize?.();
      try { granim?.pause?.(); } catch { /* ignore */ }
      ctl.current = null;
    };
  }, [reduce]);

  // 滚动 / 标签页隐藏时暂停背景动画，停手 260ms 后恢复。
  useEffect(() => {
    if (reduce) return;
    let paused = false;
    let timer = 0;
    const setPaused = (v: boolean) => {
      if (v === paused) return;
      paused = v;
      if (v) ctl.current?.pause();
      else ctl.current?.resume();
    };
    const onScroll = () => {
      setPaused(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPaused(false), 260);
    };
    const onVisibility = () => setPaused(document.visibilityState !== "visible");
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(timer);
      setPaused(false);
    };
  }, [reduce]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; setShowTop(window.scrollY > 400); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  return (
    <>
      <canvas id="tigerNebula" className="tiger-nebula" aria-hidden="true" />
      <div id="tigerEmbers" className="tiger-embers" aria-hidden="true" />
      {createElement("night-sky", {
        id: "tigerNightSky",
        layers: "3",
        // 星星是用超大 box-shadow 画的，数量直接决定光栅化成本：30 → 18 观感几乎不变、开销减半。
        density: "18",
        "velocity-x": reduce ? "0" : "45",
        "velocity-y": reduce ? "0" : "30",
        "star-shape": "circle",
        "star-color": "#ffffff",
        "background-color": "transparent",
        "aria-hidden": "true",
      })}
      <button
        type="button"
        className={"tiger-back-top" + (showTop ? " is-visible" : "")}
        onClick={() => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })}
        aria-label="回到顶部"
        title="回到顶部"
      >
        <ArrowUp className="size-5" />
      </button>
    </>
  );
}