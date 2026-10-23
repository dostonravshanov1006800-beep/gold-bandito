// ============================================================
// Gold Bandito — движок слота (механика Wild Bandito, PG Soft)
//   • Сетка 5×4, 1,024 ways
//   • Выигрыш: 3+ одинаковых символа на барабанах ПОДРЯД СЛЕВА
//   • Tumble: выигрышные сгорают, сверху падают новые
//   • Золотые рамки: сгоревшая рамка превращается в ВАЙЛД
//   • Вайлд заменяет любой платёжный символ
//   • Скаттер (гитара): 3+ на сетке → 12 фриспинов (+2 за каждый
//     сверх трёх), во фриспинах множитель +1 за каждый каскад,
//     не сбрасывается весь бонус
// Чистый модуль: не знает про HTTP и базу.
// Выплаты откалиброваны симуляцией под RTP ≈ 96.7% (sim.mjs, проверено 6 млн спинов: 96.71%, бонус 1/115).
// ============================================================

export const COLS = 5;
export const ROWS = 4;

export const WILD = 'WILD';
export const SCATTER = 'GUITAR';

// Платёжные символы: вес выпадения + выплаты (×ставка) за k
// подряд идущих барабанов слева.
export const SYMBOLS = [
  { id: 'BANDIT',   weight: 4,  pays: { 3: 3.4, 4: 10.89, 5: 34.04 } },
  { id: 'SKULL',    weight: 4.5, pays: { 3: 2.73, 4: 8.17, 5: 24.5 } },
  { id: 'TEQUILA',  weight: 5,  pays: { 3: 1.64, 4: 5.44, 5: 16.34 } },
  { id: 'SOMBRERO', weight: 6,  pays: { 3: 1.23, 4: 3.4, 5: 9.53 } },
  { id: 'MARACAS',  weight: 8,  pays: { 3: 0.82, 4: 2.44, 5: 6.81 } },
  { id: 'MONEYBAG', weight: 9, pays: { 3: 0.75, 4: 2.18, 5: 5.44 } },
  { id: 'CACTUS',   weight: 10, pays: { 3: 0.61, 4: 1.64, 5: 4.08 } },
  { id: 'DYNAMITE', weight: 12, pays: { 3: 0.47, 4: 1.36, 5: 3.4 } },
  { id: 'PISTOL',   weight: 11, pays: { 3: 0.55, 4: 1.36, 5: 3 } },
  { id: 'SPUR',     weight: 13, pays: { 3: 0.38, 4: 0.95, 5: 2.44 } },
  { id: 'GEM',      weight: 14, pays: { 3: 0.41, 4: 1.09, 5: 2.73 } },
  { id: 'COIN',     weight: 16, pays: { 3: 0.34, 4: 0.82, 5: 2.04 } },
];

// Скаттер (гитара): 3+ на сетке → фриспины
export const SCATTER_WEIGHT = 2.23;
// Золотая рамка: шанс на новую клетку
const FRAME_CHANCE = 0.03;

const WSUM = SYMBOLS.reduce((a, s) => a + s.weight, 0) + SCATTER_WEIGHT;

function pickSymbol(rand) {
  let r = rand() * WSUM;
  for (const s of SYMBOLS) { r -= s.weight; if (r <= 0) return s.id; }
  return SCATTER; // остаток веса — скаттер
}

function newCell(rand) {
  return { sym: pickSymbol(rand), framed: rand() < FRAME_CHANCE };
}

function fillGrid(rand) {
  const cells = [];
  for (let i = 0; i < COLS * ROWS; i++) cells.push(newCell(rand));
  return cells;
}

// ways-выигрыши с учётом вайлдов: символ S выигрывает, если он
// (или вайлд) присутствует на барабанах 0..k-1 подряд, k>=3.
function findWins(grid) {
  const wins = [];
  for (const sym of SYMBOLS) {
    let k = 0;
    for (let c = 0; c < COLS; c++) {
      let onReel = false;
      for (let r = 0; r < ROWS; r++) {
        const cell = grid[c + r * COLS];
        if (cell && (cell.sym === sym.id || cell.sym === WILD)) { onReel = true; break; }
      }
      if (onReel) k++; else break;
    }
    if (k >= 3) wins.push({ sym, k, pay: sym.pays[k] });
  }
  return wins;
}

