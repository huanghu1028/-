// 全局深空背景：星云(Granim) + 火星(particles.js) + 星空(NightSky) 三层 canvas，
// 极光带与老虎水印由 globals.css 提供。另含「回到顶部」按钮。
// 移植自原站 tiger-fx.js / tiger-ui.js，遵循 prefers-reduced-motion 与降分辨率性能策略。
import { createElement, useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { loadScript, prefersReducedMotion } from "@/src/lib/loadScript";

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

export default function Background() {
  const reduce = prefersReducedMotion();
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let granim: { pause?: () => void } | null = null;
    let removeResize: (() => void) | undefined;

    (async () => {
      // 星空 web component：始终加载（减弱动效时速度为 0，呈静态星空）
      try { await loadScript("/vendor/night-sky.bundle.min.js"); } catch { /* 离线/失败时降级为纯 CSS 背景 */ }
      if (cancelled || reduce) return;
      try {
        await loadScript("/vendor/granim/granim.min.js");
        await loadScript("/vendor/particles/particles.min.js");
      } catch { return; }
      if (cancelled) return;

      const w = window as unknown as { Granim?: new (o: unknown) => { pause?: () => void }; particlesJS?: (id: string, c: unknown) => void };
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
        density: "30",
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