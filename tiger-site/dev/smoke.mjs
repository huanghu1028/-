// 本地冒烟测试：对 dev/function-local.ts 演练服务跑完整业务流程。
// 用法：先 npm run dev:api，再 node dev/smoke.mjs
const BASE = 'http://127.0.0.1:8001/functions/v1/app';
let cookie = '';
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

async function call(method, path, body, useCookie = true) {
  const headers = { 'content-type': 'application/json' };
  if (useCookie && cookie) headers.cookie = cookie;
  const resp = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const m = c.match(/__Host-app_auth\.session=([^;]*)/);
    if (m) cookie = m[1] ? `__Host-app_auth.session=${m[1]}` : '';
  }
  let data = null;
  try { data = await resp.json(); } catch { /* 无 JSON 体 */ }
  return { status: resp.status, data };
}

const username = `smoke${Date.now().toString(36)}`;
const password = 'smoke-test-passphrase-15';
const today = new Date().toISOString().slice(0, 10);

// 1. 健康检查与未登录拦截
let r = await call('GET', '/api/health', undefined, false);
check('health', r.status === 200 && r.data?.ok === true, JSON.stringify(r));
r = await call('GET', '/api/plans', undefined, false);
check('plans 未登录 401', r.status === 401 && r.data?.error === 'login_required', JSON.stringify(r));

// 2. 注册 / 当前用户
r = await call('POST', '/api/register', { username, password });
check('register 201', r.status === 201 && r.data?.user?.username === username && cookie !== '', JSON.stringify(r));
r = await call('GET', '/api/me');
check('me', r.status === 200 && r.data?.user?.username === username, JSON.stringify(r));
r = await call('POST', '/api/register', { username, password: 'another-passphrase-15' });
check('重复注册 409', r.status === 409 && r.data?.error === 'username_taken', JSON.stringify(r));

// 3. 资料
r = await call('PUT', '/api/profile', { display_name: '冒烟虎', gender: 'male', birth_year: 1995, height_cm: 175, activity: 'moderate', kcal_target: 1800, protein_target: 120 });
check('profile PUT', r.status === 200 && r.data?.profile?.display_name === '冒烟虎', JSON.stringify(r));
r = await call('GET', '/api/profile');
check('profile GET', r.status === 200 && r.data?.profile?.kcal_target === 1800, JSON.stringify(r));

// 4. 计划 → 训练日 → 动作
r = await call('POST', '/api/plans', { name: '减脂入门', goal: '每周三练' });
const planId = r.data?.id;
check('plan POST 201', r.status === 201 && !!planId, JSON.stringify(r));
r = await call('POST', `/api/plans/${planId}/days`, { name: '第一天 · 推', day_index: 0 });
const dayId = r.data?.id;
check('day POST 201', r.status === 201 && !!dayId, JSON.stringify(r));
r = await call('POST', `/api/days/${dayId}/items`, { exercise_id: 14, sets: 4, reps: 12, weight: 20 });
const itemId = r.data?.id;
check('item POST 201', r.status === 201 && r.data?.weight === '20.0', JSON.stringify(r));
r = await call('GET', '/api/plans');
check('plans 树组装', r.status === 200 && r.data?.[0]?.days?.[0]?.items?.[0]?.exercise_id === 14, JSON.stringify(r));
r = await call('PATCH', `/api/items/${itemId}`, { sets: 5, weight: 22.5 });
check('item PATCH', r.status === 200 && r.data?.sets === 5 && r.data?.weight === '22.5', JSON.stringify(r));
r = await call('PATCH', `/api/days/${dayId}`, { name: '第一天 · 上肢' });
check('day PATCH', r.status === 200 && r.data?.name === '第一天 · 上肢', JSON.stringify(r));
r = await call('PATCH', `/api/plans/${planId}`, { goal: '每周四练' });
check('plan PATCH', r.status === 200 && r.data?.goal === '每周四练', JSON.stringify(r));

// 5. 打卡
r = await call('POST', '/api/logs', { log_date: today, plan_name: '减脂入门', day_name: '第一天 · 上肢', detail: [{ exercise_id: 14, name: '哑铃卧推', sets: 5, reps: 12, weight: 22.5, done_sets: 5 }], duration_min: 45, note: '状态不错' });
const logId = r.data?.id;
check('log POST 201', r.status === 201 && !!logId, JSON.stringify(r));
r = await call('GET', `/api/logs?date=${today}`);
check('log GET by date', r.status === 200 && r.data?.length === 1, JSON.stringify(r));
r = await call('GET', '/api/logs');
check('log GET all', r.status === 200 && r.data?.[0]?.id === logId, JSON.stringify(r));

