// 仅用于本地演练的凭据无关假数据库（不打进 Function 包）。
// 复刻真实适配器语义：from().select()/insertIfAbsent()/update()/delete() 返回可链式、可 await 的构建器；
// order() 只接受普通列名（升序）。
// 写入结果控制（一次性）：control.mode = 'reject' | 'drop' 影响下一次写入；
// control.dropTable / control.rejectTable 只影响指定表的下一次写入。
// control.writes 记录每次写入尝试的表名，用于断言「不重放」。
// options.onChange：每次成功变更后回调（本地持久化用）。
/**
 * @param {{ mode?: string, dropTable?: string|null, rejectTable?: string|null, writes?: string[] }} [control]
 * @param {{ onChange?: () => void }} [options]
 */
export function createFakeDb(control = { mode: 'ok', dropTable: null, rejectTable: null, writes: [] }, options = {}) {
  if (!Array.isArray(control.writes)) control.writes = [];
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const tables = new Map();
  const rows = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  };
  const pick = (row, columns) => (columns === '*' || columns === null
    ? { ...row }
    : Object.fromEntries(columns.split(',').map((c) => [c.trim(), row[c.trim()]])));

  const takeMode = (table) => {
    if (control.dropTable === table) { control.dropTable = null; return 'drop'; }
    if (control.rejectTable === table) { control.rejectTable = null; return 'reject'; }
    const mode = control.mode ?? 'ok';
    control.mode = 'ok';
    return mode;
  };

  function builder(table, mode, values) {
    const filters = [];
    let columns = '*';
    let orderBy = null, maxRows = Infinity, execution;
    const run = () => {
      const list = rows(table);
      const match = (row) => filters.every(([key, value]) => row[key] === value);

      if (mode === 'read') {
        const selected = list.filter(match);
        if (orderBy) selected.sort((a, b) => String(a[orderBy]).localeCompare(String(b[orderBy])));
        return { data: selected.slice(0, maxRows).map((row) => pick(row, columns)), error: null };
      }

      control.writes.push(table);

      if (mode === 'insert') {
        const unique = (values.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
        if (unique.length && list.some((row) => unique.every((key) => row[key] === values.row[key]))) {
          return { data: [], error: null };
        }
        const writeMode = takeMode(table);
        if (writeMode === 'reject') return { data: null, error: { code: 'write_failed', status: 409 } };
        // 'drop'：数据已提交，只是响应没回来。
        list.push({ ...values.row });
        onChange();
        if (writeMode === 'drop') throw new Error('simulated response loss');
        return { data: [pick(values.row, columns)], error: null };
      }

      if (mode === 'delete') {
        const writeMode = takeMode(table);
        if (writeMode === 'reject') return { data: null, error: { code: 'write_failed', status: 409 } };
        const matched = list.filter(match);
        for (const row of matched) list.splice(list.indexOf(row), 1);
        onChange();
        if (writeMode === 'drop') throw new Error('simulated response loss');
        return { data: matched.map((row) => pick(row, columns)), error: null };
      }

      const writeMode = takeMode(table);
      if (writeMode === 'reject') return { data: null, error: { code: 'write_failed', status: 409 } };
      const matched = list.filter(match);
      for (const row of matched) Object.assign(row, values.row);
      onChange();
      if (writeMode === 'drop') throw new Error('simulated response loss');
      return { data: matched.map((row) => pick(row, columns)), error: null };
    };

    const chain = {
      eq(key, value) { filters.push([key, value]); return chain; },
      limit(count) { if (count > 1000) throw new RangeError('limit exceeds backend max 1000'); maxRows = count; return chain; },
      order(name) { orderBy = String(name); return chain; },
      select(names) { if (typeof names === 'string') columns = names; return chain; },
      then(resolve, reject) { execution ??= Promise.resolve().then(run); return execution.then(resolve, reject); },
    };
    return chain;
  }

  return {
    from(table) {
      return {
        select: (columns) => builder(table, 'read', null).select(columns),
        insertIfAbsent: (row, opts) => builder(table, 'insert', { row, onConflict: opts?.onConflict }),
        update: (row) => builder(table, 'update', { row }),
        delete: () => builder(table, 'delete', null),
      };
    },
    // 仅测试使用：读取/恢复原始行（例如断言不含明文口令、跨进程持久化）。
    dump: (table) => rows(table).map((row) => ({ ...row })),
    dumpAll: () => Object.fromEntries([...tables.entries()].map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
    loadAll: (data) => {
      tables.clear();
      for (const [k, v] of Object.entries(data ?? {})) tables.set(k, Array.isArray(v) ? v.map((r) => ({ ...r })) : []);
    },
  };
}