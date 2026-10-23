/* Gold Bandito — логика мини-аппа (механика слота) */
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
      $('bonus-btn').classList.add('claimed'); $('bonus-btn').classList.remove('ready');
      toast(h > 0 ? `Бонус будет доступен через ${h} ч` : `Бонус будет доступен через ${m} мин`);
      btn.classList.add('claimed');
      return;
    }
    updateBalance(data.balance);
    btn.classList.add('claimed'); btn.classList.remove('ready');
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
    const tx = await adminApi('/api/admin/tx');
    adminCache = { users: data.users || [], tx: tx.tx || [] };

    const rtp = s.staked > 0 ? (s.won / s.staked * 100).toFixed(1) : '—';
    const pnl = (s.staked || 0) - (s.won || 0);
    $('admin-stats').innerHTML = `
      <div class="stat-card"><span>ЮЗЕРОВ</span><b>${s.users ?? 0}</b></div>
      <div class="stat-card"><span>СПИНОВ</span><b>${s.spins ?? 0}</b></div>
      <div class="stat-card"><span>ОБОРОТ</span><b class="long">${fmtCompact(s.staked || 0)} G</b></div>
      <div class="stat-card"><span>ВЫПЛАЧЕНО</span><b class="long">${fmtCompact(s.won || 0)} G</b></div>
      <div class="stat-card"><span>RTP ФАКТ</span><b>${rtp}%</b></div>
      <div class="stat-card"><span>ПРИБЫЛЬ</span><b class="long">${fmtCompact(pnl)} G</b></div>`;

    renderAdminUsers($('admin-search').value.trim().toLowerCase());
    renderAdminTx();
  } catch (e) {
    $('admin-users').innerHTML = '<li class="history-empty">Нет доступа</li>';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderAdminUsers(q) {
  const users = adminCache.users.filter(u =>
    !q || String(u.username || '').toLowerCase().includes(q) || String(u.telegram_id).includes(q)
  );
  $('admin-count').textContent = '(' + users.length + ')';
  $('admin-users').innerHTML = users.map(u => `
    <li class="au-card">
      <div class="au-top">
        <div class="au-name">${u.username ? '@' + esc(u.username) : 'id ' + u.telegram_id}
          ${String(u.telegram_id).startsWith('999999') ? '<span class="au-badge-test">TEST</span>' : ''}
          <small>id ${u.telegram_id} · спинов: ${u.spins ?? 0}${u.fs_remaining > 0 ? ' · ФС: ' + u.fs_remaining : ''}</small>
        </div>
        <div class="au-bal" id="au-bal-${u.telegram_id}">${fmt(u.balance)} G</div>
      </div>
      <div class="au-actions">
        <button class="au-btn minus" data-tid="${u.telegram_id}" data-amt="-10000">−10K</button>
        <button class="au-btn minus" data-tid="${u.telegram_id}" data-amt="-1000">−1K</button>
        <button class="au-btn" data-tid="${u.telegram_id}" data-amt="1000">+1K</button>
        <button class="au-btn" data-tid="${u.telegram_id}" data-amt="10000">+10K</button>
        <button class="au-btn au-own" data-tid="${u.telegram_id}">Своя</button>
      </div>
      <div class="au-custom hidden" id="au-custom-${u.telegram_id}">
        <input type="number" inputmode="numeric" placeholder="Сумма ±" id="au-amt-${u.telegram_id}">
        <button data-tid="${u.telegram_id}" class="au-apply">Начислить</button>
      </div>
    </li>`).join('') || '<li class="history-empty">Никого не найдено</li>';
  $('admin-users').querySelectorAll('.au-btn').forEach(b => b.addEventListener('click', async () => {
    const tid = b.dataset.tid;
    if (b.classList.contains('au-own')) {
      const row = $('au-custom-' + tid);
      row.classList.toggle('hidden');
      return;
    }
    const amt = Number(b.dataset.amt);
    b.disabled = true;
    try {
      const r = await adminApi('/api/admin/give', {
        method: 'POST', body: JSON.stringify({ telegramId: Number(tid), amount: amt }),
      });
      if (r.balance !== undefined) {
        const el = $('au-bal-' + tid);
        if (el) el.textContent = fmt(r.balance) + ' G';
        toast((amt > 0 ? '+' : '') + fmt(amt) + ' G → id ' + tid);
      } else toast(r.error || 'Ошибка', true);
    } catch (e) { toast('Ошибка соединения', true); }
    b.disabled = false;
  }));
  $('admin-users').querySelectorAll('.au-apply').forEach(b => b.addEventListener('click', async () => {
    const tid = b.dataset.tid;
    const raw = $('au-amt-' + tid).value.trim();
    const amt = Number(raw.replace(',', '.'));
    if (!raw || !Number.isFinite(amt) || amt === 0) { toast('Введи сумму, например 500 или -500', true); return; }
    b.disabled = true;
    try {
      const r = await adminApi('/api/admin/give', {
        method: 'POST', body: JSON.stringify({ telegramId: Number(tid), amount: amt }),
      });
      if (r.balance !== undefined) {
        const el = $('au-bal-' + tid);
        if (el) el.textContent = fmt(r.balance) + ' G';
        toast((amt > 0 ? '+' : '') + fmt(amt) + ' G → id ' + tid);
        $('au-custom-' + tid).classList.add('hidden');
        $('au-amt-' + tid).value = '';
      } else toast(r.error || 'Ошибка', true);
    } catch (e) { toast('Ошибка соединения', true); }
    b.disabled = false;
  }));
}

function renderAdminTx() {
  const KIND_RU = { topup_admin: 'Админ', bonus_daily: 'Бонус', spin: 'Спин', topup_stars: 'Пополнение' };
  $('admin-tx').innerHTML = adminCache.tx.map(t => `
    <li>
      <span class="tx-who">${t.username ? '@' + esc(t.username) : 'id ' + t.telegram_id}
        <span class="tx-kind"> · ${KIND_RU[t.kind] || t.kind}</span></span>
      <span class="tx-amt ${t.amount >= 0 ? 'plus' : 'minus'}">${t.amount >= 0 ? '+' : ''}${fmt(t.amount)} G</span>
    </li>`).join('') || '<li class="history-empty">Операций пока нет</li>';
}

const WILD = 'WILD';
const SCATTER = 'GUITAR';
const CELL_COUNT = 20;

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const coinsLayer = $('coins-layer');

const state = {
  balance: 0,
  betSteps: [10, 50, 100, 500, 1000, 2500, 5000, 10000],
  betIndex: 2,
  spinning: false,
  auto: false,
  bonus: null,          // { remaining, multiplier, bet }
  paytable: [],
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('ru-RU');

// компактный формат: 10 000 → 10K, 1 250 000 → 1,25M — чтобы панели не разрывало
const fmtCompact = (n) => {
  const a = Math.abs(n);
  const dec = (v, d) => v.toFixed(d).replace('.', ',').replace(/,0$/, '');
  if (a >= 1e9) return dec(n / 1e9, a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return dec(n / 1e6, a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return Math.round(n / 1e3) + 'K';
  if (a >= 1e3) return dec(n / 1e3, 1) + 'K';
  return String(Math.round(n * 10) / 10);
};

// ---------- синтезированные звуки (без файлов) + mute ----------
let audioCtx = null;
let soundOn = localStorage.getItem('gb-sound') !== '0';
function sfx(kind) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const tone = (f, st, dur, type, vol) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(vol || .1, t + st);
      g.gain.exponentialRampToValueAtTime(.0001, t + st + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t + st); o.stop(t + st + dur + .03);
    };
    if (kind === 'spin') { tone(190, 0, .16, 'square', .04); tone(150, .12, .2, 'square', .04); }
    if (kind === 'win') { tone(659, 0, .12); tone(880, .09, .18); }
    if (kind === 'big') { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * .11, .34)); }
    if (kind === 'coin') { tone(1568, 0, .06, 'triangle', .05); }
    if (kind === 'tick') { tone(330, 0, .05, 'square', .03); }
  } catch (e) {}
}

