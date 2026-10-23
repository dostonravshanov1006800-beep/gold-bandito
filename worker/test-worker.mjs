// Интеграционный тест воркера с мок-D1 (без Cloudflare).
// Запуск: node test-worker.mjs
import worker from './src/index.js';
import crypto from 'node:crypto';

const BOT_TOKEN = '123456:TEST_TOKEN_ABCDEFG';
const ADMIN = '8396883978';

// ---- мок D1 (in-memory) ----
function makeDB() {
  const users = new Map();
  const spins = [];
  const txs = [];
  const exec = {
    'INSERT OR IGNORE INTO users': (b) => {
      if (!users.has(b[0])) users.set(b[0], {
        telegram_id: b[0], username: b[1], balance: 1000, spins: 0,
        fs_remaining: 0, fs_multiplier: 1, fs_bet: 100, created_at: 'now',
      });
      return { meta: { changes: users.has(b[0]) ? 0 : 1 } };
    },
  };
  function run(sql, b) {
    if (sql.startsWith('INSERT OR IGNORE')) return exec['INSERT OR IGNORE INTO users'](b);
    if (sql.startsWith('UPDATE users SET balance = balance - ?')) {
      const u = users.get(b[1]);
      if (u && u.balance >= b[0]) { u.balance -= b[0]; u.spins++; return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith('UPDATE users SET balance = balance + ?')) {
      const u = users.get(b[4]);
      u.balance += b[0]; u.fs_remaining = b[1]; u.fs_multiplier = b[2]; u.fs_bet = b[3];
      return { meta: { changes: 1 } };
    }
    throw new Error('unknown sql: ' + sql);
  }
  return {
    _users: users, _spins: spins,
    prepare(sql) {
      return {
        bind(...b) {
          if (sql.startsWith('SELECT telegram_id')) {
            return { first: async () => users.get(b[0]) ? { ...users.get(b[0]) } : null };
          }
          if (sql.startsWith('SELECT balance FROM')) {
            return { first: async () => users.get(b[0]) ? { balance: users.get(b[0]).balance } : null };
          }
          if (sql.startsWith('SELECT bet, win')) {
            return { all: async () => ({ results: spins.filter(s => s.telegram_id === b[0]).slice(-b[1]).reverse() }) };
          }
          if (sql.startsWith('SELECT last_bonus')) {
            return { first: async () => users.get(b[0]) ? { last_bonus: users.get(b[0]).last_bonus || 0 } : null };
          }
          if (sql.startsWith('SELECT COUNT(*)')) {
            return { first: async () => ({ users: users.size, spins: spins.length, staked: spins.reduce((a,s)=>a+s.bet,0), won: spins.reduce((a,s)=>a+s.win,0) }) };
          }
          return { run: async () => run(sql, b) };
        },
        run: async () => { throw new Error('bind first'); },
        first: async () => null, all: async () => ({ results: [] }),
      };
    },
    async batch(stmts) {
      // stmts уже забинжены моком через хак: пробуем выполнить как run
      for (const s of stmts) {
        // мок-stmt содержит скрытые sql+args
        await s._mockRun();
      }
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

// патчим prepare чтобы batch работал: оборачиваем bind-результаты
function patchDB(db) {
  db._charges = db._charges || new Map();
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const p = origPrepare(sql);
    p.bind = (...b) => {
      const bound = origPrepare(sql).bind(...b);
      bound._mockRun = async () => {
        if (sql.startsWith('INSERT INTO spins')) {
          db._spins.push({ telegram_id: b[0], bet: b[1], win: b[2], multipliers: b[3], created_at: 'now' });
        } else if (sql.startsWith('INSERT INTO transactions')) {
          /* ok */
        } else {
          runSql(sql, b);
        }
      };
      const run = async () => runSql(sql, b);
      return { ...bound, run, first: bound.first, all: bound.all };
    };
    return p;
  };
  function runSql(sql, b) {
    if (sql.startsWith('INSERT OR IGNORE')) {
      if (!db._users.has(b[0])) db._users.set(b[0], {
        telegram_id: b[0], username: b[1], balance: 1000, spins: 0,
        fs_remaining: 0, fs_multiplier: 1, fs_bet: 100, created_at: 'now' });
      return;
    }
    if (sql.startsWith('UPDATE users SET balance = balance - ?')) {
      const u = db._users.get(b[1]);
      if (u && u.balance >= b[0]) { u.balance -= b[0]; u.spins++; return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith('UPDATE users SET last_bonus')) {
      const uu = db._users.get(b[1]);
      if (uu) uu.last_bonus = b[0];
      return;
    }
    if (sql.startsWith('UPDATE users SET balance = balance + ?') && sql.includes('fs_remaining')) {
      const u = db._users.get(b[5] ?? b[4]);
      if (!u) throw new Error('no user ' + b);
      u.balance += b[0]; u.fs_remaining = b[1]; u.fs_multiplier = b[2]; u.fs_bet = b[3];
      if (b[4] !== undefined && sql.includes('fs_total')) u.fs_total = b[4];
      return;
    }
    if (sql.includes('last_bonus')) {
      const u = db._users.get(b[2]);
      if (!u) throw new Error('no user');
      u.balance += b[0]; u.last_bonus = b[1];
      return;
    }
    if (sql.startsWith('UPDATE users SET balance = balance + ?')) {
      const u = db._users.get(b[1]);
      if (!u) throw new Error('no user');
      u.balance += b[0];
      return;
    }
    if (sql.startsWith('INSERT INTO charges')) {
      if (db._charges.has(b[0])) throw new Error('UNIQUE constraint failed: charges.charge_id');
      db._charges.set(b[0], { telegram_id: b[1], amount: b[2] });
      return;
    }
    if (sql.startsWith('UPDATE users SET balance = balance + ? WHERE telegram_id = ? AND kind IS NULL')) { /* unused */ }
  }
  return db;
}

// ---- подписанный initData (алгоритм Telegram) ----
function makeInitData(userId) {
  const user = JSON.stringify({ id: userId, first_name: 'Tester', username: 'tester' });
  const params = new URLSearchParams();
  params.set('user', user);
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  params.set('query_id', 'AAF' + userId);
  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(pairs).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

// ---- тест ----
const env = {
  BOT_TOKEN,
  ADMIN_IDS: ADMIN,
  WEBHOOK_SECRET: 's3cret',
  WEBAPP_URL: 'https://example.com/',
  ALLOWED_ORIGINS: 'https://example.com',
  DB: patchDB(makeDB()),
};

async function call(path, opts = {}, initDataHeader = null) {
  const url = new URL('https://worker.example' + path);
  const headers = { ...(opts.headers || {}) };
  let req;
  if (opts.method === 'GET') {
    url.searchParams.set('d', INIT_DATA);
    req = new Request(url, { method: 'GET', headers });
  } else {
    req = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(initDataHeader ? { 'X-Init-Data': initDataHeader } : {}) },
      body: JSON.stringify(opts.body || {}),
    });
  }
  return worker.fetch(req, env, { waitUntil: () => {} });
}

const INIT_DATA = makeInitData(999001);
let failures = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'OK ' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + extra));
  if (!cond) failures++;
}

