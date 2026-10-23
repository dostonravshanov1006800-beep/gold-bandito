/* Gold Bandito — логика мини-аппа (механика Wild Bandito) */
'use strict';

const tg = window.Telegram && window.Telegram.WebApp;
if (tg && tg.ready) { tg.ready(); tg.expand(); }

const API = (window.GB_CONFIG && window.GB_CONFIG.apiBase) || '';
if (!API && tg && tg.showAlert) {
  setTimeout(() => tg.showAlert('Не задан apiBase в config.js — отредактируй файл после деплоя Worker.'), 300);
}

const PREMIUM = ['BANDIT', 'SKULL'];
const WILD = 'WILD';
const SCATTER = 'GUITAR';
const CELL_COUNT = 20;

const $ = (id) => document.getElementById(id);
const grid = $('grid');

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
  t._h = setTimeout(() => t.classList.add('hidden'), 2200);
}

function setCell(idx, cellData, drop = false, delay = 0) {
  const cell = grid.children[idx];
  if (!cell) return;
  const { sym, framed } = typeof cellData === 'string' ? { sym: cellData, framed: false } : cellData;
  const cls = [
    'cell',
    PREMIUM.includes(sym) ? 'premium' : '',
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
  cells.forEach((c, idx) => setCell(idx, c, drop, drop ? (idx % 5) * 45 + Math.floor(idx / 5) * 35 : 0));
}

function randomGrid() {
  const ids = ['BANDIT', 'SKULL', 'TEQUILA', 'SOMBRERO', 'MARACAS', 'MONEYBAG',
    'CACTUS', 'DYNAMITE', 'PISTOL', 'SPUR', 'GEM', 'COIN'];
  return Array.from({ length: CELL_COUNT }, () => {
    let r = Math.random();
    if (r < 0.06) return { sym: SCATTER, framed: false };
    return { sym: ids[Math.floor(Math.random() * ids.length)], framed: Math.random() < 0.04 };
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
  if (state.bonus && state.bonus.remaining > 0) {
    badge.textContent = `Бонус: ${state.bonus.remaining} × ${state.bonus.multiplier}`;
    badge.classList.remove('hidden');
    $('spin').classList.add('free');
    $('bet-minus').disabled = true;
    $('bet-plus').disabled = true;
  } else {
    state.bonus = null;
    badge.classList.add('hidden');
    $('spin').classList.remove('free');
    $('bet-minus').disabled = false;
    $('bet-plus').disabled = false;
  }
}

async function apiGet(path) {
  const initData = tg && tg.initData ? tg.initData : '';
  const res = await fetch(`${API}${path}?d=${encodeURIComponent(initData)}`);
  if (res.status === 401) throw new Error('unauthorized');
  return res.json();
}

async function apiSpin(bet) {
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

// ---------- анимация раунда ----------
async function animateSpin(result) {
  renderGrid(result.initialGrid, true);
  await sleep(450);

  for (const t of result.tumbles) {
    for (const idx of t.burns) grid.children[idx].classList.add('hit');
    await sleep(430);

    // вайлды из золотых рамок
    if (t.wildsAt && t.wildsAt.length) {
      for (const idx of t.wildsAt) {
        const cell = grid.children[idx];
        if (cell) cell.classList.add('become-wild');
      }
      await sleep(400);
    }

    for (const idx of t.burns) {
      grid.children[idx].classList.remove('hit');
      grid.children[idx].classList.add('burn');
    }
    await sleep(320);

    // вместо сгоревших — новые (включая вайлды из рамок)
    for (const nc of t.newCells) setCell(nc.idx, nc, true, (nc.idx % 5) * 40);
    // множитель фриспина обновляется на бейдже после каждого каскада
    if (state.bonus && t.multiplier > 1) {
      state.bonus.multiplier = Math.max(state.bonus.multiplier, t.multiplier);
      updateBonusUI();
    }
    await sleep(400);
  }

  const banner = $('win-banner');
  const amountEl = $('win-amount');
  const multEl = $('win-mult');
  const fsEl = $('win-fs');

  if (result.totalWin > 0) {
    const big = result.totalWin >= betValue() * 20;
    amountEl.textContent = '+' + fmt(result.totalWin) + ' G';
    amountEl.classList.toggle('big', big);
    multEl.classList.add('hidden');
    fsEl.classList.add('hidden');
    banner.classList.remove('hidden');
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    await sleep(1200);
  }

  // бонус: активация фриспинов или ретриггер
  if (result.freeSpins > 0 || result.freeSpinsWon > 0) {
    const total = result.freeSpinsWon || result.freeSpins;
    amountEl.classList.add('hidden');
    multEl.classList.add('hidden');
    fsEl.textContent = total >= 12
      ? total + ' фриспинов!'
      : '+' + total + ' фриспинов!';
    fsEl.classList.remove('hidden');
    banner.classList.remove('hidden');
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    await sleep(1600);
  }
  banner.classList.add('hidden');
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
    state.bonus = result.bonus && result.bonus.remaining > 0 ? result.bonus : null;
    updateBonusUI();
    await animateSpin(result);
    updateBalance(result.balance);
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
    await sleep(600);
    if (state.auto) doSpin();
  } else if (stillInBonus && !state.auto) {
    // подсказка: остались фриспины — предложи крутить
    toast(`Фриспины: ${state.bonus.remaining} — жми «Крутить»`);
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
    updateBalance(s.balance);
    state.balance = s.balance;
    $('balance').textContent = fmt(s.balance);
    $('bet').textContent = fmt(betValue());
    renderHistory(s.history || []);
    renderPaytable();
    updateBonusUI();
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
