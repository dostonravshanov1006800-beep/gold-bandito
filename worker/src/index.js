// Gold Bandito — Cloudflare Worker.
// Маршруты:
//   POST /api/telegram  — webhook Telegram (защищён WEBHOOK_SECRET)
//   POST /api/spin      — спин / фриспин (initData в заголовке x-init-data)
//   GET  /api/state     — баланс + бонус + история + выплаты (initData в ?d=)

import { validateInitData } from './auth.js';
import { playSpin, BET_STEPS, START_BALANCE, PAYTABLE } from './game.js';
import { ensureUser, placeBet, settleSpin, history } from './db.js';
import { handleUpdate } from './bot.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function corsHeaders(env) {
  const origins = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  return {
    'Access-Control-Allow-Origin': origins[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Init-Data',
    'Vary': 'Origin',
  };
}

function json(env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(env) },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    // --- Telegram webhook ---
    if (url.pathname === '/api/telegram' && request.method === 'POST') {
      const header = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (!env.WEBHOOK_SECRET || header !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const update = await request.json().catch(() => null);
      if (!update) return json(env, { ok: true });
      ctx.waitUntil(handleUpdate(env, update).catch(err => {
        console.error('update error', err);
      }));
      return json(env, { ok: true });
    }

    // --- Спин / фриспин ---
    if (url.pathname === '/api/spin' && request.method === 'POST') {
      const initData = request.headers.get('x-init-data') || '';
      const user = await validateInitData(initData, env.BOT_TOKEN);
      if (!user) return json(env, { error: 'unauthorized' }, 401);

      const body = await request.json().catch(() => ({}));
      let row = await ensureUser(env, user.id, user.username);
      const inBonus = (row.fs_remaining || 0) > 0;

      let bet;
      if (inBonus) {
        // фриспин: ставка не списывается, множитель бонуса растёт с каждым каскадом
        bet = row.fs_bet || 100;
        const result = playSpin(bet, Math.random, row.fs_multiplier || 1);

        let remaining = (row.fs_remaining || 0) - 1;
        let multiplier = result.finalMult || row.fs_multiplier || 1;
        let retrigger = 0;
        if (result.freeSpins > 0) {          // ретриггер: ещё гитары
          retrigger = result.freeSpins;
          remaining += retrigger;
        }

        await settleSpin(env, user.id, bet, result.totalWin, {
          remaining, multiplier, bet,
        });
        row = await ensureUser(env, user.id, user.username);
        return json(env, {
          ...result,
          bet,
          balance: row.balance,
          freeSpinsWon: retrigger,
          bonus: { remaining, multiplier },
        });
      }

      // обычный спин
      bet = Number(body.bet);
      if (!BET_STEPS.includes(bet)) return json(env, { error: 'bad_bet' }, 400);

      const ok = await placeBet(env, user.id, bet);
      if (!ok) {
        return json(env, { error: 'insufficient_funds', balance: row.balance }, 402);
      }

      const result = playSpin(bet, Math.random, 0);
      const triggered = result.freeSpins > 0;   // 3+ гитар → бонус
      await settleSpin(env, user.id, bet, result.totalWin, triggered ? {
        remaining: result.freeSpins, multiplier: 1, bet,
      } : null);
      row = await ensureUser(env, user.id, user.username);
      return json(env, {
        ...result,
        bet,
        balance: row.balance,
        bonus: triggered
          ? { remaining: result.freeSpins, multiplier: 1 }
          : null,
      });
    }

    // --- Стартовое состояние ---
    if (url.pathname === '/api/state' && request.method === 'GET') {
      const initData = url.searchParams.get('d') || '';
      const user = await validateInitData(initData, env.BOT_TOKEN);
      if (!user) return json(env, { error: 'unauthorized' }, 401);

      const row = await ensureUser(env, user.id, user.username);
      const spins = await history(env, user.id, 20);
      return json(env, {
        balance: row.balance,
        spinsTotal: row.spins,
        bonus: row.fs_remaining > 0
          ? { remaining: row.fs_remaining, multiplier: row.fs_multiplier, bet: row.fs_bet }
          : null,
        history: spins,
        betSteps: BET_STEPS,
        startBalance: START_BALANCE,
        paytable: PAYTABLE,
      });
    }

    if (url.pathname === '/') {
      return json(env, { ok: true, name: 'gold-bandito worker' });
    }

    return json(env, { error: 'not_found' }, 404);
  },
};