// 1. state
let res = await call('/api/state', { method: 'GET' });
const state = await res.json();
check('state: 200', res.status === 200, JSON.stringify(state));
check('state: стартовый баланс 1000', state.balance === 1000);
check('state: 12 символов в paytable', state.paytable.length === 12);

// 2. подделка подписи
res = await call('/api/spin', { body: { bet: 100 } }, INIT_DATA.replace(/.$/, 'x'));
check('spin с битой подписью отклонён', res.status === 401);

// 3. обычный спин
res = await call('/api/spin', { body: { bet: 100 } }, INIT_DATA);
const r1 = await res.json();
check('spin: 200', res.status === 200, JSON.stringify(r1).slice(0, 200));
const expected = 1000 - 100 + r1.totalWin;
check('spin: баланс = 1000 - 100 + win', Math.abs(r1.balance - expected) < 0.01, `${r1.balance} vs ${expected}`);
check('spin: сетка 20 клеток', r1.initialGrid.length === 20);
check('spin: индексы каскадов валидны', r1.tumbles.every(t => t.burns.every(i => i >= 0 && i < 20)));

// 4. недостаточно средств
const u = env.DB._users.get(999001);
u.balance = 5;
res = await call('/api/spin', { body: { bet: 100 } }, INIT_DATA);
check('spin при нехватке: 402', res.status === 402);
u.balance = 1000;

// 5. неверная ставка
res = await call('/api/spin', { body: { bet: 777 } }, INIT_DATA);
check('spin с кривой ставкой: 400', res.status === 400);

