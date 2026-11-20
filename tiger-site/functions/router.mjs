// tiger-减脂 应用路由：注册 / 登录 / 退出 / 当前用户 / 资料 / 计划 / 打卡 / 体重 / 饮食 / AI 教练。
// 应用身份一律来自本应用自己的会话校验（数据库中的会话摘要），
// 绝不使用 ctx.user、平台身份、Host 头或浏览器提交的 owner_id。
// 所有业务读写都带 owner_id 谓词；平台 RLS 负责租户隔离，这里负责用户级归属。
import { AppError, applicationPath, errorJson, json, readJson, requireTrustedOrigin, rows } from './http.mjs';
import {
  ACTIVITIES, GENDERS, MEALS, boundedText, canonicalUsername, decimalStr, intIn,
  nullableIntIn, oneOf, validateDate, validateLogDetail, validatePassword,
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
    .eq('owner_id', session.userId).order('sort').limit(1500));
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