/* Gold Bandito — логика мини-аппа (механика Wild Bandito) */
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
if (tg && tg.ready) { tg.ready(); tg.expand(); }

// Высота вьюпорта, стабильная в WebView (фикс «шторек» в мини-аппе)
function setVh() {
  document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
}
setVh();
window.addEventListener('resize', setVh);
if (tg && tg.onEvent) {
  try { tg.onEvent('viewportChanged', setVh); } catch (e) {}
}
if (tg && tg.setHeaderColor) { try { tg.setHeaderColor('#140b26'); } catch (e) {} }
if (tg && tg.setBackgroundColor) { try { tg.setBackgroundColor('#140b26'); } catch (e) {} }
if (tg && tg.disableVerticalSwipes) { try { tg.disableVerticalSwipes(); } catch (e) {} }

const API = (window.GB_CONFIG && window.GB_CONFIG.apiBase) || '';
if (!API && tg && tg.showAlert) {
  setTimeout(() => tg.showAlert('Не задан apiBase в config.js — отредактируй файл после деплоя Worker.'), 300);
}

const DEMO = /[?&]demo=1/.test(location.search);

// ---------- демо-режим (?demo=1): локальный движок-заглушка ----------
const DEMO_SYMS = ['BANDIT','SKULL','TEQUILA','SOMBRERO','MARACAS','MONEYBAG','CACTUS','DYNAMITE','PISTOL','SPUR','GEM','COIN'];
const DEMO_PAYS = { BANDIT:3.4, SKULL:2.73, TEQUILA:1.64, SOMBRERO:1.23, MARACAS:0.82, MONEYBAG:0.75, CACTUS:0.61, DYNAMITE:0.47, PISTOL:0.55, SPUR:0.38, GEM:0.41, COIN:0.34 };

function demoGrid(rng) {
  return Array.from({ length: 20 }, () => {
    if (rng() < 0.07) return { sym: 'GUITAR', framed: false };
    return { sym: DEMO_SYMS[Math.floor(rng() * DEMO_SYMS.length)], framed: rng() < 0.06 };
  });
}

function demoWins(g) {
  const out = [];
  for (const sym of DEMO_SYMS) {
    let k = 0;
    for (let c = 0; c < 5; c++) {
      let has = false;
      for (let r = 0; r < 4; r++) {
        const cc = g[c + r * 5];
        if (cc && (cc.sym === sym || cc.sym === WILD)) has = true;
      }
      if (!has) break; k++;
    }
    if (k >= 3) out.push({ sym, k, pay: DEMO_PAYS[sym] * (k === 3 ? 1 : k === 4 ? 3.2 : 10) });
  }
  return out;
}

function demoSpin(bet) {
  const rng = Math.random;
  let g = demoGrid(rng);
  const initialGrid = g.slice();
  const tumbles = [];
  let round = 0;
  while (round++ < 12) {
    const wins = demoWins(g);
    if (!wins.length) break;
    const burns = new Set();
    let tw = 0;
    for (const w of wins) {
      tw += w.pay * bet;
      for (let i = 0; i < 20; i++) {
        if (i % 5 < w.k && g[i] && (g[i].sym === w.sym || g[i].sym === WILD)) burns.add(i);
      }
    }
    // сдвиг вниз + новые сверху + рамки→вайлды
    const next = new Array(20).fill(null);
    const newCells = [], wildsAt = [];
    for (let c = 0; c < 5; c++) {
      const survivors = [];
      for (let r = 0; r < 4; r++) {
        const idx = c + r * 5;
        if (!burns.has(idx)) survivors.push(g[idx]);
        else if (g[idx].framed) wildsAt.push(idx);
      }
      let rr = 3;
      for (let s = survivors.length - 1; s >= 0; s--) { next[c + rr * 5] = survivors[s]; rr--; }
      for (; rr >= 0; rr--) {
        const idx = c + rr * 5;
        const nc = rng() < 0.07 ? { sym: 'GUITAR', framed: false }
          : { sym: DEMO_SYMS[Math.floor(rng() * DEMO_SYMS.length)], framed: rng() < 0.06 };
        next[idx] = nc; newCells.push({ idx, sym: nc.sym, framed: nc.framed });
      }
    }
    for (const idx of wildsAt) {
      next[idx] = { sym: WILD, framed: false };
      newCells.push({ idx, sym: WILD, framed: false });
    }
    g = next;
    tumbles.push({ burns: [...burns], newCells, wildsAt, multiplier: 1, win: Math.round(tw * 100) / 100 });
  }
  return {
    initialGrid, tumbles, tumblesCount: tumbles.length,
    totalWin: Math.round(tumbles.reduce((a, t) => a + t.win, 0) * 100) / 100,
    scatters: 0, freeSpins: 0, freeSpinsWon: 0,
    balance: 1000, bonus: null,
  };
}

