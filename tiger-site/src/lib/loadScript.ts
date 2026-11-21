// 按需加载 vendored 全局脚本（UMD），带缓存，避免重复注入。
const cache = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  const hit = cache.get(src);
  if (hit) return hit;
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => { cache.delete(src); reject(new Error("script load failed: " + src)); };
    document.head.appendChild(el);
  });
  cache.set(src, p);
  return p;
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 按需加载第三方样式表（同样带缓存）：只在真正用到特效的页面注入，不进首屏关键路径。
const styleCache = new Map<string, Promise<void>>();

export function loadStyle(href: string): Promise<void> {
  const hit = styleCache.get(href);
  if (hit) return hit;
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement("link");
    el.rel = "stylesheet";
    el.href = href;
    el.onload = () => resolve();
    el.onerror = () => { styleCache.delete(href); reject(new Error("style load failed: " + href)); };
    document.head.appendChild(el);
  });
  styleCache.set(href, p);
  return p;
}
