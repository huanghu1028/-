// tiger-减脂 应用路由：注册 / 登录 / 退出 / 当前用户 / 资料 / 计划 / 打卡 / 体重 / 饮食 / AI 教练。
// 应用身份一律来自本应用自己的会话校验（数据库中的会话摘要），
// 绝不使用 ctx.user、平台身份、Host 头或浏览器提交的 owner_id。
// 所有业务读写都带 owner_id 谓词；平台 RLS 负责租户隔离，这里负责用户级归属。
import { AppError, applicationPath, errorJson, json, readJson, requireTrustedOrigin, rows } from './http.mjs';
import {
  ACTIVITIES, GENDERS, MEALS, WEIGHT_UNITS, boundedText, canonicalUsername, decimalStr, intIn,
  nullableIntIn, oneOf, validateDate, validateLogDetail, validatePassword,
  validateDataUrl, validateExtras, validateDashboardLayout,
} from './validate.mjs';
import { hashPassword, verifyPassword, verifyPasswordAgainstDummy } from './passwords.mjs';
import { SESSION_TTL_MS, clearSessionCookie, createSession, revokeSession, sessionCookie, validateSession } from './sessions.mjs';
import { consume } from './limiter.mjs';

const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const encoder = new TextEncoder();

class SessionRequired extends Error {
  constructor(state) {
    super('login_required');
    this.state = state;
  }
}

const retryAfter = (result) => ({ 'retry-after': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) });

// Cookie 存在但无效（过期 / 已撤销 / 被篡改）时顺手清掉，避免浏览器一直带着失效凭据。
function unauthorized(state) {
  return state === 'invalid'
    ? errorJson('login_required', 401, { 'set-cookie': clearSessionCookie() })
    : errorJson('login_required', 401);
}

async function requireSession(db, request) {
  const result = await validateSession(db, request);
  if (result.state !== 'valid') throw new SessionRequired(result.state);
  return result.session;
}

// 会话凭据只在服务端校验；用户资料单独读取（会话表里只有摘要、用户 ID 与时间）。
async function loadUser(db, userId) {
  const found = rows(await db.from('users').select('id,username').eq('id', userId).limit(1));
  if (found.length !== 1 || typeof found[0]?.username !== 'string') {
    throw new SessionRequired('invalid');
  }
  return { id: found[0].id, username: found[0].username };
}

function boundedPassword(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || encoder.encode(raw).length > 256) {
    throw new AppError('invalid_input', 400);
  }
  return raw;
}

async function register(db, request) {
  const body = await readJson(request);
  const username = canonicalUsername(body?.username);
  const password = validatePassword(body?.password);
  // 注册同样受限流约束（按规范化用户名计数）。
  const limit = await consume(db, 'register', username);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const existing = rows(await db.from('users').select('id').eq('username', username).limit(1));
  if (existing.length > 0) return errorJson('username_taken', 409);

  const derived = await hashPassword(password);
  const id = crypto.randomUUID();
  // 唯一性由数据库在 username 上判定：并发注册同名时只有一个写入者成功。
  const created = rows(await db.from('users').insertIfAbsent({
    id,
    username,
    password_salt: derived.salt,
    password_hash: derived.hash,
    password_iterations: derived.iterations,
    created_at: new Date().toISOString(),
  }, { onConflict: 'username' }).select('id,username'));

  if (created.length !== 1) {
    const winner = rows(await db.from('users').select('id').eq('username', username).limit(1));
    if (winner.length === 1) return errorJson('username_taken', 409);
    // 既没写成、也读不到同名记录：结果无法确认，不做任何重放。
    return errorJson('registration_unconfirmed', 503);
  }

  const { token } = await createSession(db, id);
  return json({ user: { id, username } }, 201, { 'set-cookie': sessionCookie(token, SESSION_TTL_SECONDS) });
}

async function login(db, request) {
  const body = await readJson(request);
  const username = canonicalUsername(body?.username);
  // 先消费配额：对不存在的账号同样计数，避免用失败次数探测账号是否存在。
  const limit = await consume(db, 'login', username);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const password = boundedPassword(body?.password);
  const found = rows(await db.from('users')
    .select('id,username,password_salt,password_hash,password_iterations').eq('username', username).limit(1));

  if (found.length !== 1) {
    // 用户名不存在时也付出同等计算代价，再返回与密码错误相同的错误码。
    await verifyPasswordAgainstDummy(password);
    return errorJson('invalid_credentials', 401);
  }

  const user = found[0];
  const ok = await verifyPassword(password, {
    salt: user.password_salt, hash: user.password_hash, iterations: user.password_iterations,
  });
  if (!ok) return errorJson('invalid_credentials', 401);

  // 成功登录不重置窗口计数：固定窗口内已消费的配额继续累计。
  const { token } = await createSession(db, user.id);
  return json({ user: { id: user.id, username: user.username } }, 200, { 'set-cookie': sessionCookie(token, SESSION_TTL_SECONDS) });
}