function demoState() {
  return {
    balance: 1000, spinsTotal: 5, isAdmin: true, nextBonusIn: 0, bonusAmount: 500,
    bonus: null, history: [], betSteps: state.betSteps, startBalance: 1000,
    paytable: DEMO_SYMS.map(s => ({ id: s, pays: { 3: DEMO_PAYS[s], 4: (DEMO_PAYS[s] * 3.2).toFixed(2), 5: (DEMO_PAYS[s] * 10).toFixed(2) } })),
  };
}

// ---------- ежедневный бонус ----------
async function claimBonus() {
  const btn = $('bonus-btn');
  btn.disabled = true;
  try {
    const initData = tg && tg.initData ? tg.initData : '';
    const res = await fetch(`${API}/api/bonus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData },
      body: '{}',
    });
    if (res.status === 401) { toast('Открой приложение из Telegram', true); return; }
    const data = await res.json();
    if (!res.ok) {
      const h = Math.floor((data.wait || 0) / 3600), m = Math.ceil(((data.wait || 0) % 3600) / 60);
      toast(h > 0 ? `Бонус будет доступен через ${h} ч` : `Бонус будет доступен через ${m} мин`);
      btn.classList.add('claimed');
      return;
    }
    updateBalance(data.balance);
    btn.classList.add('claimed');
    toast('+' + fmt(data.amount) + ' G — ежедневный бонус');
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  } catch (e) {
    toast('Ошибка соединения', true);
  } finally {
    btn.disabled = false;
  }
}
// ---------- админ-панель ----------
async function adminApi(path, opts) {
  const initData = tg && tg.initData ? tg.initData : '';
  const url = path.includes('?') ? path + '&d=' + encodeURIComponent(initData) : path + '?d=' + encodeURIComponent(initData);
  const res = await fetch(API + url, opts ? { ...opts, headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData, ...(opts.headers || {}) } } : undefined);
  if (res.status === 401) throw new Error('unauthorized');
  return res.json();
}

async function renderAdmin() {
  try {
    const data = await adminApi('/api/admin/users');
    const s = await adminApi('/api/admin/stats');
    const st = $('admin-stats');
    st.innerHTML = `
      <div class="stat-card"><span>ЮЗЕРОВ</span><b>${s.users ?? 0}</b></div>
      <div class="stat-card"><span>СПИНОВ</span><b>${s.spins ?? 0}</b></div>
      <div class="stat-card"><span>ПОСТАВЛЕНО</span><b>${fmt(s.staked || 0)} G</b></div>
      <div class="stat-card"><span>ВЫПЛАЧЕНО</span><b>${fmt(s.won || 0)} G</b></div>`;
    const list = $('admin-users');
    list.innerHTML = (data.users || []).map(u => `
      <li>
        <div class="au-name">${u.username ? '@' + u.username : 'id ' + u.telegram_id}
          <small>id ${u.telegram_id}${u.fs_remaining > 0 ? ' · ФС: ' + u.fs_remaining : ''}</small>
        </div>
        <div class="au-bal">${fmt(u.balance)} G</div>
        <button class="au-btn minus" data-tid="${u.telegram_id}" data-amt="-100"><svg><use href="#ui-minus"/></svg></button>
        <button class="au-btn" data-tid="${u.telegram_id}" data-amt="100"><svg><use href="#ui-plus"/></svg></button>
      </li>`).join('');
    list.querySelectorAll('.au-btn').forEach(b => b.addEventListener('click', async () => {
      const amt = Number(b.dataset.amt);
      b.disabled = true;
      try {
        const r = await adminApi('/api/admin/give', {
          method: 'POST', body: JSON.stringify({ telegramId: Number(b.dataset.tid), amount: amt }),
        });
        if (r.balance !== undefined) {
          b.closest('li').querySelector('.au-bal').textContent = fmt(r.balance) + ' G';
          toast((amt > 0 ? '+' : '') + amt + ' G → id ' + b.dataset.tid);
        } else toast(r.error || 'Ошибка', true);
      } catch (e) { toast('Ошибка соединения', true); }
      b.disabled = false;
    }));
  } catch (e) {
    $('admin-users').innerHTML = '<li class="history-empty">Нет доступа</li>';
  }
}

const WILD = 'WILD';
const SCATTER = 'GUITAR';
const CELL_COUNT = 20;

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const coinsLayer = $('coins-layer');

const state = {
  balance: 0,
  betSteps: [10, 50, 100, 500, 1000],
  betIndex: 2,
  spinning: false,
  auto: false,
  bonus: null,          // { remaining, multiplier, bet }
  paytable: [],
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('ru-RU');

function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 2400);
}

function setCell(idx, cellData, drop = false, delay = 0) {
  const cell = grid.children[idx];
  if (!cell) return;
  const { sym, framed } = typeof cellData === 'string' ? { sym: cellData, framed: false } : cellData;
  const cls = [
    'cell',
    framed ? 'framed' : '',
    sym === WILD ? 'wild' : '',
    sym === SCATTER ? 'scatter' : '',
    drop ? 'drop' : '',
  ].filter(Boolean).join(' ');
  cell.className = cls;
  cell.style.animationDelay = drop ? `${delay}ms` : '';
  cell.dataset.sym = sym;
  cell.innerHTML = `<svg><use href="#sym-${sym}"/></svg>`;
}

function renderGrid(cells, drop = false) {
  cells.forEach((c, idx) => setCell(idx, c, drop, drop ? (idx % 5) * 60 + Math.floor(idx / 5) * 50 : 0));
}

function randomGrid() {
  const ids = ['BANDIT', 'SKULL', 'TEQUILA', 'SOMBRERO', 'MARACAS', 'MONEYBAG',
    'CACTUS', 'DYNAMITE', 'PISTOL', 'SPUR', 'GEM', 'COIN'];
  return Array.from({ length: CELL_COUNT }, () => {
    const r = Math.random();
    if (r < 0.06) return { sym: SCATTER, framed: false };
    return { sym: ids[Math.floor(Math.random() * ids.length)], framed: Math.random() < 0.05 };
  });
}

function updateBalance(target) {
  const el = $('balance');
  const from = state.balance || 0;
  const diff = target - from;
  const t0 = performance.now();
  state.balance = target;
  function step(ts) {
    const k = Math.min(1, (ts - t0) / 500);
    const ease = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + diff * ease);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function updateBonusUI() {
  const badge = $('fs-badge');
  const spinLabel = document.querySelector('#spin .spin-label');
  const inBonus = !!(state.bonus && state.bonus.remaining > 0);
  if (inBonus) {
    $('fs-count').textContent = state.bonus.remaining;
    $('fs-mult').textContent = '×' + state.bonus.multiplier;
    badge.classList.remove('hidden');
    document.body.classList.add('fs-mode');
    $('spin').classList.add('free');
    spinLabel.textContent = 'ФРИСПИН';
    $('bet-minus').disabled = true;
    $('bet-plus').disabled = true;
  } else {
    state.bonus = null;
    badge.classList.add('hidden');
    document.body.classList.remove('fs-mode');
    $('spin').classList.remove('free');
    spinLabel.textContent = 'КРУТИТЬ';
    $('bet-minus').disabled = false;
    $('bet-plus').disabled = false;
  }
}

function flyCoins(n) {
  const rect = grid.getBoundingClientRect();
  const count = Math.min(14, 4 + n);
  for (let i = 0; i < count; i++) {
    const c = document.createElement('div');
    c.className = 'coin-particle';
    c.style.left = (20 + Math.random() * 60) + '%';
    c.style.top = (30 + Math.random() * 40) + '%';
    c.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
    c.style.setProperty('--dy', (120 + Math.random() * 160) + 'px');
    c.style.animationDelay = (Math.random() * 200) + 'ms';
    coinsLayer.appendChild(c);
    setTimeout(() => c.remove(), 1300);
  }
}

async function apiGet(path) {
  if (DEMO) return demoState();
  const initData = tg && tg.initData ? tg.initData : '';
  const res = await fetch(`${API}${path}?d=${encodeURIComponent(initData)}`);
  if (res.status === 401) throw new Error('unauthorized');
  return res.json();
}

async function apiSpin(bet) {
  if (DEMO) return demoSpin(bet);
  const initData = tg && tg.initData ? tg.initData : '';
  const res = await fetch(`${API}/api/spin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData },
    body: JSON.stringify({ bet }),
  });
  if (res.status === 401) throw new Error('unauthorized');
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error });
  return data;
}

