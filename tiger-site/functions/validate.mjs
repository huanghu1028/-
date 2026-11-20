// 输入规范化与有界校验。只做纯函数，不触碰数据库。
import { AppError } from './http.mjs';

export const USERNAME_MIN_CHARS = 3;
export const USERNAME_MAX_CHARS = 32;
export const PASSWORD_MIN_CHARS = 15;
export const PASSWORD_MAX_BYTES = 256;
export const TITLE_MAX_CHARS = 300;

// 规范用户名：去首尾空白 + 转小写后必须匹配严格字符集。
// 数据库在 username 上另有 UNIQUE 约束，规范形式是唯一性的判定依据。
export function canonicalUsername(raw) {
  if (typeof raw !== 'string') throw new AppError('invalid_username', 400);
  const canonical = raw.trim().toLowerCase();
  if (canonical.length < USERNAME_MIN_CHARS || canonical.length > USERNAME_MAX_CHARS) {
    throw new AppError('invalid_username', 400);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(canonical)) throw new AppError('invalid_username', 400);
  return canonical;
}

// 密码只做有界校验，绝不记录、绝不回显。长度按码点计，上限按 UTF-8 字节计。
export function validatePassword(raw) {
  if (typeof raw !== 'string') throw new AppError('invalid_password', 400);
  if ([...raw].length < PASSWORD_MIN_CHARS) throw new AppError('invalid_password', 400);
  if (new TextEncoder().encode(raw).length > PASSWORD_MAX_BYTES) throw new AppError('invalid_password', 400);
  return raw;
}

export function validateTitle(raw) {
  if (typeof raw !== 'string') throw new AppError('invalid_input', 400);
  const title = raw.trim();
  if (!title || [...title].length > TITLE_MAX_CHARS) throw new AppError('invalid_input', 400);
  return title;
}

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

// ---------- 业务校验 ----------

// 日历日期：平台迁移子集用 text 存 YYYY-MM-DD，这里做严格校验。
export function validateDate(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new AppError('invalid_date', 400);
  const ms = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new AppError('invalid_date', 400);
  if (new Date(ms).toISOString().slice(0, 10) !== raw) throw new AppError('invalid_date', 400);
  const year = Number(raw.slice(0, 4));
  if (year < 2000 || year > 2100) throw new AppError('invalid_date', 400);
  return raw;
}

// 非负十进制数：接受 number 或字符串，规范化为定点字符串（数据库以 text 存储）。
export function decimalStr(raw, max, scale, code = 'invalid_input') {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new AppError(code, 400);
  }
  return value.toFixed(scale);
}

export function intIn(raw, min, max, code = 'invalid_input') {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new AppError(code, 400);
  return value;
}

export function nullableIntIn(raw, min, max) {
  if (raw === null || raw === undefined || raw === '') return null;
  return intIn(raw, min, max);
}

// 有界文本：去首尾空白，按码点计长度；allowEmpty 时空串合法。
export function boundedText(raw, maxChars, { allowEmpty = false, code = 'invalid_input' } = {}) {
  if (typeof raw !== 'string') throw new AppError(code, 400);
  const text = raw.trim();
  if (!allowEmpty && !text) throw new AppError(code, 400);
  if ([...text].length > maxChars) throw new AppError(code, 400);
  return text;
}

export function oneOf(raw, allowed, code = 'invalid_input') {
  if (typeof raw !== 'string' || !allowed.includes(raw)) throw new AppError(code, 400);
  return raw;
}

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const ACTIVITIES = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
export const GENDERS = ['male', 'female', ''];

// 训练打卡明细（jsonb）：数组形状与逐项上限都在这里校验。
export function validateLogDetail(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 30) throw new AppError('invalid_input', 400);
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) throw new AppError('invalid_input', 400);
    return {
      exercise_id: intIn(item.exercise_id, 1, 1000000),
      name: boundedText(item.name, 120),
      sets: intIn(item.sets, 1, 20),
      reps: intIn(item.reps, 0, 200),
      weight: decimalStr(item.weight, 1000, 1),
      done_sets: intIn(item.done_sets, 0, 20),
    };
  });
}