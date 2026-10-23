// Gold Bandito — Cloudflare Worker.
// Маршруты:
//   POST /api/telegram  — webhook Telegram (защищён WEBHOOK_SECRET)
//   POST /api/spin      — спин / фриспин (initData в заголовке x-init-data)
//   GET  /api/state     — баланс + бонус + история + выплаты (initData в ?d=)

import { validateInitData } from './auth.js';
import { playSpin, BET_STEPS, START_BALANCE, PAYTABLE } from './game.js';

const BONUS_AMOUNT = 500;          // ежедневный бонус, G
const BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;
import { ensureUser, placeBet, settleSpin, history, claimBonus, bonusState, adminGive, adminUsers, adminTx, stats } from './db.js';
import { handleUpdate } from './bot.js';

function isAdminUser(env, userId) {
  return String(env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).includes(userId);
}

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
      const lastBonus = await bonusState(env, user.id);
      return json(env, {
        balance: row.balance,
        spinsTotal: row.spins,
        isAdmin: isAdminUser(env, user.id),
        nextBonusIn: Math.max(0, BONUS_COOLDOWN_MS - (Date.now() - lastBonus)),
        bonusAmount: BONUS_AMOUNT,
        bonus: row.fs_remaining > 0
          ? { remaining: row.fs_remaining, multiplier: row.fs_multiplier, bet: row.fs_bet }
          : null,
        history: spins,
        betSteps: BET_STEPS,
        startBalance: START_BALANCE,
        paytable: PAYTABLE,
      });
    }

    // --- Ежедневный бонус ---
    if (url.pathname === '/api/bonus' && request.method === 'POST') {
      const initData = request.headers.get('x-init-data') || '';
      const user = await validateInitData(initData, env.BOT_TOKEN);
      if (!user) return json(env, { error: 'unauthorized' }, 401);
      await ensureUser(env, user.id, user.username);
      const r = await claimBonus(env, user.id, BONUS_AMOUNT, BONUS_COOLDOWN_MS);
      if (!r.ok) {
        return json(env, { error: 'cooldown', wait: Math.ceil(r.wait / 1000) }, 409);
      }
      return json(env, { balance: r.balance, amount: r.amount });
    }

    // --- Админ: список юзеров ---
    if (url.pathname === '/api/admin/users' && request.method === 'GET') {
      const initData = url.searchParams.get('d') || '';
      const user = await validateInitData(initData, env.BOT_TOKEN);
      if (!user) return json(env, { error: 'unauthorized' }, 401);
      if (!isAdminUser(env, user.id)) return json(env, { error: 'forbidden' }, 403);
      return json(env, { users: await adminUsers(env) });
    }

    // --- Админ: начислить/списать ---
    if (url.pathname === '/api/admin/give' && request.method === 'POST') {
      const initData = request.headers.get('x-init-data') || '';
      const admin = await validateInitData(initData, env.BOT_TOKEN);
      if (!admin) return json(env, { error: 'unauthorized' }, 401);
      if (!isAdminUser(env, admin.id)) return json(env, { error: 'forbidden' }, 403);
      const body = await request.json().catch(() => ({}));
      const targetId = Number(body.telegramId);
      const amount = Number(body.amount);
      if (!targetId || !amount) return json(env, { error: 'bad_request' }, 400);
      const bal = await adminGive(env, targetId, amount, admin.id);
      return json(env, { balance: bal });
    }

    // --- Админ: статистика ---
    if (url.pathname === '/api/admin/tx' && request.method === 'GET') {
      const initData = url.searchParams.get('d') || '';
      const user = await validateInitData(initData, env.BOT_TOKEN);
      if (!user) return json(env, { error: 'unauthorized' }, 401);
      if (!isAdminUser(env, user.id)) return json(env, { error: 'forbidden' }, 403);
      return json(env, { tx: await adminTx(env) });
    }

    if (url.pathname === '/api/admin/stats' && request.method === 'GET') {
      const initData = url.searchParams.get('d') || '';
      const user = await validateInitData(initData, env.BOT_TOKEN);
      if (!user) return json(env, { error: 'unauthorized' }, 401);
      if (!isAdminUser(env, user.id)) return json(env, { error: 'forbidden' }, 403);
      return json(env, await stats(env));
    }

    if (url.pathname === '/') {
      return json(env, { ok: true, name: 'gold-bandito worker' });
    }

    return json(env, { error: 'not_found' }, 404);
  },
};
