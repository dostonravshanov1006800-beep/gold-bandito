// Telegram-бот @masons_agent (webhook-режим).
// Команды: /start /balance /history /play /help
// Админам (ADMIN_IDS): /give /take /stats /users /user

import { ensureUser, getBalance, getUser, adminGive, adminUsers, topup, stats, history, claimBonus } from './db.js';

const BONUS_AMOUNT = 500;               // как в мини-аппе
const BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const API = 'https://api.telegram.org/bot';

async function tg(env, method, payload) {
  const res = await fetch(API + env.BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // логируем неудачную доставку: раньше такие ошибки молчали
    console.error('tg ' + method + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 200));
  }
  return res;
}

const APP_V = 31;

function appUrl(env) {
  const base = String(env.WEBAPP_URL || '');
  return base + (base.includes('?') ? '&' : '?') + 'v=' + APP_V;
}

function mainKeyboard(webappUrl, isAdmin) {
  const keyboard = [
    [{ text: 'ИГРАТЬ', web_app: { url: webappUrl } }],
    [{ text: 'Баланс' }, { text: 'Бонус' }, { text: 'История' }],
  ];
  if (isAdmin) keyboard.push([{ text: 'Статистика' }, { text: 'Игроки' }]);
  keyboard.push([{ text: 'Помощь' }]);
  return { is_persistent: true, resize_keyboard: true, keyboard };
}

function inlinePlay(webappUrl) {
  return { inline_keyboard: [[{ text: 'КРУТИТЬ БАРАБАН', web_app: { url: webappUrl } }]] };
}

// деньги: округление до 0,1 и группировка пробелами — никаких «20995145.300000004»
function fmtG(n) {
  const v = Math.round(Number(n) || 0);
  const s = String(v).replace('-', '').replace(/(?!^)(?=(?:\d{3})+$)/g, ' ');
  return (v < 0 ? '-' : '') + s;
}
function fmtG1(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  const [i, f] = String(v).split('.');
  const s = i.replace('-', '').replace(/(?!^)(?=(?:\d{3})+$)/g, ' ');
  return (v < 0 ? '-' : '') + s + (f ? ',' + f : '');
}
// время из SQLite (UTC) → Ташкент UTC+5
function fmtTz(utc) {
  const d = new Date(String(utc || '').replace(' ', 'T') + 'Z');
  if (isNaN(d)) return String(utc || '');
  return d.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour12: false });
}

const HELP = [
  'Gold Bandito — салунный слот в духе мексиканской ночи.',
  '',
  'Как играть: жми «Играть» под этим сообщением — откроется мини-апп.',
  '',
  'Правила (как в оригинале):',
  '• Сетка 5×4, 1,024 ways — одинаковые символы подряд слева (от 3-х).',
  '• Выигрышные сгорают, падают новые — каскады (tumble).',
  '• Символы в золотой рамке при сгорании становятся ВАЙЛДОМ.',
  '• 3+ гитары → 12 фриспинов (+2 за каждую сверх трёх).',
  '• Во фриспинах каждый каскад даёт +1 к множителю на весь бонус.',
  '',
  'RTP ≈ 96,7%, как у оригинала.',
  '',
  '/play — открыть игру',
  '/balance — баланс голды',
  '/history — последние спины',
  '/help — это сообщение',
].join('\n');

const HELP_ADMIN = [
  '',
  'Админ-команды:',
  '/give <id> <сумма> — начислить голду',
  '/take <id> <сумма> — списать голду',
  '/stats — статистика',
  '/users — топ игроков',
  '/user <id> — карточка игрока',
].join('\n');

function parseArgs(text) {
  const parts = text.split(/\s+/);
  const cmd = (parts[0] || '').split('@')[0].toLowerCase();
  return { cmd, a1: parts[1], a2: parts[2] };
}

