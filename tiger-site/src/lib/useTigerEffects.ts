// 落地页视觉特效 hook：移植自原站 tiger-fx.js。
// 加载 vendored MIT 库并初始化 AOS 滚动揭示 / countUp 数字滚动 / vanilla-tilt 3D /
// typewriter 打字机 / rellax 视差 / Waves 涟漪。全部 feature-detected，减弱动效时跳过。
import { useEffect } from "react";
import { loadScript, prefersReducedMotion } from "./loadScript";

export function useTigerEffects(active = true): void {
  useEffect(() => {
    if (!active) return;
    const reduce = prefersReducedMotion();
    const pointerOnly = !("ontouchstart" in window);
    let cancelled = false;
    let tw: { stop?: () => void } | null = null;

    (async () => {
      try {
        await Promise.all([
          loadScript("/vendor/aos/aos.js"),
          loadScript("/vendor/countup/countUp.umd.js"),
          loadScript("/vendor/vanilla-tilt/vanilla-tilt.min.js"),
          loadScript("/vendor/typewriter/typewriter.umd.js"),
          loadScript("/vendor/rellax/rellax.min.js"),
          loadScript("/vendor/waves/waves.min.js"),
        ]);
      } catch { return; }
      if (cancelled) return;
      const w = window as unknown as Record<string, any>;

      if (w.AOS && document.querySelector("[data-aos]")) {
        w.AOS.init({ once: true, duration: 650, easing: "ease-out-cubic", offset: 60, disable: reduce });
      }

      const nums = Array.from(document.querySelectorAll<HTMLElement>("[data-countup]"));
      if (nums.length && w.countUp?.CountUp) {
        const start = (el: HTMLElement) => {
          const target = parseFloat(el.getAttribute("data-countup") || "0") || 0;
          const c = new w.countUp.CountUp(el, target, { duration: 2, separator: "," });
          if (!c.error) c.start();
        };
        if ("IntersectionObserver" in window && !reduce) {
          const ob = new IntersectionObserver((entries) => {
            entries.forEach((e) => { if (e.isIntersecting) { start(e.target as HTMLElement); ob.unobserve(e.target); } });
          }, { threshold: 0.4 });
          nums.forEach((el) => ob.observe(el));
        } else { nums.forEach(start); }
      }

      const tilts = document.querySelectorAll<HTMLElement>("[data-tilt]");
      if (tilts.length && w.VanillaTilt && !reduce && pointerOnly) {
        w.VanillaTilt.init(tilts, { max: 8, speed: 400, glare: true, "max-glare": 0.15, scale: 1.02 });
      }

      const typedEl = document.getElementById("tigerTyped");
      if (typedEl && w.Typewriter && !reduce) {
        typedEl.textContent = "";
        tw = new w.Typewriter(typedEl, { loop: true, delay: 80, deleteSpeed: 40, cursor: "▍" });
        (tw as any)
          .typeString("记录每一次训练").pauseFor(1600).deleteAll()
          .typeString("吃对每一餐").pauseFor(1600).deleteAll()
          .typeString("看见每一点进步").pauseFor(1600).deleteAll()
          .typeString("坚持，就是改变").pauseFor(1600).deleteAll()
          .start();
      }

      if (document.querySelectorAll("[data-rellax-speed]").length && w.Rellax && !reduce && pointerOnly) {
        new w.Rellax("[data-rellax-speed]", { center: true, round: true, vertical: true, horizontal: false });
      }

      if (w.Waves && !reduce) { w.Waves.attach(".tiger-ripple", "waves-light"); w.Waves.init(); }
    })();

    return () => { cancelled = true; try { tw?.stop?.(); } catch { /* ignore */ } };
  }, [active]);
}