// Локальная копия tumble-логики воркера — страховка от «зависших» пустых клеток.
// После каждого каскада сверяем DOM с расчётной сеткой и чиним расхождения.
function settledGrid(cur, t) {
  const next = cur.slice();
  for (let c = 0; c < 5; c++) {
    const survivors = [];
    for (let r = 0; r < 4; r++) {
      const idx = c + r * 5;
      if (!t.burns.includes(idx)) survivors.push(cur[idx]);
    }
    for (let r = 3, s = survivors.length - 1; r >= 0; r--, s--) {
      next[c + r * 5] = s >= 0 ? survivors[s] : null;
    }
  }
  for (const nc of (t.newCells || [])) next[nc.idx] = nc;
  return next;
}

function reconcileGrid(cells) {
  cells.forEach((c, idx) => {
    const cell = grid.children[idx];
    if (!cell || !c) return;
    const same = cell.dataset.sym === c.sym &&
      cell.classList.contains('framed') === !!c.framed;
    if (!same) setCell(idx, c, false);
  });
}

// ---------- анимация раунда ----------
async function showBanner(amount, mult, isFinal, big) {
  const banner = $('win-banner');
  const amountEl = $('win-amount');
  const multEl = $('win-mult');
  const fsEl = $('win-fs');
  fsEl.classList.add('hidden');
  amountEl.textContent = '+' + fmt(amount);
  amountEl.classList.toggle('big', !!big);
  amountEl.classList.remove('hidden');
  if (mult > 1) { multEl.textContent = 'множитель ×' + mult; multEl.classList.remove('hidden'); }
  else multEl.classList.add('hidden');
  banner.classList.remove('hidden');
  await sleep(isFinal ? 1400 : 620);
  if (!isFinal) banner.classList.add('hidden');
}