export async function handleUpdate(env, update) {
  // Stars: pre-checkout и успешная оплата
  if (update.pre_checkout_query) {
    await tg(env, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: update.pre_checkout_query.id, ok: true,
    });
    return { ok: true };
  }
  const pay = update.message && update.message.successful_payment;
  if (pay) {
    const from = update.message.from || {};
    const m = String(pay.invoice_payload || '').match(/^topup:(\d+):(\d+)$/);
    const chargeId = pay.telegram_payment_charge_id;
    if (m && chargeId && Number(pay.total_amount) === Number(m[2])) {
      try {
        const bal = await topup(env, from.id, Number(m[1]), Number(m[2]), chargeId);
        await tg(env, 'sendMessage', {
          chat_id: update.message.chat.id,
          text: `Начислено ${fmtG(m[1])} G (баланс: ${fmtG1(bal)} G). Спасибо за пополнение!`,
        });
      } catch (e) {
        // повторная доставка webhook — уже начислено, отвечаем ok чтобы Telegram не ретраил
      }
    }
    return { ok: true };
  }

  // отредактированные сообщения командами не считаем — приветствие не дублируется
  const msg = update.message;
  if (!msg || !msg.text) return { ok: true };
  const chatId = msg.chat.id;
  const from = msg.from || {};
  let { cmd, a1, a2 } = parseArgs(msg.text.trim());
  const LABELS = { 'баланс': '/balance', 'бонус': '/bonus', 'история': '/history', 'помощь': '/help', 'статистика': '/stats', 'игроки': '/users', 'играть': '/play' };
  const mapped = LABELS[(msg.text.trim() || '').toLowerCase()];
  if (mapped) cmd = mapped;
  const adminIds = String(env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);
  const isAdmin = adminIds.includes(from.id);
  const send = (text, markup) => tg(env, 'sendMessage', { chat_id: chatId, text, reply_markup: markup });

  switch (cmd) {
    case '/start': {
      await ensureUser(env, from.id, from.username);
      await send([
        'Салют! Это Gold Bandito — салунный слот в духе мексиканской ночи.',
        '',
        'Стартовый баланс: 1 000 G.',
        '',
        'Всё на кнопках под сообщением, вводить ничего не надо:',
        'ИГРАТЬ — барабан · Баланс · Бонус · История · Помощь.',
        '',
        'Сетка 5×4, 1,024 ways, каскады, вайлды из золотых рамок и фриспины с растущим множителем.',
      ].join('\n'), mainKeyboard(appUrl(env), isAdmin));
      return { ok: true };
    }
    case '/play': {
      await send('Держи барабан. Удачи, бандито!', inlinePlay(appUrl(env)));
      return { ok: true };
    }
    case '/balance': {
      const row = await ensureUser(env, from.id, from.username);
      const lines = [`Баланс: ${fmtG1(row.balance)} G`];
      if (row.fs_remaining > 0) {
        lines.push(`Бонус: ${fmtG(row.fs_remaining)} фриспинов, множитель ×${row.fs_multiplier}`);
      }
      await send(lines.join('\n'));
      return { ok: true };
    }
    case '/history': {
      const rows = await history(env, from.id, 10);
      if (!rows.length) { await send('Спинов пока нет — крутани барабан в /play'); return { ok: true }; }
      const lines = rows.map(r => {
        const res = r.win > 0 ? `+${fmtG1(r.win)} G` : '0';
        const mv = r.multipliers && Number(r.multipliers) > 1 ? ` (×${Math.round(Number(r.multipliers))})` : '';
        return `${fmtTz(r.created_at)} · ставка ${fmtG(r.bet)} G → ${res}${mv}`;
      });
      await send('Последние спины (время по Ташкенту):\n' + lines.join('\n'));
      return { ok: true };
    }
    case '/bonus': {
      const res = await claimBonus(env, from.id, BONUS_AMOUNT, BONUS_COOLDOWN_MS);
      if (res && res.ok === false) {
        const h = Math.floor(res.wait / 3600000), m = Math.ceil((res.wait % 3600000) / 60000);
        await send(`Бонус уже забран. Следующий через ${h} ч ${m} мин — приходи завтра.`);
      } else {
        const bal = await getBalance(env, from.id);
        await send(`Ежедневный бонус забран: +${fmtG(BONUS_AMOUNT)} G.\nБаланс: ${fmtG1(bal)} G. Возвращайся через сутки!`);
      }
      return { ok: true };
    }
    case '/help': {
      await send(HELP + (isAdmin ? HELP_ADMIN : ''));
      return { ok: true };
    }
    case '/give':
    case '/take': {
      if (!isAdmin) { await send('Только для админов.'); return { ok: true }; }
      const targetId = Number(a1);
      const amount = Number(String(a2 || '').replace(',', '.'));
      if (!Number.isInteger(targetId) || !Number.isFinite(amount) || amount <= 0) {
        await send(`Формат: ${cmd} <user_id> <сумма>\nНапример: ${cmd} 8396883978 1000`);
        return { ok: true };
      }
      const target = await getUser(env, targetId);
      if (!target) { await send(`Юзер ${a1} не найден — пусть сначала откроет бота.`); return { ok: true }; }
      const delta = cmd === '/take' ? -amount : amount;
      const bal = await adminGive(env, targetId, delta, from.id);
      await send(`${cmd === '/give' ? 'Начислено' : 'Списано'} ${fmtG(amount)} G у юзера ${targetId}. Баланс: ${fmtG1(bal)} G`);
      return { ok: true };
    }
    case '/stats': {
      if (!isAdmin) { await send('Только для админов.'); return { ok: true }; }
      const s = await stats(env);
      const rtp = s.staked > 0 ? (s.won / s.staked * 100).toFixed(1) : '0.0';
      await send([
        'Статистика Gold Bandito:',
        `Юзеров: ${fmtG(s.users)}`,
        `Спинов: ${fmtG(s.spins)}`,
        `Поставлено: ${fmtG1(s.staked)} G`,
        `Выплачено: ${fmtG1(s.won)} G`,
        `Фактический RTP: ${rtp}%`,
        `Прибыль: ${fmtG1(s.staked - s.won)} G`,
      ].join('\n'));
      return { ok: true };
    }
    case '/users': {
      if (!isAdmin) { await send('Только для админов.'); return { ok: true }; }
      const rows = await adminUsers(env);
      if (!rows.length) { await send('Игроков нет.'); return { ok: true }; }
      const lines = rows.slice(0, 15).map((u, i) =>
        `${i + 1}. ${u.username ? '@' + u.username : 'id ' + u.telegram_id} — ${fmtG1(u.balance)} G (спинов: ${u.spins})`);
      await send('Топ игроков по балансу:\n' + lines.join('\n'));
      return { ok: true };
    }
    case '/user': {
      if (!isAdmin) { await send('Только для админов.'); return { ok: true }; }
      const targetId = Number(a1);
      if (!Number.isInteger(targetId)) { await send('Формат: /user <user_id>'); return { ok: true }; }
      const u = await getUser(env, targetId);
      if (!u) { await send(`Юзер ${a1} не найден.`); return { ok: true }; }
      const spins = await history(env, targetId, 5);
      const last = spins.length
        ? '\nПоследние спины:\n' + spins.map(r => `${fmtTz(r.created_at)} · ${fmtG(r.bet)} G → ${r.win > 0 ? '+' + fmtG1(r.win) : '0'}`).join('\n')
        : '';
      await send([
        u.username ? '@' + u.username : 'id ' + u.telegram_id,
        `id: ${u.telegram_id}`,
        `Баланс: ${fmtG1(u.balance)} G`,
        `Спинов: ${u.spins}`,
        u.fs_remaining > 0 ? `Бонус: ${u.fs_remaining} фриспинов ×${u.fs_multiplier}` : 'Бонуса нет',
        last,
      ].join('\n'));
      return { ok: true };
    }
    default: {
      if (cmd.startsWith('/')) {
        await send('Неизвестная команда. Жми «Помощь» на клавиатуре ниже.');
      } else {
        await tg(env, 'sendMessage', {
          chat_id: chatId,
          text: 'Жми кнопки на клавиатуре — «ИГРАТЬ» открывает барабан.',
          reply_markup: mainKeyboard(appUrl(env), isAdmin),
        });
      }
      return { ok: true };
    }
  }
}
