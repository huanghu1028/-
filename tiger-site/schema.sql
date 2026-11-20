-- tiger-减脂 云端 schema（function_backend：accessPolicies 留空，平台生成固定私有策略）。
-- 只含平台支持的 DDL 子集：CREATE TABLE app.x / CREATE INDEX（普通列名）。
-- 小数与日期用 text，在 Function 内严格校验；列表用 jsonb。
-- 本文件放在项目根目录，不放进 functions/ 打包目录；通过迁移流程提交。

-- ===== 应用自管账号认证（与平台身份无关）=====

CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_iterations integer NOT NULL,
  created_at timestamptz NOT NULL
);

-- 只保存令牌摘要、用户 ID 与时间；明文会话令牌从不落库。
CREATE TABLE app.sessions (
  token_digest text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- 固定窗口限流：每键一行，唯一主键用于原子判定（并发安全）。
CREATE TABLE app.auth_limiter (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL
);

-- ===== 业务数据（全部 owner 隔离）=====

CREATE TABLE app.profiles (
  owner_id text PRIMARY KEY,
  display_name text NOT NULL,
  gender text NOT NULL,
  birth_year integer,
  height_cm integer,
  activity text NOT NULL,
  kcal_target integer,
  protein_target integer,
  updated_at timestamptz NOT NULL
);

CREATE TABLE app.plans (
  id uuid NOT NULL,
  owner_id text NOT NULL,
  name text NOT NULL,
  goal text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, id)
);

CREATE TABLE app.plan_days (
  id uuid NOT NULL,
  owner_id text NOT NULL,
  plan_id uuid NOT NULL,
  day_index integer NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX plan_days_plan_idx ON app.plan_days (owner_id, plan_id);

CREATE TABLE app.plan_items (
  id uuid NOT NULL,
  owner_id text NOT NULL,
  day_id uuid NOT NULL,
  exercise_id integer NOT NULL,
  sort integer NOT NULL,
  sets integer NOT NULL,
  reps integer NOT NULL,
  weight text NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX plan_items_day_idx ON app.plan_items (owner_id, day_id);

CREATE TABLE app.workout_logs (
  id uuid NOT NULL,
  owner_id text NOT NULL,
  log_date text NOT NULL,
  plan_name text NOT NULL,
  day_name text NOT NULL,
  detail jsonb NOT NULL,
  duration_min integer NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX workout_logs_owner_date_idx ON app.workout_logs (owner_id, log_date);

-- 同一天一条：自然主键支持幂等 upsert。
CREATE TABLE app.weight_entries (
  owner_id text NOT NULL,
  entry_date text NOT NULL,
  weight_kg text NOT NULL,
  note text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, entry_date)
);

CREATE TABLE app.diet_entries (
  id uuid NOT NULL,
  owner_id text NOT NULL,
  entry_date text NOT NULL,
  meal text NOT NULL,
  food_name text NOT NULL,
  grams text NOT NULL,
  kcal text NOT NULL,
  protein text NOT NULL,
  fat text NOT NULL,
  carb text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX diet_entries_owner_date_idx ON app.diet_entries (owner_id, entry_date);

CREATE TABLE app.chat_messages (
  id uuid NOT NULL,
  owner_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX chat_messages_owner_created_idx ON app.chat_messages (owner_id, created_at);