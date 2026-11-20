// 本地演练入口（不部署）：真实应用路由 + 凭据无关假数据库 + 文件持久化。
// 与部署入口 functions/index.ts 的区别：
//   1. db 用 dev/fake-db.mjs（内存 Map + dev/.local-db.json 持久化），不需要云凭据；
//   2. origin 固定为本地演练值，并把请求 Origin 头重写为该值（仅本地 http 演练用，
//      生产环境由 APP_ORIGIN Secret + 真实 HTTPS Origin 校验，绝不重写）。
import { createApplication } from "../functions/router.mjs";
import { createFakeDb } from "./fake-db.mjs";

const DB_FILE = new URL("./.local-db.json", import.meta.url);
const LOCAL_ORIGIN = "https://tiger-local.dev";

const control = { mode: "ok", dropTable: null, rejectTable: null, writes: [] as string[] };
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const db = createFakeDb(control, {
  onChange: () => {
    // 合并短时间内的多次变更，落盘失败不影响演练请求。
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void Deno.writeTextFile(DB_FILE, JSON.stringify(db.dumpAll())).catch(() => {});
    }, 50);
  },
});

try {
  db.loadAll(JSON.parse(await Deno.readTextFile(DB_FILE)));
  console.log(`[dev] 已恢复本地数据 ${DB_FILE.pathname}`);
} catch {
  console.log("[dev] 全新本地数据库");
}

const handle = createApplication({
  db,
  origin: () => LOCAL_ORIGIN,
  env: (key: string) => Deno.env.get(key),
});

Deno.serve({ hostname: "127.0.0.1", port: 8001 }, async (request) => {
  // 演练垫片：本地 http 没有可信 HTTPS Origin，统一重写为固定演练源以通过同源校验。
  const headers = new Headers(request.headers);
  headers.set("origin", LOCAL_ORIGIN);
  const bytes = await request.arrayBuffer();
  const shimmed = new Request(request.url, {
    method: request.method,
    headers,
    body: bytes.byteLength > 0 ? bytes : undefined,
  });
  return await handle({ request: shimmed });
});

console.log(`[dev] tiger-减脂 API 演练服务: http://127.0.0.1:8001/functions/v1/app/api/health`);