function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 2400);
}

// предзагрузка арта символов
const PRELOAD = ['bandit','skull','tequila','sombrero','maracas','moneybag','cactus','dynamite','pistol','spur','gem','coin','wild','guitar'];
PRELOAD.forEach(s => { const i = new Image(); i.src = `sym/${s}.png`; });

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
  cell.innerHTML = `<img src="sym/${sym.toLowerCase()}.png" alt="" draggable="false">`;
}

function renderGrid(cells, drop = false) {
  // колонки стартуют слева направо с шагом ~90мс, сверху вниз — «дождь» символов
  cells.forEach((c, idx) => setCell(idx, c, drop, drop ? (idx % 5) * 90 + Math.floor(idx / 5) * 35 : 0));
}

// ---------- движущийся множитель каскадов: бейдж НАД рамой, ячейки не задевает ----------
let cmTimer = null;
function showCascadeMult(x, label) {
  const el = $('cascade-mult');
  el.querySelector('.cm-label').textContent = label;
  el.querySelector('.cm-x').textContent = '×' + x;
  el.classList.add('show');
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  clearTimeout(cmTimer);
  cmTimer = setTimeout(() => el.classList.remove('show'), 1100);
}
function hideCascadeMult() {
  clearTimeout(cmTimer);
  $('cascade-mult').classList.remove('show');
}
function burstAt(cell) {
  const r = cell.getBoundingClientRect(), br = grid.getBoundingClientRect();
  for (let i = 0; i < 4; i++) {
    const c = document.createElement('div');
    c.className = 'coin-particle';
    c.style.left = ((r.left - br.left + r.width / 2) / br.width * 100) + '%';
    c.style.top = ((r.top - br.top + r.height / 2) / br.height * 100) + '%';
    c.style.setProperty('--dx', (Math.random() * 130 - 65) + 'px');
    c.style.setProperty('--dy', (Math.random() * 130 - 65) + 'px');
    c.style.animationDelay = (Math.random() * 80) + 'ms';
    coinsLayer.appendChild(c);
    setTimeout(() => c.remove(), 1300);
  }
}
async function showBigWin(amount, title) {
  const bw = $('bigwin');
  $('bw-title').textContent = title;
  countUp($('bw-amount'), amount, 1100);
  bw.classList.remove('hidden');
  document.body.classList.add('bw-shake');
  sfx('big');
  const coins = $('bw-coins');
  let n = 0;
  const rain = setInterval(() => {
    if (n++ > 44) return clearInterval(rain);
    const c = document.createElement('div');
    c.className = 'coin-particle';
    c.style.left = (Math.random() * 96) + '%';
    c.style.top = '-6%';
    c.style.setProperty('--dx', (Math.random() * 50 - 25) + 'px');
    c.style.setProperty('--dy', (window.innerHeight * .95) + 'px');
    c.style.animationDelay = '0ms';
    coins.appendChild(c);
    setTimeout(() => c.remove(), 1600);
  }, 55);
  let closed = false;
  bw.addEventListener('click', () => { closed = true; }, { once: true });
  const t0 = performance.now();
  while (!closed && performance.now() - t0 < 3800) await sleep(90);
  bw.classList.add('hidden');
  document.body.classList.remove('bw-shake');
  coins.innerHTML = '';
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
  el.title = fmt(target) + ' G';
  function step(ts) {
    const k = Math.min(1, (ts - t0) / 500);
    const ease = 1 - Math.pow(1 - k, 3);
    el.textContent = fmtCompact(from + diff * ease);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function updateFsTotal(v) {
  $('fs-total-val').textContent = fmt(v);
}

function updateBonusUI() {
  const badge = $('fs-badge');
  const totalChip = $('fs-total');
  const spinLabel = document.querySelector('#spin .spin-label');
  const inBonus = !!(state.bonus && state.bonus.remaining > 0);
  if (inBonus) {
    $('fs-count').textContent = state.bonus.remaining;
    $('fs-mult').textContent = '×' + state.bonus.multiplier;
    updateFsTotal(state.bonus.total || 0);
    totalChip.classList.remove('hidden');
    badge.classList.remove('hidden');
    document.body.classList.add('fs-mode');
    $('spin').classList.add('free');
    spinLabel.textContent = 'ФРИСПИН';
    $('bet-minus').disabled = true;
    $('bet-plus').disabled = true;
  } else {
    state.bonus = null;
    totalChip.classList.add('hidden');
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

async function fetchJson(url, opts, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); }
    catch (e) { if (i === tries - 1) throw e; await sleep(900); }
  }
}

async function apiGet(path) {
  const initData = tg && tg.initData ? tg.initData : '';
  const res = await fetchJson(`${API}${path}?d=${encodeURIComponent(initData)}`, undefined, 3);
  if (res.status === 401) throw new Error('unauthorized');
  return res.json();
}

async function apiSpin(bet) {
  const initData = tg && tg.initData ? tg.initData : '';
  const res = await fetchJson(`${API}/api/spin`, {
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
  amountEl.classList.toggle('big', !!big);
  countUp(amountEl, amount, big ? 900 : 380);
  amountEl.classList.remove('hidden');
  if (mult > 1) { multEl.textContent = 'множитель ×' + mult; multEl.classList.remove('hidden'); }
  else multEl.classList.add('hidden');
  banner.classList.add('show');
  amountEl.style.animation = 'none';
  void amountEl.offsetWidth;
  amountEl.style.animation = '';
  await sleep(isFinal ? 1700 : 700);
  if (!isFinal) banner.classList.remove('show');
}

function countUp(el, target, ms) {
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = '+' + fmt(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function animateSpin(result) {
  $('last-win').textContent = '0';

  // мягкий «вывоз» текущих символов вниз, как в оригинале
  const base = state.bonus
    ? (result.bonusEnd ? result.bonusEnd.total : state.bonus.total || 0) - result.totalWin
    : 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const c = grid.children[i];
    if (!c || !c.innerHTML) continue;
    c.style.animationDelay = (i % 5) * 45 + 'ms';
    c.classList.add('out');
  }
  await sleep(300);
  renderGrid(result.initialGrid, true);
  await sleep(560);

  let accWin = 0;
  let lastMult = 1;
  let curGrid = result.initialGrid.slice();
  hideCascadeMult();
  $('fs-tag').classList.toggle('hidden', !state.bonus);

  for (let ti = 0; ti < result.tumbles.length; ti++) {
    const t = result.tumbles[ti];
    accWin += t.win;
    lastMult = Math.max(lastMult, t.multiplier || 1);

    // движущийся множитель: серия в базе, множитель в бонусе
    if (t.win > 0) {
      const stepVal = state.bonus ? (t.multiplier || 1) : (ti + 1);
      showCascadeMult(stepVal, state.bonus ? 'МНОЖИТЕЛЬ' : 'СЕРИЯ');
      const frame = document.querySelector('.board-frame');
      frame.classList.remove('quake'); void frame.offsetWidth; frame.classList.add('quake');
      sfx('win');
    }

    // подсветка выигрышных символов
    for (const idx of t.burns) grid.children[idx].classList.add('hit');
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    await sleep(470);

    // рамки превращаются в вайлдов
    if (t.wildsAt && t.wildsAt.length) {
      for (const idx of t.wildsAt) {
        const cell = grid.children[idx];
        if (cell) cell.classList.add('become-wild');
      }
      await sleep(430);
    }

    // сгорание + золотые брызги из каждой ячейки
    for (const idx of t.burns) {
      const cellEl = grid.children[idx];
      cellEl.classList.remove('hit');
      cellEl.classList.add('burn');
      burstAt(cellEl);
    }
    sfx('coin');
    await sleep(390);

    // падение новых
    for (const nc of t.newCells) setCell(nc.idx, nc, true, (nc.idx % 5) * 60);
    curGrid = settledGrid(curGrid, t);
    // уцелевшие, которые сместились вниз, тоже падают с физикой
    const newIdxs = new Set(t.newCells.map(n => n.idx));
    for (let idx = 0; idx < CELL_COUNT; idx++) {
      if (newIdxs.has(idx)) continue;
      const cellEl = grid.children[idx];
      const want = curGrid[idx];
      if (!cellEl || !want) continue;
      const same = cellEl.dataset.sym === want.sym &&
        cellEl.classList.contains('framed') === !!want.framed;
      if (!same) setCell(idx, want, true, 70 + Math.floor(idx / 5) * 45);
    }
    await sleep(120);
    reconcileGrid(curGrid); // страховка: DOM обязан совпадать с расчётом

    // накопленный выигрыш шага + бегущий итог бонуса
    $('last-win').textContent = fmtCompact(accWin);
    if (state.bonus || result.bonusEnd) updateFsTotal(base + accWin);
    await sleep(120);
    flyCoins(t.win);
    await showBanner(accWin, t.multiplier || 1, false, false);

    // множитель бонуса на бейдже
    if (state.bonus && (t.multiplier || 1) > 1) {
      state.bonus.multiplier = Math.max(state.bonus.multiplier, t.multiplier);
      updateBonusUI();
    }
  }
  $('win-banner').classList.remove('show');
  // плавное затухание лесенки без резкого пропадания
  hideCascadeMult();
  $('fs-tag').classList.toggle('hidden', !(state.bonus && state.bonus.remaining > 0));

  // итог: BIG / MEGA / EPIC WIN — оверлей с дождём монет
  const ratio = result.totalWin / Math.max(1, betValue());
  if (result.totalWin > 0 && ratio >= 10) {
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    await showBigWin(result.totalWin, ratio >= 50 ? 'EPIC WIN' : ratio >= 25 ? 'MEGA WIN' : 'BIG WIN');
  } else if (result.totalWin > 0) {
    const big = result.totalWin >= betValue() * 20;
    if (big && tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    flyCoins(result.totalWin / 10);
    await showBanner(result.totalWin, lastMult, true, big);
  }
  $('win-banner').classList.remove('show');

  // завершение бонуса: общий выигрыш сессии
  if (result.bonusEnd) {
    const sum = $('fs-summary');
    $('fs-summary-amount').textContent = '+' + fmt(result.bonusEnd.total) + ' G';
    sum.classList.remove('hidden');
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    flyCoins(10);
    await sleep(2400);
    sum.classList.add('hidden');
    toast('Бонус завершён: +' + fmt(result.bonusEnd.total) + ' G');
  }

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

function ensureExamples() {
  if (!examplesReady) renderExamples();
}

async function doSpin() {
  if (state.spinning) return;
  const inBonus = !!(state.bonus && state.bonus.remaining > 0);
  if (!inBonus && state.balance < betValue()) {
    toast('Недостаточно голды', true);
    if (state.auto) stopAuto();
    return;
  }

  state.spinning = true;
  sfx('spin');
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
    else toast("Ошибка соединения, попробуй ещё раз", true);
    stopAuto();
    refreshState();
  } finally {
    $('spin').classList.remove('spinning');
    state.spinning = false;
    $('spin').disabled = false;
  }

  // авто-режим: продолжаем, пока есть счётчик и баланс (или фриспины)
  if (state.auto && autoLeft !== Infinity && autoLeft > 0) autoLeft--;
  updateAutoUI();
  const stillInBonus = !!(state.bonus && state.bonus.remaining > 0);
  if (state.auto && autoLeft > 0 && (stillInBonus || state.balance >= betValue())) {
    await sleep(500);
    if (state.auto) doSpin();
  } else if (stillInBonus && !state.auto) {
    toast(`Фриспины: ${state.bonus.remaining} — жми «Фриспин»`);
  } else {
    stopAuto();
  }
}

async function refreshState() {
  try {
    const s = await apiGet('/api/state');
    state.paytable = s.paytable || [];
    if (s.betSteps) state.betSteps = s.betSteps;
    state.bonus = s.bonus && s.bonus.remaining > 0 ? s.bonus : null;
    state.balance = s.balance;
    $('balance').textContent = fmtCompact(s.balance);
    $('balance').title = fmt(s.balance) + ' G';
    $('bet').textContent = fmtCompact(betValue());
    markPresets();
    histOffset = (s.history || []).length;
    renderHistory(s.history || []);
    renderPaytable();
    renderExamples();
    examplesReady = true;
    updateBonusUI();
    $('menu-item-admin').classList.toggle('hidden', !s.isAdmin);
    const bonusReady = (s.nextBonusIn || 0) <= 0;
    $('bonus-btn').classList.toggle('claimed', !bonusReady);
    $('bonus-btn').classList.toggle('ready', bonusReady);
    $('retry-pill').classList.add('hidden');
  } catch (e) {
    renderGrid(randomGrid(), true);
    const noInit = !(tg && tg.initData);
    const msg = e && e.message === 'unauthorized'
      ? (noInit
        ? 'Открой игру через бота @masons_agent — кнопка «Играть» или меню бота.'
        : 'Сессия истекла. Закрой игру и открой заново из меню бота.')
      : (navigator.onLine === false
        ? 'Нет интернета. Проверь соединение и попробуй ещё раз.'
        : 'Сервер не отвечает. Проверяем соединение…');
    const pill = $('retry-pill');
    $('retry-msg').textContent = msg;
    pill.classList.remove('hidden');
  }
}

function retryConnect() {
  $('retry-pill').classList.add('hidden');
  refreshState();
}

let examplesReady = false;

const EX_ARROW = '<svg class="mini-arrow" viewBox="0 0 24 24" fill="none"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function miniGrid(syms, hl = [], fr = []) {
  let html = '<div class="mini-grid">';
  for (let i = 0; i < syms.length; i++) {
    const cls = hl.includes(i) ? ' hl' : (fr.includes(i) ? ' fr' : '');
    const src = syms[i] ? `<img src="sym/${syms[i].toLowerCase()}.png" alt="">` : '';
    html += `<div class="mini-cell${cls}">${src}</div>`;
  }
  return html + '</div>';
}

function renderExamples() {
  const bandit = (state.paytable.find(p => p.id === 'BANDIT') || { pays: { 3: 3.4, 4: 10.88, 5: 34 } });
  const p3 = Number(bandit.pays[3]), p4 = Number(bandit.pays[4]), p5 = Number(bandit.pays[5]);
  const b = 'BANDIT';
  const ex1 = [b,'SKULL','COIN','GEM','CACTUS',
               'MARACAS', b,'DYNAMITE','SPUR','TEQUILA',
               'SOMBRERO','CACTUS', b,'MONEYBAG','PISTOL',
               'GEM','COIN','SKULL','PISTOL','COIN'];
  const ex2 = ['COIN','SKULL','COIN','GEM','CACTUS',
               'MARACAS','GEM','DYNAMITE','SPUR','TEQUILA',
               'SOMBRERO','CACTUS','PISTOL','MONEYBAG','PISTOL',
               'GEM','COIN','SKULL','PISTOL','COIN'];
  $('win-examples').innerHTML = `
    <div class="example-card">
      <h4>Формат выигрыша</h4>
      <p class="ex-note">3+ одинаковых символа подряд слева направо — позиция в столбце не важна. Золотые клетки — выигрышная линия.</p>
      <div class="ex-row">${miniGrid(ex1, [0, 6, 12])}</div>
      <p class="ex-caption">3 Бандита подряд → ставка ×${p3} · при ставке 100 G выигрыш +${Math.round(p3 * 100)} G</p>
    </div>
    <div class="example-card">
      <h4>Каскады — выигрыши серией</h4>
      <p class="ex-note">Выигрышные символы сгорают, сверху падают новые — и выигрыш считается заново.</p>
      <div class="ex-row">${miniGrid(ex1, [0, 6, 12])} ${EX_ARROW} ${miniGrid(ex2)}</div>
      <p class="ex-caption">Один спин может принести несколько выигрышей подряд</p>
    </div>
    <div class="example-card">
      <h4>Золотая рамка → Вайлд</h4>
      <p class="ex-note">Символ в золотой рамке при сгорании превращается в Вайлда — заменяет любой платёжный символ.</p>
      <div class="ex-row">
        ${miniGrid(['SKULL', b, b, b, 'COIN'], [1, 2, 3], [0])} ${EX_ARROW} ${miniGrid(['WILD', b, b, b, 'COIN'], [0, 1, 2, 3])}
      </div>
      <p class="ex-caption">4 Бандита с Вайлдом → ставка ×${p4} · при ставке 100 G это +${Math.round(p4 * 100)} G</p>
    </div>
    <div class="example-card">
      <h4>Множитель фриспинов</h4>
      <p class="ex-note">Во фриспинах каждый каскад поднимает множитель на +1 — и он не сбрасывается до конца бонуса.</p>
      <div class="mult-track">
        <span class="mult-chip">×1</span><span class="mult-chip plus">+</span>
        <span class="mult-chip">×2</span><span class="mult-chip plus">+</span>
        <span class="mult-chip">×3</span><span class="mult-chip plus">→</span>
        <span class="mult-chip">×10</span>
      </div>
      <p class="ex-caption">Выигрыш ×50 G при множителе ×10 → +500 G за каскад</p>
    </div>
    <div class="example-card">
      <h4>Максимальная линия</h4>
      <p class="ex-note">5 одинаковых подряд слева направо — самый большой коэффициент символа.</p>
      <div class="ex-row">${miniGrid([b, b, b, b, b, 'COIN','SKULL','GEM','CACTUS','PISTOL', 'SPUR','TEQUILA','MARACAS','MONEYBAG','SOMBRERO', 'GEM','COIN','SKULL','PISTOL','DYNAMITE'], [0, 1, 2, 3, 4])}</div>
      <p class="ex-caption">5 Бандитов → ставка ×${p5} · при ставке 100 G это +${Math.round(p5 * 100)} G</p>
    </div>`;
}

let histOffset = 0;
let histBusy = false;

function parseSpinDate(s) {
  // created_at приходит из SQLite как UTC «YYYY-MM-DD HH:MM:SS»
  const d = new Date(String(s || '').replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

function histRowHtml(r, d) {
  const won = r.win > 0;
  const time = d.toLocaleTimeString('ru-RU', { hour12: false });
  const mv = r.multipliers && Number(r.multipliers) > 1
    ? `<span class="hist-mult">&times;${Math.round(Number(r.multipliers))}</span>` : '';
  return `<li class="hist-row">
    <span class="hist-ico ${won ? 'win' : ''}"><svg><use href="#ui-coin"/></svg></span>
    <div class="hist-mid">
      <span class="hist-bet">Ставка ${fmt(r.bet)} G${mv}</span>
      <span class="hist-time">${time}</span>
    </div>
    <b class="hist-win ${won ? 'pos' : 'zero'}">${won ? '+' + fmt(r.win) + ' G' : '0'}</b>
  </li>`;
}

function renderHistory(rows, append = false) {
  const list = $('history-list');
  if (!rows.length && !append) {
    list.innerHTML = '<li class="history-empty">Спинов пока нет — крутани барабан</li>';
    return;
  }
  const today = new Date();
  let html = '';
  let lastDay = append ? list.dataset.lastday || '' : '';
  let seenDays = !append;
  for (const r of rows) {
    const d = parseSpinDate(r.created_at);
    if (!d) continue;
    const key = d.toDateString();
    if (key !== lastDay) {
      const label = key === today.toDateString()
        ? 'Сегодня'
        : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
      html += `<li class="hist-day">${label}</li>`;
      lastDay = key;
    }
    html += histRowHtml(r, d);
  }
  list.dataset.lastday = lastDay;
  if (append) { list.insertAdjacentHTML('beforeend', html); return; }
  list.innerHTML = html;
}

$('history-list').addEventListener('scroll', async () => {
  const list = $('history-list');
  if (histBusy || list.scrollTop + list.clientHeight < list.scrollHeight - 140) return;
  histBusy = true;
  try {
    const more = await apiGet('/api/history?offset=' + histOffset);
    const rows = more.history || [];
    if (rows.length) {
      histOffset += rows.length;
      renderHistory(rows, true);
      if (rows.length < 20) histBusy = true; // всё, больше нет
    }
  } catch (e) { /* тихо: попробуем при следующем скролле */ }
  finally { if (!histBusy) {} }
}, { passive: true });

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
        <td><img src="sym/${s.id.toLowerCase()}.png" alt=""></td>
        <td class="symlbl">${SYM_NAMES[s.id] || s.id}</td>
        <td>${p[3] ?? '—'}</td><td>${p[4] ?? '—'}</td><td>${p[5] ?? '—'}</td>
      </tr>`;
    }).join('') +
    `<tr><td><img src="sym/wild.png" alt=""></td><td class="symlbl">Вайлд</td><td colspan="3" class="muted">заменяет любой символ</td></tr>
     <tr><td><img src="sym/guitar.png" alt=""></td><td class="symlbl">Гитара</td><td colspan="3" class="muted">3+ → 12 фриспинов</td></tr>`;
}

// ---------- обработчики ----------
$('spin').addEventListener('click', doSpin);
$('retry-btn').addEventListener('click', retryConnect);

function markPresets() {
  const cur = state.betSteps[state.betIndex];
  document.querySelectorAll('.bp').forEach(b => {
    b.classList.toggle('on', b.dataset.v !== 'max' && Number(b.dataset.v) === cur);
  });
}
document.querySelectorAll('.bp').forEach(b => b.addEventListener('click', () => {
  if (state.bonus) return;
  let v;
  if (b.dataset.v === 'max') {
    const ok = state.betSteps.filter(s => s <= state.balance);
    v = ok.length ? ok[ok.length - 1] : state.betSteps[0];
  } else v = Number(b.dataset.v);
  const i = state.betSteps.indexOf(v);
  if (i >= 0) {
    state.betIndex = i;
    $('bet').textContent = fmtCompact(betValue());
    markPresets();
    sfx('tick');
  }
}));
const muteBtn = $('mute-btn');
function renderMute() {
  muteBtn.classList.toggle('off', !soundOn);
  muteBtn.querySelector('use').setAttribute('href', soundOn ? '#ui-sound' : '#ui-mute-ico');
}
muteBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('gb-sound', soundOn ? '1' : '0');
  renderMute();
  if (soundOn) sfx('tick');
});
renderMute();
$('bet-minus').addEventListener('click', () => {
  state.betIndex = Math.max(0, state.betIndex - 1);
  $('bet').textContent = fmt(state.betSteps[state.betIndex]);
});
$('bet-plus').addEventListener('click', () => {
  state.betIndex = Math.min(state.betSteps.length - 1, state.betIndex + 1);
  $('bet').textContent = fmt(state.betSteps[state.betIndex]);
});

let autoLeft = 0;
function updateAutoUI() {
  const lbl = $('auto-label');
  if (state.auto) {
    lbl.textContent = autoLeft === Infinity ? 'СТОП ∞' : 'СТОП ' + autoLeft;
  } else {
    lbl.textContent = 'АВТО';
  }
}
function stopAuto() {
  autoLeft = 0;
  state.auto = false;
  $('auto').classList.remove('on');
  $('auto-pop').classList.add('hidden');
  updateAutoUI();
}
$('auto').addEventListener('click', () => {
  if (state.auto) { stopAuto(); return; }            // во время серии — стоп
  $('auto-pop').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  const pop = $('auto-pop');
  if (pop.classList.contains('hidden')) return;
  if (!pop.contains(e.target) && e.target !== $('auto') && !$('auto').contains(e.target)) {
    pop.classList.add('hidden');
  }
});
$('auto-pop').querySelectorAll('.ap-opt').forEach(b => b.addEventListener('click', () => {
  autoLeft = b.dataset.n === 'inf' ? Infinity : Number(b.dataset.n);
  state.auto = true;
  $('auto-pop').classList.add('hidden');
  $('auto').classList.add('on');
  updateAutoUI();
  doSpin();
}));

// ---------- DRAWER-МЕНЮ ----------
const drawer = $('drawer'), drawerOverlay = $('drawer-overlay');
function openDrawer() {
  drawer.classList.add('open');
  drawerOverlay.classList.remove('hidden');
}
function closeDrawer() {
  drawer.classList.remove('open');
  drawerOverlay.classList.add('hidden');
}
document.querySelectorAll('.menu-btn').forEach(b => b.addEventListener('click', openDrawer));
$('drawer-close').addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

function switchTab(name) {
  document.querySelectorAll('.menu-item').forEach(m => m.classList.toggle('active', m.dataset.tab === name));
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  if (name === 'history') refreshState();
  if (name === 'info') ensureExamples();
  if (name === 'admin') renderAdmin();
}
document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', () => {
    switchTab(item.dataset.tab);
    closeDrawer();
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

// ---------- касса: бонус + пополнение ----------
function updateShopUI() {
  const ready = $('bonus-btn').classList.contains('ready');
  $('shop-bonus').classList.toggle('claimed', !ready);
  $('shop-bonus-amt').textContent = ready ? '+500 G' : 'Получено';
}
function openShop() {
  updateShopUI();
  const sheet = $('shop-sheet');
  sheet.classList.remove('hidden');
  $('shop-overlay').classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
}
function closeShop() { $('shop-sheet').classList.remove('open'); $('shop-overlay').classList.add('hidden'); setTimeout(() => $('shop-sheet').classList.add('hidden'), 320); }
$('bonus-btn').addEventListener('click', openShop);
$('shop-close').addEventListener('click', closeShop);
$('shop-overlay').addEventListener('click', closeShop);

$('shop-bonus').addEventListener('click', async () => {
  if ($('shop-bonus').classList.contains('claimed')) { toast('Бонус уже получен — заходи через 24 ч'); return; }
  await claimBonus();
  updateShopUI();
});

async function buyPack(packId, btn) {
  const initData = tg && tg.initData ? tg.initData : '';
  if (!initData) { toast('Покупки доступны из Telegram', true); return; }
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API}/api/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData },
      body: JSON.stringify({ packId }),
    });
    if (res.status === 401) { toast('Открой приложение из Telegram', true); return; }
    const { link, error } = await res.json().catch(() => ({}));
    if (!link) { toast(error || 'Не удалось создать счёт', true); return; }
    if (typeof tg.openInvoice === 'function') {
      tg.openInvoice(link, (status) => {
        if (status === 'paid') {
          toast('Баланс пополнен!');
          if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
          closeShop();
          refreshState();
        } else if (status === 'failed') toast('Оплата не прошла', true);
        else if (status === 'pending') toast('Оплата обрабатывается…');
      });
    } else {
      // Фолбэк: открыть ссылку счёта через Telegram
      tg.openLink(link);
    }
  } catch (e) { toast('Ошибка соединения', true); }
  finally { if (btn) btn.disabled = false; }
}
document.querySelectorAll('.shop-pack').forEach(p => p.addEventListener('click', () => buyPack(Number(p.dataset.pack), p)));

let adminCache = { users: [], tx: [] };
$('admin-search').addEventListener('input', (e) => renderAdminUsers(e.target.value.trim().toLowerCase()));