// 6. фриспин: юзер в бонусе
u.fs_remaining = 3; u.fs_multiplier = 4; u.fs_bet = 500; u.balance = 1000;
const balBefore = u.balance;
res = await call('/api/spin', { body: {} }, INIT_DATA);
const fs = await res.json();
check('фриспин: 200', res.status === 200);
check('фриспин: ставка не списана', Math.abs(fs.balance - (balBefore + fs.totalWin)) < 0.01, `${fs.balance} vs ${balBefore + fs.totalWin}`);
check('фриспин: остаток уменьшился', fs.bonus.remaining === 2 || fs.freeSpinsWon > 0, `remaining=${fs.bonus.remaining}, retrig=${fs.freeSpinsWon}`);
check('фриспин: множитель сохранился/вырос', fs.bonus.multiplier >= 4, `mult=${fs.bonus.multiplier}`);
check('фриспин: каскады с множителем', fs.tumbles.every(t => t.multiplier >= 4));

// 7. длинная серия: инвариант баланса
u.balance = 1000; u.fs_remaining = 0; u.fs_multiplier = 1;
let bal = 1000;
for (let i = 0; i < 50; i++) {
  res = await call('/api/spin', { body: { bet: 100 } }, INIT_DATA);
  const r = await res.json();
  if (res.status === 402) { bal = 1000; u.balance = 1000; continue; }
  bal = bal - 100 + r.totalWin;
  if (r.bonus) {
    // прогоняем бонус до конца
    for (let f = 0; f < 200 && u.fs_remaining > 0; f++) {
      const rr = await call('/api/spin', { body: {} }, INIT_DATA);
      const rd = await rr.json();
      bal += rd.totalWin;
    }
  }
  if (Math.abs(u.balance - bal) > 0.01) {
    check('инвариант баланса на шаге ' + i, false, `db=${u.balance} expected≈${bal}`);
    break;
  }
}
check('инвариант баланса за 50 спинов + бонусы', Math.abs(u.balance - bal) < 0.02, `db=${u.balance} vs ${bal}`);

// 8. оплата Stars: pre-checkout, зачисление, идемпотентность дубликата
const origFetch = globalThis.fetch;
const tgCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) {
    tgCalls.push({ method: u.split('/').pop(), body: JSON.parse(opts.body || '{}') });
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  }
  return origFetch(url, opts);
};
import { handleUpdate } from './src/bot.js';
const payer = { id: 888001, first_name: 'Payer', username: 'payer' };
env.DB._users.set(payer.id, { telegram_id: payer.id, username: payer.username, balance: 1000, spins: 0, fs_remaining: 0, fs_multiplier: 1, fs_bet: 100, created_at: 'now' });
const pu = env.DB._users.get(payer.id);
// pre-checkout подтверждается
let upd = await handleUpdate(env, { pre_checkout_query: { id: 'pcq1' } });
check('pre-checkout: подтверждён', tgCalls.at(-1)?.method === 'answerPreCheckoutQuery' && tgCalls.at(-1)?.body.ok === true);

// успешная оплата 25 звёзд → +1000 G
const payment = (charge) => ({
  message: {
    chat: { id: payer.id }, from: payer,
    successful_payment: {
      invoice_payload: 'topup:1000:25', total_amount: 25,
      telegram_payment_charge_id: charge,
    },
  },
});
await handleUpdate(env, payment('chg-AAA'));
check('оплата: начислено 1000 G', pu.balance === 2000, `balance=${pu.balance}`);
check('оплата: сообщение отправлено', /Начислено 1000 G/.test(tgCalls.at(-1)?.body?.text || ''));

// повторная доставка того же платежа — задвоения нет
await handleUpdate(env, payment('chg-AAA'));
check('дубликат webhook: голда не задвоилась', pu.balance === 2000, `balance=${pu.balance}`);

// оплата без charge_id игнорируется
await handleUpdate(env, {
  message: { chat: { id: payer.id }, from: payer, successful_payment: { invoice_payload: 'topup:1000:25', total_amount: 25 } },
});
check('без charge_id: зачисления нет', pu.balance === 2000, `balance=${pu.balance}`);

globalThis.fetch = origFetch;

console.log(failures === 0 ? '\nВСЕ ТЕСТЫ ПРОЙДЕНЫ' : `\n${failures} ПРОВАЛОВ`);
process.exit(failures === 0 ? 0 : 1);