// Гравитация: сгоревшие обычные клетки убираются (верхние падают),
// сгоревшие РАМКИ остаются на месте и становятся ВАЙЛДАМИ,
// сверху досыпаются новые клетки. Скаттеры никогда не горят.
function applyTumble(grid, burns, rand) {
  const burnSet = new Set(burns);
  const framedWilds = [];
  const next = new Array(COLS * ROWS).fill(null);
  const newCells = [];

  for (let c = 0; c < COLS; c++) {
    let writeRow = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const idx = c + r * COLS;
      const cell = grid[idx];
      if (!burnSet.has(idx)) {
        next[c + writeRow * COLS] = cell;
        writeRow--;
      } else if (cell.framed) {
        framedWilds.push(idx);
      }
    }
    for (let r = writeRow; r >= 0; r--) {
      const idx = c + r * COLS;
      const nc = newCell(rand);
      next[idx] = nc;
      newCells.push({ idx, sym: nc.sym, framed: nc.framed });
    }
  }
  for (const idx of framedWilds) {
    next[idx] = { sym: WILD, framed: false };
    newCells.push({ idx, sym: WILD, framed: false });
  }
  return { grid: next, newCells, wildsAt: framedWilds };
}

// Один раунд (спин с каскадами).
// mode: обычный спин (startMult = 0 → множителя нет) или
// фриспин (startMult ≥ 1 → множитель растёт с каждым каскадом).
export function playSpin(bet, rand = Math.random, startMult = 0) {
  const grid = fillGrid(rand);
  const initialGrid = grid.map(c => ({ sym: c.sym, framed: c.framed }));
  const tumbles = [];
  let mult = startMult;     // 0 = без множителя (база)
  let roundWin = 0;
  let guard = 0;
  let g = grid;

  while (guard++ < 40) {
    const wins = findWins(g);
    if (wins.length === 0) break;

    const burns = new Set();
    let tumbleWin = 0;
    const winInfo = [];

    for (const w of wins) {
      const win = w.pay * bet;
      tumbleWin += win;
      winInfo.push({ sym: w.sym.id, reels: w.k, win: Math.round(win * 100) / 100 });
      for (let i = 0; i < g.length; i++) {
        const cell = g[i];
        if (cell && i % COLS < w.k &&
            (cell.sym === w.sym.id || cell.sym === WILD)) {
          burns.add(i);
        }
      }
    }

    // множитель фриспинов: применяется к выигрышу каскада ПОСЛЕ
    // первого (первый каскад — стартовое значение)
    let tumbleMult = 1;
    if (mult > 0) { tumbleMult = mult; mult += 1; }

    const t = applyTumble(g, [...burns], rand);
    g = t.grid;
    const paid = tumbleWin * tumbleMult;
    roundWin += paid;
    tumbles.push({
      wins: winInfo,
      burns: [...burns],
      newCells: t.newCells,
      wildsAt: t.wildsAt,
      multiplier: tumbleMult,
      win: Math.round(paid * 100) / 100,
    });
  }

  // скаттеры на финальной сетке
  const scatters = g.filter(c => c.sym === SCATTER).length;

  return {
    initialGrid,
    tumbles,
    tumblesCount: tumbles.length,
    totalWin: Math.round(roundWin * 100) / 100,
    scatters,
    freeSpins: scatters >= 3 ? 12 + (scatters - 3) * 2 : 0,
    finalMult: mult > 0 ? mult : startMult,
  };
}

export const PAYTABLE = SYMBOLS.map(s => ({ id: s.id, pays: s.pays }));
export const BET_STEPS = [10, 50, 100, 500, 1000];
export const START_BALANCE = 1000;