// 6. 体重 upsert
r = await call('PUT', '/api/weight', { entry_date: today, weight_kg: 72.35, note: '晨起空腹' });
check('weight 首次 201', r.status === 201 && r.data?.weight_kg === '72.35', JSON.stringify(r));
r = await call('PUT', '/api/weight', { entry_date: today, weight_kg: 72.1 });
check('weight 同日更新 200', r.status === 200 && r.data?.weight_kg === '72.10', JSON.stringify(r));
r = await call('GET', '/api/weight');
check('weight GET', r.status === 200 && r.data?.length === 1, JSON.stringify(r));

// 7. 饮食
r = await call('POST', '/api/diet', { entry_date: today, meal: 'breakfast', food_name: '燕麦片', grams: 60, kcal: 226.8, protein: 8.1, fat: 4.2, carb: 39.6 });
const dietId = r.data?.id;
check('diet POST 201', r.status === 201 && !!dietId, JSON.stringify(r));
r = await call('GET', `/api/diet?date=${today}`);
check('diet GET', r.status === 200 && r.data?.[0]?.food_name === '燕麦片', JSON.stringify(r));

// 8. AI 教练（BYOK：访客自带 DeepSeek 密钥）
r = await call('GET', '/api/chat');
check('chat GET 空', r.status === 200 && Array.isArray(r.data) && r.data.length === 0, JSON.stringify(r));
r = await call('POST', '/api/chat', { message: '帮我安排今天的训练' });
check('chat 无密钥 400', r.status === 400 && r.data?.error === 'coach_key_required', JSON.stringify(r));
r = await call('POST', '/api/chat', { message: '帮我安排今天的训练', apiKey: 'bad-key' });
check('chat 密钥格式错 400', r.status === 400 && r.data?.error === 'invalid_coach_key', JSON.stringify(r));
r = await call('POST', '/api/chat', { message: '帮我安排今天的训练', apiKey: 'sk-fake0000000000000000000000000000' });
check('chat 假密钥上游拒绝 503', r.status === 503 && r.data?.error === 'coach_unavailable', JSON.stringify(r));

// 9. 删除链路
r = await call('DELETE', `/api/diet/${dietId}`);
check('diet DELETE', r.status === 200, JSON.stringify(r));
r = await call('DELETE', `/api/weight/${today}`);
check('weight DELETE', r.status === 200, JSON.stringify(r));
r = await call('DELETE', `/api/logs/${logId}`);
check('log DELETE', r.status === 200, JSON.stringify(r));
r = await call('DELETE', `/api/plans/${planId}`);
check('plan DELETE 级联', r.status === 200, JSON.stringify(r));
r = await call('GET', '/api/plans');
check('plans 已空', r.status === 200 && r.data?.length === 0, JSON.stringify(r));

// 10. 退出 / 失效会话 / 重新登录
r = await call('POST', '/api/logout');
check('logout', r.status === 200 && cookie === '', JSON.stringify(r));
r = await call('GET', '/api/me');
check('退出后 me 401', r.status === 401, JSON.stringify(r));
r = await call('POST', '/api/login', { username, password: 'wrong-passphrase-15chars' });
check('错误密码 401', r.status === 401 && r.data?.error === 'invalid_credentials', JSON.stringify(r));
r = await call('POST', '/api/login', { username, password });
check('login 200', r.status === 200 && cookie !== '', JSON.stringify(r));
r = await call('GET', '/api/me');
check('登录后 me', r.status === 200 && r.data?.user?.username === username, JSON.stringify(r));

// 11. 输入校验抽查
r = await call('PUT', '/api/weight', { entry_date: '2026-02-30', weight_kg: 70 });
check('非法日期 400', r.status === 400, JSON.stringify(r));
r = await call('POST', '/api/diet', { entry_date: today, meal: 'brunch', food_name: 'x', grams: 1, kcal: 1, protein: 0, fat: 0, carb: 0 });
check('非法餐次 400', r.status === 400, JSON.stringify(r));
r = await call('POST', '/api/register', { username: 'ab', password });
check('短用户名 400', r.status === 400, JSON.stringify(r));

console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);