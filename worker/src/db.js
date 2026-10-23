// D1 (SQLite) — пользователи, спины, транзакции, состояние бонуса.

const USER_COLS = 'telegram_id, username, balance, spins, fs_remaining, fs_multiplier, fs_bet, created_at';

export async function ensureUser(env, telegramId, username = null) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO users (telegram_id, username) VALUES (?, ?)'
  ).bind(telegramId, username).run();
  return env.DB.prepare(
    `SELECT ${USER_COLS} FROM users WHERE telegram_id = ?`
  ).bind(telegramId).first();
}

export async function getBalance(env, telegramId) {
  const row = await env.DB.prepare('SELECT balance FROM users WHERE telegram_id = ?')
    .bind(telegramId).first();
  return row ? row.balance : null;
}

// Атомарное списание ставки: баланс уменьшается только если его хватает.
export async function placeBet(env, telegramId, bet) {
  const res = await env.DB.prepare(
    'UPDATE users SET balance = balance - ?, spins = spins + 1 WHERE telegram_id = ? AND balance >= ?'
  ).bind(bet, telegramId, bet).run();
  return res.meta.changes === 1;
}

// Итог спина одной транзакцией: запись, начисление, состояние бонуса.
export async function settleSpin(env, telegramId, bet, win, fs) {
  // fs: { remaining, multiplier, bet } — новое состояние бонуса юзера
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO spins (telegram_id, bet, win, multipliers) VALUES (?, ?, ?, ?)'
    ).bind(telegramId, bet, win, fs && fs.multiplier > 1 ? String(fs.multiplier) : null),
    env.DB.prepare(
      'UPDATE users SET balance = balance + ?, fs_remaining = ?, fs_multiplier = ?, fs_bet = ? WHERE telegram_id = ?'
    ).bind(win, fs ? fs.remaining : 0, fs ? fs.multiplier : 1, fs ? fs.bet : bet, telegramId),
    env.DB.prepare(
      "INSERT INTO transactions (telegram_id, amount, kind, note) VALUES (?, ?, 'spin', ?)"
    ).bind(telegramId, win - bet, `bet ${bet}`),
  ]);
}

// Пополнение админом (/give)
export async function adminGive(env, telegramId, amount, adminId) {
  await ensureUser(env, telegramId);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET balance = balance + ? WHERE telegram_id = ?')
      .bind(amount, telegramId),
    env.DB.prepare(
      "INSERT INTO transactions (telegram_id, amount, kind, note) VALUES (?, ?, 'topup_admin', ?)"
    ).bind(telegramId, amount, `by admin ${adminId}`),
  ]);
  return getBalance(env, telegramId);
}

export async function history(env, telegramId, limit = 20) {
  const { results } = await env.DB.prepare(
    'SELECT bet, win, multipliers, created_at FROM spins WHERE telegram_id = ? ORDER BY id DESC LIMIT ?'
  ).bind(telegramId, limit).all();
  return results || [];
}

export async function stats(env) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS users, (SELECT COUNT(*) FROM spins) AS spins FROM users'
  ).first();
  const sums = await env.DB.prepare(
    'SELECT COALESCE(SUM(bet),0) AS staked, COALESCE(SUM(win),0) AS won FROM spins'
  ).first();
  return { ...row, ...sums };
}
