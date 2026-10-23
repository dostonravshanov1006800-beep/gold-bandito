// Симуляция отдачи (RTP) с учётом фриспинов. Запуск: node sim.mjs [спинов]
import { playSpin } from './src/game.js';

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const N = Number(process.argv[2] || 200000);
const BET = 100;
const rand = mulberry32(20261023);

let staked = 0, won = 0;
let hits = 0, triggered = 0;
let tumblesSum = 0, wildsSum = 0;
let maxTum = 0, maxWin = 0;

for (let i = 0; i < N; i++) {
  staked += BET;
  const r = playSpin(BET, rand);
  won += r.totalWin;
  if (r.tumblesCount > 0) hits++;
  tumblesSum += r.tumblesCount;
  wildsSum += r.tumbles.reduce((a, t) => a + t.wildsAt.length, 0);
  if (r.tumblesCount > maxTum) maxTum = r.tumblesCount;
  if (r.totalWin > maxWin) maxWin = r.totalWin;
  let roundWin = r.totalWin;

  // фриспины
  if (r.freeSpins > 0) {
    triggered++;
    let fsLeft = r.freeSpins;
    let fsMult = 1;
    while (fsLeft > 0) {
      fsLeft--;
      const fs = playSpin(BET, rand, fsMult);
      roundWin += fs.totalWin;
      fsMult = fs.finalMult;
      if (fs.freeSpins > 0) fsLeft += fs.freeSpins; // ретриггер
      if (fs.totalWin > maxWin) maxWin = fs.totalWin;
    }
    won += roundWin - r.totalWin;
  }
}

console.log('База+фриспины RTP %:', (won / staked * 100).toFixed(2));
console.log('спинов с выигрышем (база) %:', (hits / N * 100).toFixed(1));
console.log('бонусов (3+ гитары) %:', (triggered / N * 100).toFixed(3),
  '| ~1 из', Math.round(N / Math.max(triggered, 1)), 'спинов');
console.log('ср. каскадов:', (tumblesSum / N).toFixed(3), '| макс:', maxTum);
console.log('ср. вайлдов со спина:', (wildsSum / N).toFixed(3));
console.log('макс. выигрыш за спин (x ставки):', (maxWin / BET).toFixed(1));
