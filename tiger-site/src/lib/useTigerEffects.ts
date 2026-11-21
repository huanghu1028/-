// 落地页视觉特效 hook：移植自原站 tiger-fx.js。
// 加载 vendored MIT 库并初始化 AOS 滚动揭示 / countUp 数字滚动 / vanilla-tilt 3D /
// typewriter 打字机 / Waves 涟漪。全部 feature-detected，减弱动效时跳过。
// 性能：去掉了 Rellax 视差——它每帧重写 transform，实测占落地页约 1/4 的主线程时间，
// 而且元素「跟不住」滚动，正是「这一页有点卡」的主要来源；静态装饰一样好看。
import { useEffect } from "react";
import { loadScript, loadStyle, prefersReducedMotion } from "./loadScript";

export function useTigerEffects(active = true): void {
  useEffect(() => {
    if (!active) return;
    const reduce = prefersReducedMotion();
    const pointerOnly = !("ontouchstart" in window);
    let cancelled = false;
    let tw: { stop?: () => void; pause?: () => void } | null = null;
    let typedOb: IntersectionObserver | undefined;

    (async () => {
      try {
        await Promise.all([
          loadScript("/vendor/aos/aos.js"),
          loadScript("/vendor/countup/countUp.umd.js"),
          loadScript("/vendor/vanilla-tilt/vanilla-tilt.min.js"),
          loadScript("/vendor/typewriter/typewriter.umd.js"),
          loadScript("/vendor/waves/waves.min.js"),
          loadStyle("/vendor/waves/waves.min.css"),
        ]);
      } catch {
        // 特效脚本没到位也不能让页面留着看不见的区块：直接放行所有 data-aos 元素。
        document.documentElement.setAttribute("data-aos-fallback", "");
        return;
      }
      if (cancelled) return;
      const w = window as unknown as Record<string, any>;

      if (w.AOS && document.querySelector("[data-aos]")) {
        w.AOS.init({ once: true, duration: 500, easing: "ease-out-cubic", offset: 60, disable: reduce });
      } else {
        document.documentElement.setAttribute("data-aos-fallback", "");
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
        // 打字机离开视口就暂停：读下面的内容时不再每 80ms 改一次 DOM。
        // 这版 Typewriter 只有 pause()，没有 resume()——它的 start() 不会重置队列
        // （内部 stop() 只取消 rAF），所以用 start() 当恢复用，回来时接着打而不是从头再来。
        if ("IntersectionObserver" in window) {
          let hiddenByObserver = false;
          typedOb = new IntersectionObserver((entries) => {
            const on = entries.some((e) => e.isIntersecting);
            try {
              const t = tw as { pause?: () => void; start?: () => void } | null;
              if (!on) { t?.pause?.(); hiddenByObserver = true; }
              else if (hiddenByObserver) { t?.start?.(); hiddenByObserver = false; }
            } catch { /* 库换了 API 就保持原样继续跑 */ }
          }, { threshold: 0 });
          typedOb.observe(typedEl);
        }
      }

      if (w.Waves && !reduce) { w.Waves.attach(".tiger-ripple", "waves-light"); w.Waves.init(); }
    })();

    return () => {
      cancelled = true;
      typedOb?.disconnect();
      try { tw?.stop?.(); } catch { /* ignore */ }
    };
  }, [active]);
}