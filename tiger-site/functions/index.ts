// 部署入口：平台在打包时注入 _qoder/backend.mjs（createDatabaseClient / createSiteContext / errorResponse）。
// 本目录不要包含 _qoder/，Worker 会在部署前提供这些平台模块。
import { createSiteContext, createDatabaseClient, errorResponse } from './_qoder/backend.mjs';
import { createApplication } from './router.mjs';
import { PUBLIC_ORIGIN } from './http.mjs';

const handle = createApplication({
  db: createDatabaseClient(),
  // 固定公开来源已写入 http.mjs；APP_ORIGIN 环境变量可覆盖（非必填密钥）。
  origin: () => Deno.env.get('APP_ORIGIN') || PUBLIC_ORIGIN,
  env: (key: string) => Deno.env.get(key),
});

Deno.serve(async (request) => {
  let context;
  try {
    // forwardApplicationCredentials: 保留本应用自己的会话 Cookie（应用自管身份，不用平台登录）。
    context = createSiteContext(request, { forwardApplicationCredentials: true });
    return await handle(context);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});