async function logout(db, request) {
  const result = await validateSession(db, request);
  if (result.state === 'valid' && result.session) {
    try {
      await revokeSession(db, result.session.digest);
    } catch {
      // 撤销结果未知：保留 Cookie，让用户可以在会话仍有效时重试退出；不重放、不谎报成功。
      return errorJson('logout_unconfirmed', 503);
    }
  }
  // 先撤销数据库会话，再清除 Cookie。
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

// ---------- 资料 ----------

const DEFAULT_PROFILE = {
  display_name: '', gender: '', birth_year: null, height_cm: null,
  activity: 'moderate', kcal_target: null, protein_target: null,
};

async function readProfile(db, userId) {
  const found = rows(await db.from('profiles')
    .select('owner_id,display_name,gender,birth_year,height_cm,activity,kcal_target,protein_target,updated_at')
    .eq('owner_id', userId).limit(1));
  return found.length === 1 ? found[0] : null;
}

async function profileGet({ db, request, session }) {
  const profile = await readProfile(db, session.userId);
  if (profile) return json({ profile });
  const user = await loadUser(db, session.userId);
  return json({ profile: { ...DEFAULT_PROFILE, display_name: user.username, owner_id: session.userId } });
}

async function profilePut({ db, request, session }) {
  const body = await readJson(request);
  const profile = {
    owner_id: session.userId,
    display_name: boundedText(body?.display_name, 30),
    gender: oneOf(body?.gender ?? '', GENDERS),
    birth_year: nullableIntIn(body?.birth_year, 1920, 2020),
    height_cm: nullableIntIn(body?.height_cm, 100, 250),
    activity: oneOf(body?.activity ?? 'moderate', ACTIVITIES),
    kcal_target: nullableIntIn(body?.kcal_target, 800, 6000),
    protein_target: nullableIntIn(body?.protein_target, 30, 400),
    updated_at: new Date().toISOString(),
  };
  const inserted = rows(await db.from('profiles').insertIfAbsent(profile, { onConflict: 'owner_id' })
    .select('owner_id,display_name,gender,birth_year,height_cm,activity,kcal_target,protein_target,updated_at'));
  if (inserted.length === 1) return json({ profile: inserted[0] });
  const updated = rows(await db.from('profiles').update(profile)
    .eq('owner_id', session.userId)
    .select('owner_id,display_name,gender,birth_year,height_cm,activity,kcal_target,protein_target,updated_at'));
  if (updated.length !== 1) return errorJson('profile_unconfirmed', 503);
  return json({ profile: updated[0] });
}

// ---------- 训练计划 ----------

async function plansGet({ db, session }) {
  const plans = rows(await db.from('plans').select('id,name,goal,created_at')
    .eq('owner_id', session.userId).order('created_at').limit(30));
  const days = rows(await db.from('plan_days').select('id,plan_id,day_index,name')
    .eq('owner_id', session.userId).order('day_index').limit(210));
  const items = rows(await db.from('plan_items').select('id,day_id,exercise_id,sort,sets,reps,weight')
    .eq('owner_id', session.userId).order('sort').limit(1000));
  const planIds = new Set(plans.map((p) => p.id));
  const daysByPlan = new Map();
  for (const day of days) {
    if (!planIds.has(day.plan_id)) continue; // 清理残留的孤儿行不进入结果
    if (!daysByPlan.has(day.plan_id)) daysByPlan.set(day.plan_id, []);
    daysByPlan.get(day.plan_id).push({ ...day, items: [] });
  }
  const dayIds = new Set([...daysByPlan.values()].flat().map((d) => d.id));
  const itemsByDay = new Map();
  for (const item of items) {
    if (!dayIds.has(item.day_id)) continue;
    if (!itemsByDay.has(item.day_id)) itemsByDay.set(item.day_id, []);
    itemsByDay.get(item.day_id).push(item);
  }
  for (const list of daysByPlan.values()) {
    for (const day of list) day.items = itemsByDay.get(day.id) ?? [];
  }
  return json(plans.map((p) => ({ ...p, days: daysByPlan.get(p.id) ?? [] })));
}

async function plansPost({ db, request, session }) {
  const body = await readJson(request);
  const row = {
    id: crypto.randomUUID(),
    owner_id: session.userId,
    name: boundedText(body?.name, 60),
    goal: boundedText(body?.goal ?? '', 200, { allowEmpty: true }),
    created_at: new Date().toISOString(),
  };
  const created = rows(await db.from('plans').insertIfAbsent(row, { onConflict: 'owner_id,id' })
    .select('id,name,goal,created_at'));
  if (created.length !== 1) return errorJson('plan_unconfirmed', 503);
  return json({ ...created[0], days: [] }, 201);
}

async function assertOwned(db, table, id, userId, select = 'id') {
  const found = rows(await db.from(table).select(select).eq('owner_id', userId).eq('id', id).limit(1));
  if (found.length !== 1) throw new AppError('not_found', 404);
  return found[0];
}

async function planPatch({ db, request, session, match }) {
  const id = match[1];
  await assertOwned(db, 'plans', id, session.userId);
  const body = await readJson(request);
  const patch = {};
  if (body?.name !== undefined) patch.name = boundedText(body.name, 60);
  if (body?.goal !== undefined) patch.goal = boundedText(body.goal, 200, { allowEmpty: true });
  if (Object.keys(patch).length === 0) throw new AppError('invalid_input', 400);
  const updated = rows(await db.from('plans').update(patch)
    .eq('owner_id', session.userId).eq('id', id).select('id,name,goal,created_at'));
  if (updated.length !== 1) return errorJson('plan_unconfirmed', 503);
  return json(updated[0]);
}

async function planDelete({ db, session, match }) {
  const id = match[1];
  await assertOwned(db, 'plans', id, session.userId);
  const days = rows(await db.from('plan_days').select('id')
    .eq('owner_id', session.userId).eq('plan_id', id).limit(210));
  // 先删子项再删父行；中途失败时 GET 组装会过滤孤儿行，不会显示残留数据。
  for (const day of days) {
    rows(await db.from('plan_items').delete().eq('owner_id', session.userId).eq('day_id', day.id).select('id'));
  }
  rows(await db.from('plan_days').delete().eq('owner_id', session.userId).eq('plan_id', id).select('id'));
  const deleted = rows(await db.from('plans').delete().eq('owner_id', session.userId).eq('id', id).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

async function daysPost({ db, request, session, match }) {
  const planId = match[1];
  await assertOwned(db, 'plans', planId, session.userId);
  const body = await readJson(request);
  const row = {
    id: crypto.randomUUID(),
    owner_id: session.userId,
    plan_id: planId,
    day_index: intIn(body?.day_index, 0, 30),
    name: boundedText(body?.name, 60),
  };
  const created = rows(await db.from('plan_days').insertIfAbsent(row, { onConflict: 'owner_id,id' })
    .select('id,plan_id,day_index,name'));
  if (created.length !== 1) return errorJson('day_unconfirmed', 503);
  return json({ ...created[0], items: [] }, 201);
}

async function dayPatch({ db, request, session, match }) {
  const id = match[1];
  await assertOwned(db, 'plan_days', id, session.userId);
  const body = await readJson(request);
  const name = boundedText(body?.name, 60);
  const updated = rows(await db.from('plan_days').update({ name })
    .eq('owner_id', session.userId).eq('id', id).select('id,plan_id,day_index,name'));
  if (updated.length !== 1) return errorJson('day_unconfirmed', 503);
  return json(updated[0]);
}

async function dayDelete({ db, session, match }) {
  const id = match[1];
  await assertOwned(db, 'plan_days', id, session.userId);
  rows(await db.from('plan_items').delete().eq('owner_id', session.userId).eq('day_id', id).select('id'));
  const deleted = rows(await db.from('plan_days').delete().eq('owner_id', session.userId).eq('id', id).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

async function itemsPost({ db, request, session, match }) {
  const dayId = match[1];
  await assertOwned(db, 'plan_days', dayId, session.userId);
  const body = await readJson(request);
  const existing = rows(await db.from('plan_items').select('id')
    .eq('owner_id', session.userId).eq('day_id', dayId).limit(100));
  if (existing.length >= 60) throw new AppError('too_many_items', 400);
  const row = {
    id: crypto.randomUUID(),
    owner_id: session.userId,
    day_id: dayId,
    exercise_id: intIn(body?.exercise_id, 1, 1000000),
    sort: existing.length,
    sets: intIn(body?.sets, 1, 20),
    reps: intIn(body?.reps, 0, 200),
    weight: decimalStr(body?.weight ?? 0, 1000, 1),
  };
  const created = rows(await db.from('plan_items').insertIfAbsent(row, { onConflict: 'owner_id,id' })
    .select('id,day_id,exercise_id,sort,sets,reps,weight'));
  if (created.length !== 1) return errorJson('item_unconfirmed', 503);
  return json(created[0], 201);
}

async function itemPatch({ db, request, session, match }) {
  const id = match[1];
  await assertOwned(db, 'plan_items', id, session.userId);
  const body = await readJson(request);
  const patch = {};
  if (body?.sets !== undefined) patch.sets = intIn(body.sets, 1, 20);
  if (body?.reps !== undefined) patch.reps = intIn(body.reps, 0, 200);
  if (body?.weight !== undefined) patch.weight = decimalStr(body.weight, 1000, 1);
  if (Object.keys(patch).length === 0) throw new AppError('invalid_input', 400);
  const updated = rows(await db.from('plan_items').update(patch)
    .eq('owner_id', session.userId).eq('id', id).select('id,day_id,exercise_id,sort,sets,reps,weight'));
  if (updated.length !== 1) return errorJson('item_unconfirmed', 503);
  return json(updated[0]);
}

async function itemDelete({ db, session, match }) {
  const deleted = rows(await db.from('plan_items').delete()
    .eq('owner_id', session.userId).eq('id', match[1]).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

// ---------- 训练打卡 ----------

async function logsGet({ db, session, url }) {
  const dateParam = url.searchParams.get('date');
  if (dateParam) {
    const date = validateDate(dateParam);
    const list = rows(await db.from('workout_logs')
      .select('id,log_date,plan_name,day_name,detail,duration_min,note,created_at')
      .eq('owner_id', session.userId).eq('log_date', date).order('created_at').limit(60));
    return json(list);
  }
  const list = rows(await db.from('workout_logs')
    .select('id,log_date,plan_name,day_name,detail,duration_min,note,created_at')
    .eq('owner_id', session.userId).order('log_date').limit(500));
  list.sort((a, b) => String(b.log_date).localeCompare(String(a.log_date))
    || String(b.created_at).localeCompare(String(a.created_at)));
  return json(list.slice(0, 100));
}

async function logsPost({ db, request, session }) {
  const body = await readJson(request, 16384);
  const row = {
    id: crypto.randomUUID(),
    owner_id: session.userId,
    log_date: validateDate(body?.log_date),
    plan_name: boundedText(body?.plan_name ?? '', 60, { allowEmpty: true }),
    day_name: boundedText(body?.day_name ?? '', 60, { allowEmpty: true }),
    detail: validateLogDetail(body?.detail),
    duration_min: intIn(body?.duration_min ?? 0, 0, 600),
    note: boundedText(body?.note ?? '', 300, { allowEmpty: true }),
    created_at: new Date().toISOString(),
  };
  const created = rows(await db.from('workout_logs').insertIfAbsent(row, { onConflict: 'owner_id,id' })
    .select('id,log_date,plan_name,day_name,detail,duration_min,note,created_at'));
  if (created.length !== 1) return errorJson('log_unconfirmed', 503);
  return json(created[0], 201);
}

async function logDelete({ db, session, match }) {
  const deleted = rows(await db.from('workout_logs').delete()
    .eq('owner_id', session.userId).eq('id', match[1]).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

// ---------- 体重 ----------

const WEIGHT_COLS = 'owner_id,entry_date,weight_kg,note,updated_at';

async function weightGet({ db, session }) {
  const list = rows(await db.from('weight_entries').select(WEIGHT_COLS)
    .eq('owner_id', session.userId).order('entry_date').limit(400));
  return json(list);
}

async function weightPut({ db, request, session }) {
  const body = await readJson(request);
  const entryDate = validateDate(body?.entry_date);
  const weightKg = decimalStr(body?.weight_kg, 500, 2, 'invalid_weight');
  if (Number(weightKg) <= 0) throw new AppError('invalid_weight', 400);
  const row = {
    owner_id: session.userId,
    entry_date: entryDate,
    weight_kg: weightKg,
    note: boundedText(body?.note ?? '', 200, { allowEmpty: true }),
    updated_at: new Date().toISOString(),
  };
  // 同一日期唯一：先「插入或忽略」，已存在则按 (owner, date) 谓词更新。
  const inserted = rows(await db.from('weight_entries').insertIfAbsent(row, { onConflict: 'owner_id,entry_date' })
    .select(WEIGHT_COLS));
  if (inserted.length === 1) return json(inserted[0], 201);
  const updated = rows(await db.from('weight_entries')
    .update({ weight_kg: row.weight_kg, note: row.note, updated_at: row.updated_at })
    .eq('owner_id', session.userId).eq('entry_date', entryDate).select(WEIGHT_COLS));
  if (updated.length === 1) return json(updated[0], 200);
  // 两步之间行被并发删除：有界重试一次插入，仍不确定则失败关闭。
  const retry = rows(await db.from('weight_entries').insertIfAbsent(row, { onConflict: 'owner_id,entry_date' })
    .select(WEIGHT_COLS));
  if (retry.length === 1) return json(retry[0], 201);
  return errorJson('weight_unconfirmed', 503);
}

async function weightDelete({ db, session, url }) {
  const date = validateDate(url.pathname.split('/').pop());
  const deleted = rows(await db.from('weight_entries').delete()
    .eq('owner_id', session.userId).eq('entry_date', date).select('entry_date'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

// ---------- 饮食 ----------

const DIET_COLS = 'id,entry_date,meal,food_name,grams,kcal,protein,fat,carb,created_at';

async function dietGet({ db, session, url }) {
  const date = validateDate(url.searchParams.get('date'));
  const list = rows(await db.from('diet_entries').select(DIET_COLS)
    .eq('owner_id', session.userId).eq('entry_date', date).order('created_at').limit(200));
  return json(list);
}

async function dietPost({ db, request, session }) {
  const body = await readJson(request);
  const grams = decimalStr(body?.grams, 5000, 1, 'invalid_input');
  if (Number(grams) <= 0) throw new AppError('invalid_input', 400);
  const row = {
    id: crypto.randomUUID(),
    owner_id: session.userId,
    entry_date: validateDate(body?.entry_date),
    meal: oneOf(body?.meal, MEALS),
    food_name: boundedText(body?.food_name, 80),
    grams,
    kcal: decimalStr(body?.kcal, 9000, 1),
    protein: decimalStr(body?.protein, 1000, 1),
    fat: decimalStr(body?.fat, 1000, 1),
    carb: decimalStr(body?.carb, 1000, 1),
    created_at: new Date().toISOString(),
  };
  const created = rows(await db.from('diet_entries').insertIfAbsent(row, { onConflict: 'owner_id,id' })
    .select(DIET_COLS));
  if (created.length !== 1) return errorJson('diet_unconfirmed', 503);
  return json(created[0], 201);
}

async function dietDelete({ db, session, match }) {
  const deleted = rows(await db.from('diet_entries').delete()
    .eq('owner_id', session.userId).eq('id', match[1]).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

// ---------- AI 教练 ----------

const ACTIVITY_ZH = {
  sedentary: '久坐少动', light: '轻度活动（每周1-3次）', moderate: '中等活动（每周3-5次）',
  active: '高度活动（每周6-7次）', very_active: '非常高（体力劳动或每日两练）',
};

function coachSystemPrompt(user, profile, latestWeight, recentLogs) {
  const lines = [
    '你是「tiger-减脂」健身平台的 AI 教练，名叫虎教练。用简体中文回答，语气友好、专业、简洁。',
    '职责：训练安排、动作要点、饮食营养、减脂策略、恢复与睡眠建议。',
    '边界：不做医疗诊断；用户提到疼痛、伤病、疾病或用药时，建议先咨询医生或专业人士。',
    '原则：循序渐进，减重速度建议每周不超过体重的1%；不推荐极端节食或违禁药物；不编造用户没有提供的数据。',
    '回答默认控制在300字以内，给出可执行的建议；用户明确要求详细方案时可以展开。',
  ];
  const facts = [`用户昵称：${user.username}`];
  if (profile) {
    if (profile.gender === 'male') facts.push('性别：男');
    if (profile.gender === 'female') facts.push('性别：女');
    if (profile.birth_year) facts.push(`出生年份：${profile.birth_year}`);
    if (profile.height_cm) facts.push(`身高：${profile.height_cm}cm`);
    facts.push(`活动水平：${ACTIVITY_ZH[profile.activity] ?? profile.activity}`);
    if (profile.kcal_target) facts.push(`每日热量目标：${profile.kcal_target}kcal`);
    if (profile.protein_target) facts.push(`每日蛋白质目标：${profile.protein_target}g`);
  }
  if (latestWeight) facts.push(`最近体重：${latestWeight.weight_kg}kg（${latestWeight.entry_date}）`);
  if (recentLogs.length > 0) {
    const dates = [...new Set(recentLogs.map((l) => l.log_date))];
    facts.push(`最近14条打卡覆盖${dates.length}个训练日`);
  }
  lines.push(`用户资料（仅用于个性化建议）：${facts.join('；')}。`);
  return lines.join('\n');
}

async function chatGet({ db, session }) {
  const list = rows(await db.from('chat_messages').select('id,role,content,created_at')
    .eq('owner_id', session.userId).order('created_at').limit(300));
  return json(list.slice(-100));
}

async function chatDelete({ db, session }) {
  rows(await db.from('chat_messages').delete().eq('owner_id', session.userId).select('id'));
  return json({ ok: true });
}

async function chatPost({ db, request, session }) {
  const user = await loadUser(db, session.userId);
  const limit = await consume(db, 'chat', user.username);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const body = await readJson(request, 16384);
  const message = boundedText(body?.message, 2000, { code: 'invalid_message' });

  // BYOK：用访客自己的 DeepSeek 密钥。仅本次请求临时转发给上游，绝不落库、绝不记录。
  const key = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!key) throw new AppError('coach_key_required', 400);
  if (key.length > 128 || !/^sk-[A-Za-z0-9_-]+$/.test(key)) throw new AppError('invalid_coach_key', 400);

  const profile = await readProfile(db, session.userId);
  const weights = rows(await db.from('weight_entries').select('entry_date,weight_kg')
    .eq('owner_id', session.userId).order('entry_date').limit(400));
  const latestWeight = weights.length > 0 ? weights[weights.length - 1] : null;
  const logs = rows(await db.from('workout_logs').select('log_date')
    .eq('owner_id', session.userId).order('log_date').limit(500));
  const history = rows(await db.from('chat_messages').select('role,content')
    .eq('owner_id', session.userId).order('created_at').limit(300)).slice(-20);

  const messages = [
    { role: 'system', content: coachSystemPrompt(user, profile, latestWeight, logs.slice(-14)) },
    ...history.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content) })),
    { role: 'user', content: message },
  ];

  let reply;
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages, max_tokens: 800, temperature: 0.7, stream: false }),
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) throw new Error('upstream status');
    const data = await resp.json();
    reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('empty reply');
  } catch {
    // 上游细节只留在服务端，浏览器得到稳定的应用错误码。
    throw new AppError('coach_unavailable', 503);
  }
  reply = reply.trim().slice(0, 8000);

  rows(await db.from('chat_messages').insertIfAbsent({
    id: crypto.randomUUID(), owner_id: session.userId, role: 'user', content: message,
    created_at: new Date().toISOString(),
  }, { onConflict: 'owner_id,id' }).select('id'));
  let saved = true;
  try {
    rows(await db.from('chat_messages').insertIfAbsent({
      id: crypto.randomUUID(), owner_id: session.userId, role: 'assistant', content: reply,
      created_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,id' }).select('id'));
  } catch {
    saved = false; // 回复已生成但历史保存失败：如实告知，不重放上游调用。
  }
  return json({ reply, saved });
}

// ---------- 测量围度 ----------

const MEAS_CAT_COLS = 'id,name,unit,created_at';
const MEAS_ENTRY_COLS = 'id,category_id,entry_date,value,note,created_at';

async function measCatsGet({ db, session }) {
  return json(rows(await db.from('measurement_categories').select(MEAS_CAT_COLS)
    .eq('owner_id', session.userId).order('created_at').limit(60)));
}

async function measCatsPost({ db, request, session }) {
  const body = await readJson(request);
  const existing = rows(await db.from('measurement_categories').select('id')
    .eq('owner_id', session.userId).limit(60));
  if (existing.length >= 40) throw new AppError('too_many_items', 400);
  const row = {
    id: crypto.randomUUID(), owner_id: session.userId,
    name: boundedText(body?.name, 60), unit: boundedText(body?.unit, 12),
    created_at: new Date().toISOString(),
  };
  const created = rows(await db.from('measurement_categories').insertIfAbsent(row, { onConflict: 'owner_id,id' }).select(MEAS_CAT_COLS));
  if (created.length !== 1) return errorJson('invalid_input', 503);
  return json(created[0], 201);
}

async function measCatDelete({ db, session, match }) {
  const id = match[1];
  await assertOwned(db, 'measurement_categories', id, session.userId);
  rows(await db.from('measurement_entries').delete().eq('owner_id', session.userId).eq('category_id', id).select('id'));
  const deleted = rows(await db.from('measurement_categories').delete().eq('owner_id', session.userId).eq('id', id).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

async function measEntriesGet({ db, session, url }) {
  const cat = url.searchParams.get('category');
  let q = db.from('measurement_entries').select(MEAS_ENTRY_COLS).eq('owner_id', session.userId);
  if (cat) { if (!/^[0-9a-f-]{36}$/.test(cat)) throw new AppError('invalid_input', 400); q = q.eq('category_id', cat); }
  const list = rows(await q.order('entry_date').limit(1000));
  return json(list);
}

async function measEntriesPost({ db, request, session }) {
  const body = await readJson(request);
  const categoryId = body?.category_id;
  if (typeof categoryId !== 'string') throw new AppError('invalid_input', 400);
  await assertOwned(db, 'measurement_categories', categoryId, session.userId);
  const row = {
    id: crypto.randomUUID(), owner_id: session.userId, category_id: categoryId,
    entry_date: validateDate(body?.entry_date),
    value: decimalStr(body?.value, 100000, 2),
    note: boundedText(body?.note ?? '', 200, { allowEmpty: true }),
    created_at: new Date().toISOString(),
  };
  const created = rows(await db.from('measurement_entries').insertIfAbsent(row, { onConflict: 'owner_id,id' }).select(MEAS_ENTRY_COLS));
  if (created.length !== 1) return errorJson('invalid_input', 503);
  return json(created[0], 201);
}

async function measEntryDelete({ db, session, match }) {
  const deleted = rows(await db.from('measurement_entries').delete().eq('owner_id', session.userId).eq('id', match[1]).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

// ---------- 画廊（进度照片） ----------

const GALLERY_COLS = 'id,entry_date,caption,data_url,created_at';

async function galleryGet({ db, session }) {
  return json(rows(await db.from('gallery_images').select(GALLERY_COLS)
    .eq('owner_id', session.userId).order('entry_date').limit(60)));
}

async function galleryPost({ db, request, session }) {
  const body = await readJson(request, 700000);
  const existing = rows(await db.from('gallery_images').select('id').eq('owner_id', session.userId).limit(60));
  if (existing.length >= 60) throw new AppError('too_many_items', 400);
  const row = {
    id: crypto.randomUUID(), owner_id: session.userId,
    entry_date: validateDate(body?.entry_date),
    caption: boundedText(body?.caption ?? '', 120, { allowEmpty: true }),
    data_url: validateDataUrl(body?.data_url),
    created_at: new Date().toISOString(),
  };
  const created = rows(await db.from('gallery_images').insertIfAbsent(row, { onConflict: 'owner_id,id' }).select(GALLERY_COLS));
  if (created.length !== 1) return errorJson('invalid_input', 503);
  return json(created[0], 201);
}

async function galleryDelete({ db, session, match }) {
  const deleted = rows(await db.from('gallery_images').delete().eq('owner_id', session.userId).eq('id', match[1]).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

// ---------- 营养计划 ----------

const NUT_PLAN_COLS = 'id,name,description,kcal_target,protein_target,carb_target,fat_target,created_at';
const NUT_MEAL_COLS = 'id,plan_id,meal,name,sort';
const NUT_ITEM_COLS = 'id,meal_id,food_name,grams,kcal,protein,fat,carb,sort';

async function nutPlansGet({ db, session }) {
  const plans = rows(await db.from('nutrition_plans').select(NUT_PLAN_COLS).eq('owner_id', session.userId).order('created_at').limit(30));
  const meals = rows(await db.from('nutrition_meals').select(NUT_MEAL_COLS).eq('owner_id', session.userId).order('sort').limit(120));
  const items = rows(await db.from('nutrition_items').select(NUT_ITEM_COLS).eq('owner_id', session.userId).order('sort').limit(1000));
  const planIds = new Set(plans.map((p) => p.id));
  const mealsByPlan = new Map();
  for (const m of meals) {
    if (!planIds.has(m.plan_id)) continue;
    if (!mealsByPlan.has(m.plan_id)) mealsByPlan.set(m.plan_id, []);
    mealsByPlan.get(m.plan_id).push({ ...m, items: [] });
  }
  const mealIds = new Set([...mealsByPlan.values()].flat().map((m) => m.id));
  const itemsByMeal = new Map();
  for (const it of items) {
    if (!mealIds.has(it.meal_id)) continue;
    if (!itemsByMeal.has(it.meal_id)) itemsByMeal.set(it.meal_id, []);
    itemsByMeal.get(it.meal_id).push(it);
  }
  for (const list of mealsByPlan.values()) for (const m of list) m.items = itemsByMeal.get(m.id) ?? [];
  return json(plans.map((p) => ({ ...p, meals: mealsByPlan.get(p.id) ?? [] })));
}

async function nutPlansPost({ db, request, session }) {
  const body = await readJson(request);
  const row = {
    id: crypto.randomUUID(), owner_id: session.userId,
    name: boundedText(body?.name, 60),
    description: boundedText(body?.description ?? '', 300, { allowEmpty: true }),
    kcal_target: nullableIntIn(body?.kcal_target, 800, 6000),
    protein_target: nullableIntIn(body?.protein_target, 0, 400),
    carb_target: nullableIntIn(body?.carb_target, 0, 800),
    fat_target: nullableIntIn(body?.fat_target, 0, 300),
    created_at: new Date().toISOString(),
  };
  const created = rows(await db.from('nutrition_plans').insertIfAbsent(row, { onConflict: 'owner_id,id' }).select(NUT_PLAN_COLS));
  if (created.length !== 1) return errorJson('invalid_input', 503);
  return json({ ...created[0], meals: [] }, 201);
}

async function nutPlanPatch({ db, request, session, match }) {
  const id = match[1];
  await assertOwned(db, 'nutrition_plans', id, session.userId);
  const body = await readJson(request);
  const patch = {};
  if (body?.name !== undefined) patch.name = boundedText(body.name, 60);
  if (body?.description !== undefined) patch.description = boundedText(body.description, 300, { allowEmpty: true });
  if (body?.kcal_target !== undefined) patch.kcal_target = nullableIntIn(body.kcal_target, 800, 6000);
  if (body?.protein_target !== undefined) patch.protein_target = nullableIntIn(body.protein_target, 0, 400);
  if (body?.carb_target !== undefined) patch.carb_target = nullableIntIn(body.carb_target, 0, 800);
  if (body?.fat_target !== undefined) patch.fat_target = nullableIntIn(body.fat_target, 0, 300);
  if (Object.keys(patch).length === 0) throw new AppError('invalid_input', 400);
  const updated = rows(await db.from('nutrition_plans').update(patch).eq('owner_id', session.userId).eq('id', id).select(NUT_PLAN_COLS));
  if (updated.length !== 1) return errorJson('invalid_input', 503);
  return json(updated[0]);
}

async function nutPlanDelete({ db, session, match }) {
  const id = match[1];
  await assertOwned(db, 'nutrition_plans', id, session.userId);
  const meals = rows(await db.from('nutrition_meals').select('id').eq('owner_id', session.userId).eq('plan_id', id).limit(120));
  for (const m of meals) rows(await db.from('nutrition_items').delete().eq('owner_id', session.userId).eq('meal_id', m.id).select('id'));
  rows(await db.from('nutrition_meals').delete().eq('owner_id', session.userId).eq('plan_id', id).select('id'));
  const deleted = rows(await db.from('nutrition_plans').delete().eq('owner_id', session.userId).eq('id', id).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

async function nutMealsPost({ db, request, session, match }) {
  const planId = match[1];
  await assertOwned(db, 'nutrition_plans', planId, session.userId);
  const body = await readJson(request);
  const existing = rows(await db.from('nutrition_meals').select('id').eq('owner_id', session.userId).eq('plan_id', planId).limit(120));
  if (existing.length >= 8) throw new AppError('too_many_items', 400);
  const row = {
    id: crypto.randomUUID(), owner_id: session.userId, plan_id: planId,
    meal: oneOf(body?.meal, MEALS), name: boundedText(body?.name ?? '', 60, { allowEmpty: true }),
    sort: existing.length,
  };
  const created = rows(await db.from('nutrition_meals').insertIfAbsent(row, { onConflict: 'owner_id,id' }).select(NUT_MEAL_COLS));
  if (created.length !== 1) return errorJson('invalid_input', 503);
  return json({ ...created[0], items: [] }, 201);
}

async function nutMealPatch({ db, request, session, match }) {
  const id = match[1];
  await assertOwned(db, 'nutrition_meals', id, session.userId);
  const body = await readJson(request);
  const patch = {};
  if (body?.name !== undefined) patch.name = boundedText(body.name, 60, { allowEmpty: true });
  if (body?.meal !== undefined) patch.meal = oneOf(body.meal, MEALS);
  if (Object.keys(patch).length === 0) throw new AppError('invalid_input', 400);
  const updated = rows(await db.from('nutrition_meals').update(patch).eq('owner_id', session.userId).eq('id', id).select(NUT_MEAL_COLS));
  if (updated.length !== 1) return errorJson('invalid_input', 503);
  return json(updated[0]);
}

async function nutMealDelete({ db, session, match }) {
  const id = match[1];
  await assertOwned(db, 'nutrition_meals', id, session.userId);
  rows(await db.from('nutrition_items').delete().eq('owner_id', session.userId).eq('meal_id', id).select('id'));
  const deleted = rows(await db.from('nutrition_meals').delete().eq('owner_id', session.userId).eq('id', id).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

async function nutItemsPost({ db, request, session, match }) {
  const mealId = match[1];
  await assertOwned(db, 'nutrition_meals', mealId, session.userId);
  const body = await readJson(request);
  const existing = rows(await db.from('nutrition_items').select('id').eq('owner_id', session.userId).eq('meal_id', mealId).limit(200));
  if (existing.length >= 40) throw new AppError('too_many_items', 400);
  const grams = decimalStr(body?.grams, 5000, 1);
  if (Number(grams) <= 0) throw new AppError('invalid_input', 400);
  const row = {
    id: crypto.randomUUID(), owner_id: session.userId, meal_id: mealId,
    food_name: boundedText(body?.food_name, 80), grams,
    kcal: decimalStr(body?.kcal, 9000, 1), protein: decimalStr(body?.protein, 1000, 1),
    fat: decimalStr(body?.fat, 1000, 1), carb: decimalStr(body?.carb, 1000, 1),
    sort: existing.length,
  };
  const created = rows(await db.from('nutrition_items').insertIfAbsent(row, { onConflict: 'owner_id,id' }).select(NUT_ITEM_COLS));
  if (created.length !== 1) return errorJson('invalid_input', 503);
  return json(created[0], 201);
}

async function nutItemPatch({ db, request, session, match }) {
  const id = match[1];
  await assertOwned(db, 'nutrition_items', id, session.userId);
  const body = await readJson(request);
  const patch = {};
  if (body?.food_name !== undefined) patch.food_name = boundedText(body.food_name, 80);
  if (body?.grams !== undefined) { patch.grams = decimalStr(body.grams, 5000, 1); if (Number(patch.grams) <= 0) throw new AppError('invalid_input', 400); }
  if (body?.kcal !== undefined) patch.kcal = decimalStr(body.kcal, 9000, 1);
  if (body?.protein !== undefined) patch.protein = decimalStr(body.protein, 1000, 1);
  if (body?.fat !== undefined) patch.fat = decimalStr(body.fat, 1000, 1);
  if (body?.carb !== undefined) patch.carb = decimalStr(body.carb, 1000, 1);
  if (Object.keys(patch).length === 0) throw new AppError('invalid_input', 400);
  const updated = rows(await db.from('nutrition_items').update(patch).eq('owner_id', session.userId).eq('id', id).select(NUT_ITEM_COLS));
  if (updated.length !== 1) return errorJson('invalid_input', 503);
  return json(updated[0]);
}

async function nutItemDelete({ db, session, match }) {
  const deleted = rows(await db.from('nutrition_items').delete().eq('owner_id', session.userId).eq('id', match[1]).select('id'));
  if (deleted.length !== 1) return errorJson('not_found', 404);
  return json({ ok: true });
}

// ---------- 计划模板 / 高级训练法元数据 ----------

const PLAN_META_COLS = 'owner_id,plan_id,is_template,is_public,day_extras,item_extras,updated_at';

async function readPlanMeta(db, ownerId, planId) {
  const found = rows(await db.from('plan_meta').select(PLAN_META_COLS).eq('owner_id', ownerId).eq('plan_id', planId).limit(1));
  return found.length === 1 ? found[0] : null;
}

async function planMetaGet({ db, session, match }) {
  const planId = match[1];
  await assertOwned(db, 'plans', planId, session.userId);
  return json({ meta: await readPlanMeta(db, session.userId, planId) });
}

async function planMetaPatch({ db, request, session, match }) {
  const planId = match[1];
  await assertOwned(db, 'plans', planId, session.userId);
  const body = await readJson(request, 65536);
  const prev = await readPlanMeta(db, session.userId, planId);
  const row = {
    owner_id: session.userId, plan_id: planId,
    is_template: body?.is_template !== undefined ? body.is_template === true : (prev?.is_template ?? false),
    is_public: body?.is_public !== undefined ? body.is_public === true : (prev?.is_public ?? false),
    day_extras: body?.day_extras !== undefined ? validateExtras(body.day_extras, 210, 'day') : (prev?.day_extras ?? {}),
    item_extras: body?.item_extras !== undefined ? validateExtras(body.item_extras, 1500, 'item') : (prev?.item_extras ?? {}),
    updated_at: new Date().toISOString(),
  };
  const inserted = rows(await db.from('plan_meta').insertIfAbsent(row, { onConflict: 'owner_id,plan_id' }).select(PLAN_META_COLS));
  if (inserted.length === 1) return json(inserted[0]);
  const updated = rows(await db.from('plan_meta').update(row).eq('owner_id', session.userId).eq('plan_id', planId).select(PLAN_META_COLS));
  if (updated.length !== 1) return errorJson('invalid_input', 503);
  return json(updated[0]);
}

// 模板列表：自己的模板 + 他人公开的模板（function_backend 下 Function 可跨 owner 读，应用层判定公开性）。
async function templatesGet({ db, session }) {
  const metas = rows(await db.from('plan_meta').select('owner_id,plan_id,is_template,is_public')
    .eq('is_template', true).limit(200));
  const visible = metas.filter((m) => m.owner_id === session.userId || m.is_public === true);
  if (visible.length === 0) return json([]);
  const ids = visible.map((m) => m.plan_id);
  const plans = rows(await db.from('plans').select('id,owner_id,name,goal,created_at').limit(200));
  const byId = new Map(plans.map((p) => [p.id, p]));
  const out = [];
  for (const m of visible) {
    const p = byId.get(m.plan_id);
    if (!p) continue;
    out.push({ id: p.id, name: p.name, goal: p.goal, created_at: p.created_at, is_public: m.is_public, is_mine: p.owner_id === session.userId });
  }
  return json(out);
}

// 复制模板（自己的或他人公开的）为一个新自有计划。
async function templateCopy({ db, session, match }) {
  const srcId = match[1];
  const srcPlan = rows(await db.from('plans').select('id,owner_id,name,goal').eq('id', srcId).limit(1));
  if (srcPlan.length !== 1) return errorJson('not_found', 404);
  const src = srcPlan[0];
  const meta = await readPlanMeta(db, src.owner_id, srcId);
  const allowed = src.owner_id === session.userId || (meta?.is_template === true && meta?.is_public === true);
  if (!allowed) return errorJson('not_found', 404);

  const newPlanId = crypto.randomUUID();
  const created = rows(await db.from('plans').insertIfAbsent({
    id: newPlanId, owner_id: session.userId, name: `${src.name}（副本）`.slice(0, 60), goal: src.goal,
    created_at: new Date().toISOString(),
  }, { onConflict: 'owner_id,id' }).select('id,name,goal,created_at'));
  if (created.length !== 1) return errorJson('plan_unconfirmed', 503);

  const days = rows(await db.from('plan_days').select('id,day_index,name').eq('owner_id', src.owner_id).eq('plan_id', srcId).order('day_index').limit(210));
  const newDays = [];
  const dayExtras = {}, itemExtras = {};
  for (const d of days) {
    const nd = crypto.randomUUID();
    rows(await db.from('plan_days').insertIfAbsent({ id: nd, owner_id: session.userId, plan_id: newPlanId, day_index: d.day_index, name: d.name }, { onConflict: 'owner_id,id' }).select('id'));
    if (meta?.day_extras?.[d.id]) dayExtras[nd] = meta.day_extras[d.id];
    const items = rows(await db.from('plan_items').select('id,exercise_id,sort,sets,reps,weight').eq('owner_id', src.owner_id).eq('day_id', d.id).order('sort').limit(100));
    for (const it of items) {
      const ni = crypto.randomUUID();
      rows(await db.from('plan_items').insertIfAbsent({ id: ni, owner_id: session.userId, day_id: nd, exercise_id: it.exercise_id, sort: it.sort, sets: it.sets, reps: it.reps, weight: it.weight }, { onConflict: 'owner_id,id' }).select('id'));
      if (meta?.item_extras?.[it.id]) itemExtras[ni] = meta.item_extras[it.id];
    }
    newDays.push({ id: nd, plan_id: newPlanId, day_index: d.day_index, name: d.name, items: [] });
  }
  // 高级训练法设置随副本带走（重映射到新 id）；副本默认不公开、不作为模板。
  if (Object.keys(dayExtras).length > 0 || Object.keys(itemExtras).length > 0) {
    rows(await db.from('plan_meta').insertIfAbsent({
      owner_id: session.userId, plan_id: newPlanId, is_template: false, is_public: false,
      day_extras: dayExtras, item_extras: itemExtras, updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,plan_id' }).select('plan_id'));
  }
  return json({ ...created[0], days: newDays }, 201);
}

// ---------- 偏好 ----------

const PREF_COLS = 'owner_id,weight_unit,timezone,dashboard_layout,updated_at';
const DEFAULT_PREFS = { weight_unit: 'kg', timezone: 'Asia/Shanghai', dashboard_layout: [] };

async function prefsGet({ db, session }) {
  const found = rows(await db.from('preferences').select(PREF_COLS).eq('owner_id', session.userId).limit(1));
  if (found.length === 1) return json({ preferences: found[0] });
  return json({ preferences: { ...DEFAULT_PREFS, owner_id: session.userId } });
}

async function prefsPut({ db, request, session }) {
  const body = await readJson(request, 65536);
  const row = {
    owner_id: session.userId,
    weight_unit: oneOf(body?.weight_unit ?? 'kg', WEIGHT_UNITS),
    timezone: boundedText(body?.timezone ?? 'Asia/Shanghai', 64),
    dashboard_layout: validateDashboardLayout(body?.dashboard_layout),
    updated_at: new Date().toISOString(),
  };
  const inserted = rows(await db.from('preferences').insertIfAbsent(row, { onConflict: 'owner_id' }).select(PREF_COLS));
  if (inserted.length === 1) return json({ preferences: inserted[0] });
  const updated = rows(await db.from('preferences').update(row).eq('owner_id', session.userId).select(PREF_COLS));
  if (updated.length !== 1) return errorJson('profile_unconfirmed', 503);
  return json({ preferences: updated[0] });
}

// ---------- 路由表 ----------

const UUID_SEG = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const idRoute = (prefix) => new RegExp(`^/api/${prefix}/${UUID_SEG}$`);

const ROUTES = [
  { method: 'GET', path: '/api/health', auth: false, handle: () => json({ ok: true }) },
  { method: 'POST', path: '/api/register', auth: false, handle: ({ db, request }) => register(db, request) },
  { method: 'POST', path: '/api/login', auth: false, handle: ({ db, request }) => login(db, request) },
  { method: 'POST', path: '/api/logout', auth: false, handle: ({ db, request }) => logout(db, request) },
  { method: 'GET', path: '/api/me', auth: true, handle: async ({ db, session }) => json({ user: await loadUser(db, session.userId) }) },
  { method: 'GET', path: '/api/profile', auth: true, handle: profileGet },
  { method: 'PUT', path: '/api/profile', auth: true, handle: profilePut },
  { method: 'GET', path: '/api/plans', auth: true, handle: plansGet },
  { method: 'POST', path: '/api/plans', auth: true, handle: plansPost },
  { method: 'PATCH', path: idRoute('plans'), auth: true, handle: planPatch },
  { method: 'DELETE', path: idRoute('plans'), auth: true, handle: planDelete },
  { method: 'POST', path: new RegExp(`^/api/plans/${UUID_SEG}/days$`), auth: true, handle: daysPost },
  { method: 'PATCH', path: idRoute('days'), auth: true, handle: dayPatch },
  { method: 'DELETE', path: idRoute('days'), auth: true, handle: dayDelete },
  { method: 'POST', path: new RegExp(`^/api/days/${UUID_SEG}/items$`), auth: true, handle: itemsPost },
  { method: 'PATCH', path: idRoute('items'), auth: true, handle: itemPatch },
  { method: 'DELETE', path: idRoute('items'), auth: true, handle: itemDelete },
  { method: 'GET', path: '/api/logs', auth: true, handle: logsGet },
  { method: 'POST', path: '/api/logs', auth: true, handle: logsPost },
  { method: 'DELETE', path: idRoute('logs'), auth: true, handle: logDelete },
  { method: 'GET', path: '/api/weight', auth: true, handle: weightGet },
  { method: 'PUT', path: '/api/weight', auth: true, handle: weightPut },
  { method: 'DELETE', path: /^\/api\/weight\/\d{4}-\d{2}-\d{2}$/, auth: true, handle: weightDelete },
  { method: 'GET', path: '/api/diet', auth: true, handle: dietGet },
  { method: 'POST', path: '/api/diet', auth: true, handle: dietPost },
  { method: 'DELETE', path: idRoute('diet'), auth: true, handle: dietDelete },
  { method: 'GET', path: '/api/chat', auth: true, handle: chatGet },
  { method: 'POST', path: '/api/chat', auth: true, handle: chatPost },
  { method: 'DELETE', path: '/api/chat', auth: true, handle: chatDelete },
  // 测量围度
  { method: 'GET', path: '/api/measurements/categories', auth: true, handle: measCatsGet },
  { method: 'POST', path: '/api/measurements/categories', auth: true, handle: measCatsPost },
  { method: 'DELETE', path: idRoute('measurements/categories'), auth: true, handle: measCatDelete },
  { method: 'GET', path: '/api/measurements/entries', auth: true, handle: measEntriesGet },
  { method: 'POST', path: '/api/measurements/entries', auth: true, handle: measEntriesPost },
  { method: 'DELETE', path: idRoute('measurements/entries'), auth: true, handle: measEntryDelete },
  // 画廊
  { method: 'GET', path: '/api/gallery', auth: true, handle: galleryGet },
  { method: 'POST', path: '/api/gallery', auth: true, handle: galleryPost },
  { method: 'DELETE', path: idRoute('gallery'), auth: true, handle: galleryDelete },
  // 营养计划
  { method: 'GET', path: '/api/nutrition-plans', auth: true, handle: nutPlansGet },
  { method: 'POST', path: '/api/nutrition-plans', auth: true, handle: nutPlansPost },
  { method: 'PATCH', path: idRoute('nutrition-plans'), auth: true, handle: nutPlanPatch },
  { method: 'DELETE', path: idRoute('nutrition-plans'), auth: true, handle: nutPlanDelete },
  { method: 'POST', path: new RegExp(`^/api/nutrition-plans/${UUID_SEG}/meals$`), auth: true, handle: nutMealsPost },
  { method: 'PATCH', path: idRoute('nutrition-meals'), auth: true, handle: nutMealPatch },
  { method: 'DELETE', path: idRoute('nutrition-meals'), auth: true, handle: nutMealDelete },
  { method: 'POST', path: new RegExp(`^/api/nutrition-meals/${UUID_SEG}/items$`), auth: true, handle: nutItemsPost },
  { method: 'PATCH', path: idRoute('nutrition-items'), auth: true, handle: nutItemPatch },
  { method: 'DELETE', path: idRoute('nutrition-items'), auth: true, handle: nutItemDelete },
  // 模板 / 高级训练法 / 偏好
  { method: 'GET', path: new RegExp(`^/api/plans/${UUID_SEG}/meta$`), auth: true, handle: planMetaGet },
  { method: 'PATCH', path: new RegExp(`^/api/plans/${UUID_SEG}/meta$`), auth: true, handle: planMetaPatch },
  { method: 'GET', path: '/api/templates', auth: true, handle: templatesGet },
  { method: 'POST', path: new RegExp(`^/api/templates/${UUID_SEG}/copy$`), auth: true, handle: templateCopy },
  { method: 'GET', path: '/api/preferences', auth: true, handle: prefsGet },
  { method: 'PUT', path: '/api/preferences', auth: true, handle: prefsPut },
];

async function route(db, request, origin, env) {
  requireTrustedOrigin(request, origin);
  const path = applicationPath(request);
  const url = new URL(request.url);
  let methodMismatch = false;
  for (const r of ROUTES) {
    const match = typeof r.path === 'string' ? (path === r.path ? [] : null) : path.match(r.path);
    if (!match) continue;
    if (r.method !== request.method) { methodMismatch = true; continue; }
    const session = r.auth ? await requireSession(db, request) : null;
    return r.handle({ db, request, session, env, url, match });
  }
  if (methodMismatch) throw new AppError('method_not_allowed', 405);
  throw new AppError('not_found', 404);
}

// 依赖注入只用于本地测试；ctx 只用于取 request，不使用其中的平台身份。
export function createApplication({ db, origin, env }) {
  return async function handle(ctx) {
    try {
      return await route(db, ctx.request, typeof origin === 'function' ? origin() : origin, env);
    } catch (error) {
      if (error instanceof SessionRequired) return unauthorized(error.state);
      if (error instanceof AppError) return errorJson(error.code, error.status);
      return errorJson('service_unavailable', 503);
    }
  };
}