async function animateSpin(result) {
  $('last-win').textContent = '0';
  renderGrid(result.initialGrid, true);
  await sleep(520);

  let accWin = 0;
  let lastMult = 1;
  let curGrid = result.initialGrid.slice();

  for (const t of result.tumbles) {
    accWin += t.win;
    lastMult = Math.max(lastMult, t.multiplier || 1);

    // подсветка выигрышных символов
    for (const idx of t.burns) grid.children[idx].classList.add('hit');
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    await sleep(430);

    // рамки превращаются в вайлдов
    if (t.wildsAt && t.wildsAt.length) {
      for (const idx of t.wildsAt) {
        const cell = grid.children[idx];
        if (cell) cell.classList.add('become-wild');
      }
      await sleep(380);
    }

    // сгорание
    for (const idx of t.burns) {
      grid.children[idx].classList.remove('hit');
      grid.children[idx].classList.add('burn');
    }
    await sleep(340);

    // падение новых
    for (const nc of t.newCells) setCell(nc.idx, nc, true, (nc.idx % 5) * 45);
    curGrid = settledGrid(curGrid, t);
    await sleep(120);
    reconcileGrid(curGrid); // страховка: DOM обязан совпадать с расчётом

    // накопленный выигрыш шага
    $('last-win').textContent = fmt(accWin);
    await sleep(120);
    flyCoins(t.win);
    await showBanner(accWin, t.multiplier || 1, false, false);

    // множитель бонуса на бейдже
    if (state.bonus && (t.multiplier || 1) > 1) {
      state.bonus.multiplier = Math.max(state.bonus.multiplier, t.multiplier);
      updateBonusUI();
    }
  }
  $('win-banner').classList.add('hidden');

  // итоговый баннер
  if (result.totalWin > 0) {
    const big = result.totalWin >= betValue() * 20;
    if (big && tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    flyCoins(result.totalWin / 10);
    await showBanner(result.totalWin, lastMult, true, big);
  }
  $('win-banner').classList.add('hidden');

  // фриспины: интро нового бонуса или ретриггер
  const fsWon = result.freeSpinsWon || 0;
  if (fsWon >= 10) {
    const intro = $('fs-intro');
    $('fs-intro-count').textContent = fsWon + ' вращений · множитель растёт';
    intro.classList.remove('hidden');
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    await sleep(1800);
    intro.classList.add('hidden');
  } else if (fsWon > 0) {
    toast('+' + fsWon + ' фриспинов');
  }
}

function betValue() {
  return state.bonus && state.bonus.bet ? state.bonus.bet : state.betSteps[state.betIndex];
}

async function doSpin() {
  if (state.spinning) return;
  const inBonus = !!(state.bonus && state.bonus.remaining > 0);
  if (!inBonus && state.balance < betValue()) { toast('Недостаточно голды', true); return; }

  state.spinning = true;
  $('spin').disabled = true;
  $('spin').classList.add('spinning');
  try {
    const result = await apiSpin(inBonus ? 0 : betValue());
    const wasInBonus = inBonus;
    state.bonus = result.bonus && result.bonus.remaining > 0 ? result.bonus : null;
    updateBonusUI();
    await animateSpin(result);
    updateBalance(result.balance);
    if (!inBonus && result.totalWin === 0 && !result.bonus) $('last-win').textContent = '0';
  } catch (e) {
    if (e.code === 'insufficient_funds') toast('Недостаточно голды', true);
    else if (e.message === 'unauthorized') toast('Открой приложение из Telegram', true);
    else toast('Ошибка соединения, попробуй ещё раз', true);
    state.auto = false; $('auto').classList.remove('on');
    refreshState();
  } finally {
    $('spin').classList.remove('spinning');
    state.spinning = false;
    $('spin').disabled = false;
  }

  // авто-режим: продолжаем, пока есть баланс (или фриспины)
  const stillInBonus = !!(state.bonus && state.bonus.remaining > 0);
  if (state.auto && (stillInBonus || state.balance >= betValue())) {
    await sleep(500);
    if (state.auto) doSpin();
  } else if (stillInBonus && !state.auto) {
    toast(`Фриспины: ${state.bonus.remaining} — жми «Фриспин»`);
  } else {
    state.auto = false;
    $('auto').classList.remove('on');
  }
}

async function refreshState() {
  try {
    const s = await apiGet('/api/state');
    state.paytable = s.paytable || [];
    if (s.betSteps) state.betSteps = s.betSteps;
    state.bonus = s.bonus && s.bonus.remaining > 0 ? s.bonus : null;
    state.balance = s.balance;
    $('balance').textContent = fmt(s.balance);
    $('bet').textContent = fmt(betValue());
    renderHistory(s.history || []);
    renderPaytable();
    updateBonusUI();
    $('tab-admin').classList.toggle('hidden', !s.isAdmin);
    $('bonus-btn').classList.toggle('claimed', (s.nextBonusIn || 0) > 0);
  } catch (e) {
    renderGrid(randomGrid(), true);
    toast('Нет связи с сервером', true);
  }
}

function renderHistory(rows) {
  const list = $('history-list');
  if (!rows.length) {
    list.innerHTML = '<li class="history-empty">Спинов пока нет — крутани барабан</li>';
    return;
  }
  list.innerHTML = rows.map(r => {
    const cls = r.win > 0 ? 'pos' : 'zero';
    return `<li>
      <span class="h-bet">ставка ${fmt(r.bet)} G</span>
      <span class="h-win ${cls}">${r.win > 0 ? '+' + fmt(r.win) : '—'} G</span>
      <span class="h-date">${(r.created_at || '').slice(5, 16)}</span>
    </li>`;
  }).join('');
}

const SYM_NAMES = {
  BANDIT: 'Бандит', SKULL: 'Череп', TEQUILA: 'Текила', SOMBRERO: 'Сомбреро',
  MARACAS: 'Маракасы', MONEYBAG: 'Мешок', CACTUS: 'Кактус', DYNAMITE: 'Динамит',
  PISTOL: 'Револьвер', SPUR: 'Шпора', GEM: 'Камень', COIN: 'Монета',
};

function renderPaytable() {
  const tbl = $('paytable');
  tbl.innerHTML = '<tr><td></td><td class="symlbl">Символ</td><td>3</td><td>4</td><td>5</td></tr>' +
    state.paytable.map(s => {
      const p = s.pays;
      return `<tr>
        <td><svg><use href="#sym-${s.id}"/></svg></td>
        <td class="symlbl">${SYM_NAMES[s.id] || s.id}</td>
        <td>${p[3] ?? '—'}</td><td>${p[4] ?? '—'}</td><td>${p[5] ?? '—'}</td>
      </tr>`;
    }).join('') +
    `<tr><td><svg><use href="#sym-WILD"/></svg></td><td class="symlbl">Вайлд</td><td colspan="3" class="muted">заменяет любой символ</td></tr>
     <tr><td><svg><use href="#sym-GUITAR"/></svg></td><td class="symlbl">Гитара</td><td colspan="3" class="muted">3+ → 12 фриспинов</td></tr>`;
}

// ---------- обработчики ----------
$('spin').addEventListener('click', doSpin);

$('bet-minus').addEventListener('click', () => {
  state.betIndex = Math.max(0, state.betIndex - 1);
  $('bet').textContent = fmt(state.betSteps[state.betIndex]);
});
$('bet-plus').addEventListener('click', () => {
  state.betIndex = Math.min(state.betSteps.length - 1, state.betIndex + 1);
  $('bet').textContent = fmt(state.betSteps[state.betIndex]);
});

$('auto').addEventListener('click', () => {
  state.auto = !state.auto;
  $('auto').classList.toggle('on', state.auto);
  if (state.auto) doSpin();
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('screen-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'history') refreshState();
    if (tab.dataset.tab === 'admin') renderAdmin();
  });
});

// старт: 20 пустых ячеек + загрузка состояния
for (let i = 0; i < CELL_COUNT; i++) {
  const div = document.createElement('div');
  div.className = 'cell';
  grid.appendChild(div);
}
refreshState();
setTimeout(() => {
  if (!grid.children[0].innerHTML) renderGrid(randomGrid(), true);
}, 800);

$('bonus-btn').addEventListener('click', claimBonus);
